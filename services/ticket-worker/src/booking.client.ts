import { activePropagationHeaders, createRequestId } from '@bus/observability';
import { Metadata } from '@grpc/grpc-js';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom, type Observable, timeout } from 'rxjs';

import type { FulfillmentSnapshot, IssuedTicketReference } from './ticket.types';

interface BookingClientContract {
  getFulfillmentSnapshot(
    input: { bookingId: string; requestId: string },
    metadata?: Metadata,
  ): Observable<{ snapshot?: GrpcFulfillmentSnapshot; requestId: string }>;
  markTicketIssued(
    input: {
      bookingId: string;
      sourceEventId: string;
      issuedAt: string;
      ticketCount: number;
      tickets: IssuedTicketReference[];
      requestId: string;
    },
    metadata?: Metadata,
  ): Observable<{
    bookingId: string;
    status: number | string;
    transitioned: boolean;
    requestId: string;
  }>;
}

interface GrpcFulfillmentSnapshot {
  bookingId: string;
  bookingCode: string;
  status: number | string;
  owner?: { type: number | string; id: string };
  contactEmail: string;
  trip?: FulfillmentSnapshot['trip'];
  passengers?: Array<{ id: string; seatId: string; fullName: string }>;
  totalPriceVnd: number;
  paidAt: string;
}

const SYSTEM_ACTOR_ID = '00000000-0000-4000-8000-000000000001';

@Injectable()
export class BookingFulfillmentClient implements OnModuleInit {
  private client?: BookingClientContract;

  constructor(@Inject('BOOKING_GRPC') private readonly grpcClient: ClientGrpc) {}

  onModuleInit(): void {
    this.client = this.grpcClient.getService<BookingClientContract>('BookingService');
  }

  async getSnapshot(
    bookingId: string,
    requestId: string,
    propagationHeaders: Record<string, string>,
  ): Promise<FulfillmentSnapshot> {
    const response = await this.call(
      (client, metadata) => client.getFulfillmentSnapshot({ bookingId, requestId }, metadata),
      requestId,
      propagationHeaders,
    );
    if (!response.snapshot?.owner || !response.snapshot.trip) {
      throw namedError('BookingSnapshotMissing', 'Booking snapshot is incomplete.');
    }
    return {
      bookingId: response.snapshot.bookingId,
      bookingCode: response.snapshot.bookingCode,
      status: mapBookingStatus(response.snapshot.status),
      owner: {
        type: mapOwnerType(response.snapshot.owner.type),
        id: response.snapshot.owner.id,
      },
      contactEmail: response.snapshot.contactEmail,
      trip: response.snapshot.trip,
      passengers: response.snapshot.passengers ?? [],
      totalPriceVnd: response.snapshot.totalPriceVnd,
      paidAt: response.snapshot.paidAt,
    };
  }

  async markTicketIssued(input: {
    bookingId: string;
    sourceEventId: string;
    issuedAt: string;
    ticketCount: number;
    tickets: IssuedTicketReference[];
    requestId: string;
    propagationHeaders: Record<string, string>;
  }): Promise<void> {
    const response = await this.call(
      (client, metadata) =>
        client.markTicketIssued(
          {
            bookingId: input.bookingId,
            sourceEventId: input.sourceEventId,
            issuedAt: input.issuedAt,
            ticketCount: input.ticketCount,
            tickets: input.tickets,
            requestId: input.requestId,
          },
          metadata,
        ),
      input.requestId,
      input.propagationHeaders,
    );
    if (!['TICKET_ISSUED', 'CHECKED_IN', 'COMPLETED'].includes(mapBookingStatus(response.status))) {
      throw namedError('BookingTicketTransitionFailed', 'Booking did not accept ticket issuance.');
    }
  }

  private async call<T>(
    operation: (client: BookingClientContract, metadata: Metadata) => Observable<T>,
    inboundRequestId: string,
    propagationHeaders: Record<string, string>,
  ): Promise<T> {
    if (!this.client)
      throw namedError('BookingDependencyUnavailable', 'Booking client is unavailable.');
    const requestId = createRequestId(inboundRequestId);
    const metadata = new Metadata();
    metadata.set('x-request-id', requestId);
    metadata.set('x-actor-category', 'SYSTEM');
    metadata.set('x-actor-id', SYSTEM_ACTOR_ID);
    for (const [key, value] of Object.entries({
      ...activePropagationHeaders(),
      ...propagationHeaders,
    })) {
      if (key === 'traceparent' || key === 'tracestate' || key === 'baggage')
        metadata.set(key, value);
    }
    return firstValueFrom(operation(this.client, metadata).pipe(timeout(5_000)));
  }
}

function mapOwnerType(value: number | string): 'GUEST_SESSION' | 'CUSTOMER' {
  if (value === 1 || value === 'CHECKOUT_OWNER_TYPE_GUEST_SESSION' || value === 'GUEST_SESSION') {
    return 'GUEST_SESSION';
  }
  if (value === 2 || value === 'CHECKOUT_OWNER_TYPE_CUSTOMER' || value === 'CUSTOMER') {
    return 'CUSTOMER';
  }
  throw namedError('BookingSnapshotInvalidOwner', 'Booking owner type is invalid.');
}

function mapBookingStatus(
  value: number | string,
): 'PAID' | 'TICKET_ISSUED' | 'CHECKED_IN' | 'COMPLETED' | 'CANCELLED' {
  const mapping = new Map<
    number | string,
    'PAID' | 'TICKET_ISSUED' | 'CHECKED_IN' | 'COMPLETED' | 'CANCELLED'
  >([
    [3, 'PAID'],
    ['BOOKING_STATUS_PAID', 'PAID'],
    ['PAID', 'PAID'],
    [4, 'TICKET_ISSUED'],
    ['BOOKING_STATUS_TICKET_ISSUED', 'TICKET_ISSUED'],
    ['TICKET_ISSUED', 'TICKET_ISSUED'],
    [5, 'CHECKED_IN'],
    ['BOOKING_STATUS_CHECKED_IN', 'CHECKED_IN'],
    ['CHECKED_IN', 'CHECKED_IN'],
    [6, 'COMPLETED'],
    ['BOOKING_STATUS_COMPLETED', 'COMPLETED'],
    ['COMPLETED', 'COMPLETED'],
    [8, 'CANCELLED'],
    ['BOOKING_STATUS_CANCELLED', 'CANCELLED'],
    ['CANCELLED', 'CANCELLED'],
  ]);
  const status = mapping.get(value);
  if (!status) throw namedError('BookingSnapshotInvalidStatus', 'Booking status is invalid.');
  return status;
}

function namedError(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}
