import type { BookingPaidV1 } from '@bus/contracts-events';
import { incrementCounter } from '@bus/observability';
import { Inject, Injectable } from '@nestjs/common';

import { BookingFulfillmentClient } from './booking.client';
import { TicketGenerator } from './ticket.generator';
import { TicketRepository } from './ticket.repository';
import type { TicketDocumentView, TicketOwner } from './ticket.types';

@Injectable()
export class TicketService {
  constructor(
    @Inject(TicketRepository) private readonly repository: TicketRepository,
    @Inject(TicketGenerator) private readonly generator: TicketGenerator,
    @Inject(BookingFulfillmentClient) private readonly bookingClient: BookingFulfillmentClient,
  ) {}

  async processBookingPaid(event: BookingPaidV1, headers: Record<string, string>): Promise<void> {
    let state = await this.repository.processingState(event.eventId);
    if (!state) {
      const snapshot = await this.bookingClient.getSnapshot(
        event.aggregateId,
        event.requestId,
        headers,
      );
      if (snapshot.status === 'CANCELLED') {
        await this.repository.recordSkippedEvent({
          eventId: event.eventId,
          eventType: event.eventType,
          bookingId: event.aggregateId,
          traceId: event.traceId,
          requestId: event.requestId,
          processedAt: new Date().toISOString(),
        });
        return;
      }
      if (
        snapshot.bookingId !== event.aggregateId ||
        snapshot.passengers.length !== event.payload.passengerCount
      ) {
        throw namedError('BookingSnapshotMismatch', 'Booking snapshot does not match paid event.');
      }
      const issuedAt = new Date().toISOString();
      const tickets = await this.generator.generate(snapshot, issuedAt);
      await this.repository.persistEventAndTickets({
        eventId: event.eventId,
        eventType: event.eventType,
        bookingId: event.aggregateId,
        traceId: event.traceId,
        requestId: event.requestId,
        tickets,
      });
      state = await this.repository.processingState(event.eventId);
    }
    if (state?.skipped) return;
    if (!state || state.ticketCount < 1 || !state.issuedAt) {
      throw namedError('TicketPersistenceIncomplete', 'Ticket documents were not persisted.');
    }
    if (!state.fulfilled) {
      try {
        const ticketReferences = await this.repository.listIssuedReferences(state.bookingId);
        if (ticketReferences.length !== state.ticketCount) {
          throw namedError('TicketReferenceCountMismatch', 'Ticket references are incomplete.');
        }
        await this.bookingClient.markTicketIssued({
          bookingId: state.bookingId,
          sourceEventId: event.eventId,
          issuedAt: state.issuedAt,
          ticketCount: state.ticketCount,
          tickets: ticketReferences,
          requestId: event.requestId,
          propagationHeaders: headers,
        });
        await this.repository.markFulfilled(event.eventId, new Date().toISOString());
        incrementCounter('bus.ticket.issued', {}, state.ticketCount);
      } catch (error) {
        await this.repository.recordFailure(event.eventId, safeErrorCode(error));
        throw error;
      }
    }
  }

  async listBookingTickets(bookingId: string, owner: TicketOwner): Promise<TicketDocumentView[]> {
    if (!isUuid(bookingId) || !isUuid(owner.id)) return [];
    return this.repository.listOwned(bookingId, owner);
  }

  readiness(): Promise<void> {
    return this.repository.ping();
  }
}

function safeErrorCode(error: unknown): string {
  const name = error instanceof Error ? error.name : 'UnknownError';
  return /^[A-Za-z0-9._-]{1,128}$/.test(name) ? name : 'TicketWorkerError';
}

function namedError(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
