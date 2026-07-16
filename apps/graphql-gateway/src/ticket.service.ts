import { activePropagationHeaders, createRequestId, logEvent } from '@bus/observability';
import { Metadata } from '@grpc/grpc-js';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom, type Observable, timeout } from 'rxjs';

import type { BookingGatewayActor, BookingGatewayOwner } from './booking.service';

interface TicketClientContract {
  listBookingTickets(
    input: {
      bookingId: string;
      owner: { type: 1 | 2; id: string };
      requestId: string;
    },
    metadata?: Metadata,
  ): Observable<TicketGatewayResponse>;
}

export interface TicketGatewayResponse {
  bookingId: string;
  ready: boolean;
  tickets?: Array<{
    id: string;
    ticketCode: string;
    bookingCode: string;
    passengerName: string;
    seatId: string;
    routeLabel: string;
    pickupName: string;
    dropoffName: string;
    departureAt: string;
    vehicleLabel: string;
    qrPayload: string;
    htmlContent: string;
    pdfDocument: Uint8Array | Buffer;
    issuedAt: string;
  }>;
  requestId: string;
}

export class TicketDependencyError extends Error {
  constructor(
    readonly requestId: string,
    options?: ErrorOptions,
  ) {
    super('Ticket Worker is unavailable.', options);
    this.name = 'TicketDependencyError';
  }
}

@Injectable()
export class TicketGatewayService implements OnModuleInit {
  private client?: TicketClientContract;

  constructor(@Inject('TICKET_GRPC') private readonly grpcClient: ClientGrpc) {}

  onModuleInit(): void {
    this.client = this.grpcClient.getService<TicketClientContract>('TicketService');
  }

  async listBookingTickets(
    bookingId: string,
    owner: BookingGatewayOwner,
    inboundRequestId?: string,
    actor?: BookingGatewayActor,
  ) {
    const requestId = createRequestId(inboundRequestId);
    if (!this.client) throw new TicketDependencyError(requestId);
    const metadata = new Metadata();
    metadata.set('x-request-id', requestId);
    if (actor) {
      metadata.set('x-actor-id', actor.id);
      metadata.set('x-actor-role', actor.role);
      metadata.set('x-actor-token-id', actor.tokenId);
    }
    for (const [key, value] of Object.entries(activePropagationHeaders())) metadata.set(key, value);
    try {
      const response = await firstValueFrom(
        this.client
          .listBookingTickets(
            {
              bookingId,
              owner: { type: owner.type === 'GUEST_SESSION' ? 1 : 2, id: owner.id },
              requestId,
            },
            metadata,
          )
          .pipe(timeout(3_000)),
      );
      return {
        bookingId: response.bookingId,
        ready: response.ready,
        tickets: (response.tickets ?? []).map((ticket) => ({
          ...ticket,
          pdfBase64: Buffer.from(ticket.pdfDocument).toString('base64'),
        })),
      };
    } catch (error) {
      logEvent({
        service: 'graphql-gateway',
        level: 'error',
        event: 'ticket.lookup.failed',
        message: 'Ticket lookup failed.',
        requestId,
        fields: { bookingId, dependency: 'ticket-worker', ownerType: owner.type },
      });
      throw new TicketDependencyError(requestId, { cause: error });
    }
  }
}
