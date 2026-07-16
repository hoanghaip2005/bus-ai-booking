import { activePropagationHeaders, createRequestId, logEvent } from '@bus/observability';
import { Metadata, status } from '@grpc/grpc-js';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom, type Observable, timeout } from 'rxjs';

export interface BookingGatewayOwner {
  type: 'GUEST_SESSION' | 'CUSTOMER';
  id: string;
}

export interface BookingGatewayActor {
  id: string;
  role: 'CUSTOMER';
  tokenId: string;
}

export interface BookingOperationsActor {
  id: string;
  role: 'STAFF' | 'ADMIN';
  tokenId: string;
}

export type StaffTicketCredentialKind = 'BOOKING_CODE' | 'TICKET_CODE' | 'QR_PAYLOAD';

export interface StaffTicketGatewayView {
  ticketId: string;
  ticketCode: string;
  bookingId: string;
  bookingCode: string;
  bookingStatus: number | string;
  passengerId: string;
  passengerName: string;
  seatId: string;
  tripId: string;
  routeLabel: string;
  departureAt: string;
  checkedInAt?: string;
}

export interface CreateBookingGatewayInput {
  holdToken: string;
  owner: BookingGatewayOwner;
  contact: { fullName: string; email: string; phone: string };
  passengers: Array<{
    seatId: string;
    fullName: string;
    phone?: string | null;
    documentNumber?: string | null;
  }>;
  idempotencyKey: string;
  actor?: BookingGatewayActor;
}

export interface BookingGatewayResponse {
  booking?: {
    id: string;
    bookingCode: string;
    status: number | string;
    trip?: {
      tripId: string;
      routeId: string;
      routeCode: string;
      operatorName: string;
      vehicleTypeName: string;
      vehicleCode: string;
      vehiclePlate: string;
      originName: string;
      destinationName: string;
      pickupName: string;
      dropoffName: string;
      departureAt: string;
      arrivalAt: string;
      timezone: string;
      unitPriceVnd: number;
    };
    contact?: { fullName: string; email: string; phone: string };
    passengers?: Array<{
      id: string;
      seatId: string;
      fullName: string;
      phone?: string;
      hasDocumentNumber: boolean;
    }>;
    totalPriceVnd: number;
    holdExpiresAt: string;
    createdAt: string;
  };
  requestId: string;
}

export interface SimulatePaymentGatewayInput {
  bookingId: string;
  owner: BookingGatewayOwner;
  outcome: 'SUCCESS' | 'FAILURE';
  idempotencyKey: string;
  actor?: BookingGatewayActor;
}

export interface MyBookingsGatewayResponse {
  bookings: NonNullable<BookingGatewayResponse['booking']>[];
  nextCursor?: string;
  requestId: string;
}

export interface AdminOperationsGatewayResponse {
  bookings: NonNullable<BookingGatewayResponse['booking']>[];
  summary?: {
    bookingCount: number;
    passengerCount: number;
    revenueVnd: number | string;
    statusCounts?: Array<{ status: number | string; count: number }>;
  };
  auditEvents?: Array<{
    id: string;
    action: string;
    targetType: string;
    targetId: string;
    actorId: string;
    actorRole: string;
    occurredAt: string;
    requestId: string;
    traceId: string;
  }>;
  requestId: string;
}

export interface SimulatePaymentGatewayResponse {
  result?: {
    paymentAttemptId: string;
    status: number | string;
    booking?: NonNullable<BookingGatewayResponse['booking']>;
    failureCode?: string;
    processedAt: string;
  };
  requestId: string;
}

export interface CancelBookingGatewayResponse {
  result?: {
    booking?: NonNullable<BookingGatewayResponse['booking']>;
    cancelledAt: string;
    policyCode: string;
    seatsReleased: boolean;
  };
  requestId: string;
}

export interface GuestBookingLookupGatewayResponse {
  booking?: {
    bookingCode: string;
    status: number | string;
    tripId: string;
    originName: string;
    destinationName: string;
    departureAt: string;
    timezone: string;
    seatIds?: string[];
    ticketIssued: boolean;
    cancellationEligible: boolean;
  };
  requestId: string;
}

interface BookingHealthResponse {
  service: string;
  status: string;
  version: string;
  requestId: string;
  traceId: string;
  checkedAt: string;
}

interface BookingClientContract {
  health(input: { requestId: string }, metadata?: Metadata): Observable<BookingHealthResponse>;
  createBooking(
    input: {
      holdToken: string;
      owner: { type: 1 | 2; id: string };
      contact: CreateBookingGatewayInput['contact'];
      passengers: Array<{
        seatId: string;
        fullName: string;
        phone?: string;
        documentNumber?: string;
      }>;
      idempotencyKey: string;
      requestId: string;
    },
    metadata?: Metadata,
  ): Observable<BookingGatewayResponse>;
  simulatePayment(
    input: {
      bookingId: string;
      owner: { type: 1 | 2; id: string };
      outcome: 1 | 2;
      idempotencyKey: string;
      requestId: string;
    },
    metadata?: Metadata,
  ): Observable<SimulatePaymentGatewayResponse>;
  listMyBookings(
    input: { pageSize: number; cursor?: string; requestId: string },
    metadata?: Metadata,
  ): Observable<MyBookingsGatewayResponse>;
  cancelBooking(
    input: { bookingId: string; idempotencyKey: string; requestId: string },
    metadata?: Metadata,
  ): Observable<CancelBookingGatewayResponse>;
  staffTicketLookup(
    input: { kind: 1 | 2 | 3; credential: string; requestId: string },
    metadata?: Metadata,
  ): Observable<{ tickets?: StaffTicketGatewayView[]; requestId: string }>;
  checkInTicket(
    input: {
      kind: 2 | 3;
      credential: string;
      tripId: string;
      idempotencyKey: string;
      requestId: string;
    },
    metadata?: Metadata,
  ): Observable<{ ticket?: StaffTicketGatewayView; transitioned: boolean; requestId: string }>;
  getAdminOperations(
    input: { tripId?: string; bookingLimit: number; auditLimit: number; requestId: string },
    metadata?: Metadata,
  ): Observable<AdminOperationsGatewayResponse>;
  getGuestBookingLookup(
    input: { bookingCode: string; normalizedEmail: string; requestId: string },
    metadata?: Metadata,
  ): Observable<GuestBookingLookupGatewayResponse>;
}

export class BookingDependencyError extends Error {
  constructor(
    readonly requestId: string,
    options?: ErrorOptions,
  ) {
    super('Booking Service is unavailable.', options);
    this.name = 'BookingDependencyError';
  }
}

export class BookingValidationGatewayError extends Error {
  constructor(
    readonly requestId: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'BookingValidationGatewayError';
  }
}

export class BookingHoldExpiredGatewayError extends Error {
  constructor(
    readonly requestId: string,
    options?: ErrorOptions,
  ) {
    super('Seat hold is no longer active.', options);
    this.name = 'BookingHoldExpiredGatewayError';
  }
}

export class BookingForbiddenGatewayError extends Error {
  constructor(
    readonly requestId: string,
    options?: ErrorOptions,
  ) {
    super('Seat hold is unavailable.', options);
    this.name = 'BookingForbiddenGatewayError';
  }
}

export class BookingIdempotencyGatewayError extends Error {
  constructor(
    readonly requestId: string,
    options?: ErrorOptions,
  ) {
    super('Idempotency key conflicts with an earlier booking request.', options);
    this.name = 'BookingIdempotencyGatewayError';
  }
}

export class BookingTripNotFoundGatewayError extends Error {
  constructor(
    readonly requestId: string,
    options?: ErrorOptions,
  ) {
    super('Trip was not found.', options);
    this.name = 'BookingTripNotFoundGatewayError';
  }
}

export class BookingInvalidStateGatewayError extends Error {
  constructor(
    readonly requestId: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'BookingInvalidStateGatewayError';
  }
}

export class BookingSeatUnavailableGatewayError extends Error {
  constructor(
    readonly requestId: string,
    options?: ErrorOptions,
  ) {
    super('One or more seats are unavailable for this booking.', options);
    this.name = 'BookingSeatUnavailableGatewayError';
  }
}

export class BookingCancellationPolicyGatewayError extends Error {
  constructor(
    readonly requestId: string,
    options?: ErrorOptions,
  ) {
    super('Booking can only be cancelled before departure.', options);
    this.name = 'BookingCancellationPolicyGatewayError';
  }
}

export class BookingTicketNotFoundGatewayError extends Error {
  constructor(
    readonly requestId: string,
    options?: ErrorOptions,
  ) {
    super('Ticket was not found.', options);
    this.name = 'BookingTicketNotFoundGatewayError';
  }
}

export class BookingWrongTripGatewayError extends Error {
  constructor(
    readonly requestId: string,
    options?: ErrorOptions,
  ) {
    super('Ticket does not belong to the selected trip.', options);
    this.name = 'BookingWrongTripGatewayError';
  }
}

export class BookingLookupNotFoundGatewayError extends Error {
  constructor(
    readonly requestId: string,
    options?: ErrorOptions,
  ) {
    super('Booking lookup credentials are invalid.', options);
    this.name = 'BookingLookupNotFoundGatewayError';
  }
}

@Injectable()
export class BookingGatewayService implements OnModuleInit {
  private client?: BookingClientContract;

  constructor(@Inject('BOOKING_GRPC') private readonly grpcClient: ClientGrpc) {}

  onModuleInit(): void {
    this.client = this.grpcClient.getService<BookingClientContract>('BookingService');
  }

  async check(inboundRequestId?: string): Promise<BookingHealthResponse> {
    const requestId = createRequestId(inboundRequestId);
    try {
      return await this.call(
        (client, metadata) => client.health({ requestId }, metadata),
        requestId,
      );
    } catch (error) {
      throw new BookingDependencyError(requestId, { cause: error });
    }
  }

  async createBooking(
    input: CreateBookingGatewayInput,
    inboundRequestId?: string,
  ): Promise<BookingGatewayResponse> {
    const requestId = createRequestId(inboundRequestId);
    try {
      const response = await this.call(
        (client, metadata) =>
          client.createBooking(
            {
              holdToken: input.holdToken,
              owner: { type: input.owner.type === 'GUEST_SESSION' ? 1 : 2, id: input.owner.id },
              contact: input.contact,
              passengers: input.passengers.map((passenger) => ({
                seatId: passenger.seatId,
                fullName: passenger.fullName,
                ...(passenger.phone ? { phone: passenger.phone } : {}),
                ...(passenger.documentNumber ? { documentNumber: passenger.documentNumber } : {}),
              })),
              idempotencyKey: input.idempotencyKey,
              requestId,
            },
            metadata,
          ),
        requestId,
        input.actor,
      );
      if (!response.booking?.trip || !response.booking.contact) {
        throw new BookingDependencyError(requestId);
      }
      return {
        ...response,
        booking: {
          ...response.booking,
          passengers: response.booking.passengers ?? [],
        },
      };
    } catch (error) {
      if (error instanceof BookingDependencyError) throw error;
      if (isGrpcCode(error, status.INVALID_ARGUMENT)) {
        throw new BookingValidationGatewayError(requestId, grpcDetails(error), { cause: error });
      }
      if (isGrpcCode(error, status.FAILED_PRECONDITION)) {
        throw new BookingHoldExpiredGatewayError(requestId, { cause: error });
      }
      if (isGrpcCode(error, status.PERMISSION_DENIED)) {
        throw new BookingForbiddenGatewayError(requestId, { cause: error });
      }
      if (isGrpcCode(error, status.ABORTED)) {
        throw new BookingIdempotencyGatewayError(requestId, { cause: error });
      }
      if (isGrpcCode(error, status.NOT_FOUND)) {
        throw new BookingTripNotFoundGatewayError(requestId, { cause: error });
      }
      logEvent({
        service: 'graphql-gateway',
        level: 'error',
        event: 'booking.create.failed',
        message: 'Booking creation failed.',
        requestId,
        fields: {
          dependency: 'booking-service',
          ownerType: input.owner.type,
          passengerCount: input.passengers.length,
        },
      });
      throw new BookingDependencyError(requestId, { cause: error });
    }
  }

  async listMyBookings(
    pageSize: number,
    cursor: string | undefined,
    actor: BookingGatewayActor,
    inboundRequestId?: string,
  ): Promise<MyBookingsGatewayResponse> {
    const requestId = createRequestId(inboundRequestId);
    try {
      const response = await this.call(
        (client, metadata) =>
          client.listMyBookings({ pageSize, ...(cursor ? { cursor } : {}), requestId }, metadata),
        requestId,
        actor,
      );
      return {
        ...response,
        bookings: (response.bookings ?? []).map((booking) => ({
          ...booking,
          passengers: booking.passengers ?? [],
        })),
      };
    } catch (error) {
      if (isGrpcCode(error, status.INVALID_ARGUMENT)) {
        throw new BookingValidationGatewayError(requestId, grpcDetails(error), { cause: error });
      }
      if (isGrpcCode(error, status.PERMISSION_DENIED)) {
        throw new BookingForbiddenGatewayError(requestId, { cause: error });
      }
      throw new BookingDependencyError(requestId, { cause: error });
    }
  }

  async getGuestBookingLookup(
    bookingCode: string,
    normalizedEmail: string,
    inboundRequestId?: string,
  ): Promise<GuestBookingLookupGatewayResponse> {
    const requestId = createRequestId(inboundRequestId);
    try {
      const response = await this.call(
        (client, metadata) =>
          client.getGuestBookingLookup({ bookingCode, normalizedEmail, requestId }, metadata),
        requestId,
      );
      if (!response.booking) throw new BookingDependencyError(requestId);
      return {
        ...response,
        booking: { ...response.booking, seatIds: response.booking.seatIds ?? [] },
      };
    } catch (error) {
      if (error instanceof BookingDependencyError) throw error;
      if (isGrpcCode(error, status.INVALID_ARGUMENT)) {
        throw new BookingValidationGatewayError(
          requestId,
          'Booking lookup credentials are invalid.',
          { cause: error },
        );
      }
      if (isGrpcCode(error, status.NOT_FOUND)) {
        throw new BookingLookupNotFoundGatewayError(requestId, { cause: error });
      }
      logEvent({
        service: 'graphql-gateway',
        level: 'error',
        event: 'booking.guest-lookup.failed',
        message: 'Guest booking lookup failed.',
        requestId,
        fields: { dependency: 'booking-service' },
      });
      throw new BookingDependencyError(requestId, { cause: error });
    }
  }

  async simulatePayment(
    input: SimulatePaymentGatewayInput,
    inboundRequestId?: string,
  ): Promise<SimulatePaymentGatewayResponse> {
    const requestId = createRequestId(inboundRequestId);
    try {
      const response = await this.call(
        (client, metadata) =>
          client.simulatePayment(
            {
              bookingId: input.bookingId,
              owner: { type: input.owner.type === 'GUEST_SESSION' ? 1 : 2, id: input.owner.id },
              outcome: input.outcome === 'SUCCESS' ? 1 : 2,
              idempotencyKey: input.idempotencyKey,
              requestId,
            },
            metadata,
          ),
        requestId,
        input.actor,
      );
      if (!response.result?.booking) throw new BookingDependencyError(requestId);
      return response;
    } catch (error) {
      if (error instanceof BookingDependencyError) throw error;
      if (isGrpcCode(error, status.INVALID_ARGUMENT)) {
        throw new BookingValidationGatewayError(requestId, grpcDetails(error), { cause: error });
      }
      if (isGrpcCode(error, status.FAILED_PRECONDITION)) {
        const details = grpcDetails(error);
        if (details.startsWith('INVALID_STATE_TRANSITION:')) {
          throw new BookingInvalidStateGatewayError(
            requestId,
            details.replace('INVALID_STATE_TRANSITION:', '').trim(),
            { cause: error },
          );
        }
        throw new BookingHoldExpiredGatewayError(requestId, { cause: error });
      }
      if (isGrpcCode(error, status.PERMISSION_DENIED)) {
        throw new BookingForbiddenGatewayError(requestId, { cause: error });
      }
      if (isGrpcCode(error, status.ABORTED)) {
        throw new BookingIdempotencyGatewayError(requestId, { cause: error });
      }
      if (isGrpcCode(error, status.ALREADY_EXISTS)) {
        throw new BookingSeatUnavailableGatewayError(requestId, { cause: error });
      }
      logEvent({
        service: 'graphql-gateway',
        level: 'error',
        event: 'booking.simulate-payment.failed',
        message: 'Simulated payment failed.',
        requestId,
        fields: {
          dependency: 'booking-service',
          bookingId: input.bookingId,
          ownerType: input.owner.type,
        },
      });
      throw new BookingDependencyError(requestId, { cause: error });
    }
  }

  async cancelBooking(
    bookingId: string,
    idempotencyKey: string,
    actor: BookingGatewayActor,
    inboundRequestId?: string,
  ): Promise<CancelBookingGatewayResponse> {
    const requestId = createRequestId(inboundRequestId);
    try {
      const response = await this.call(
        (client, metadata) =>
          client.cancelBooking({ bookingId, idempotencyKey, requestId }, metadata),
        requestId,
        actor,
      );
      if (!response.result?.booking?.trip || !response.result.booking.contact) {
        throw new BookingDependencyError(requestId);
      }
      return {
        ...response,
        result: {
          ...response.result,
          booking: {
            ...response.result.booking,
            passengers: response.result.booking.passengers ?? [],
          },
        },
      };
    } catch (error) {
      if (error instanceof BookingDependencyError) throw error;
      if (isGrpcCode(error, status.INVALID_ARGUMENT)) {
        throw new BookingValidationGatewayError(requestId, grpcDetails(error), { cause: error });
      }
      if (isGrpcCode(error, status.PERMISSION_DENIED)) {
        throw new BookingForbiddenGatewayError(requestId, { cause: error });
      }
      if (isGrpcCode(error, status.ABORTED)) {
        throw new BookingIdempotencyGatewayError(requestId, { cause: error });
      }
      if (isGrpcCode(error, status.FAILED_PRECONDITION)) {
        const details = grpcDetails(error);
        if (details.startsWith('CANCELLATION_NOT_ALLOWED:')) {
          throw new BookingCancellationPolicyGatewayError(requestId, { cause: error });
        }
        throw new BookingInvalidStateGatewayError(
          requestId,
          details.replace('INVALID_STATE_TRANSITION:', '').trim(),
          { cause: error },
        );
      }
      throw new BookingDependencyError(requestId, { cause: error });
    }
  }

  async staffTicketLookup(
    kind: StaffTicketCredentialKind,
    credential: string,
    actor: BookingOperationsActor,
    inboundRequestId?: string,
  ): Promise<{ tickets: StaffTicketGatewayView[]; requestId: string }> {
    const requestId = createRequestId(inboundRequestId);
    try {
      const response = await this.call(
        (client, metadata) =>
          client.staffTicketLookup(
            { kind: mapStaffTicketCredentialKind(kind), credential, requestId },
            metadata,
          ),
        requestId,
        actor,
      );
      return { ...response, tickets: response.tickets ?? [] };
    } catch (error) {
      if (isGrpcCode(error, status.INVALID_ARGUMENT)) {
        throw new BookingValidationGatewayError(requestId, grpcDetails(error), { cause: error });
      }
      if (isGrpcCode(error, status.PERMISSION_DENIED)) {
        throw new BookingForbiddenGatewayError(requestId, { cause: error });
      }
      throw new BookingDependencyError(requestId, { cause: error });
    }
  }

  async checkInTicket(
    input: {
      kind: Exclude<StaffTicketCredentialKind, 'BOOKING_CODE'>;
      credential: string;
      tripId: string;
      idempotencyKey: string;
    },
    actor: BookingOperationsActor,
    inboundRequestId?: string,
  ): Promise<{ ticket: StaffTicketGatewayView; transitioned: boolean; requestId: string }> {
    const requestId = createRequestId(inboundRequestId);
    try {
      const response = await this.call(
        (client, metadata) =>
          client.checkInTicket(
            {
              kind: input.kind === 'TICKET_CODE' ? 2 : 3,
              credential: input.credential,
              tripId: input.tripId,
              idempotencyKey: input.idempotencyKey,
              requestId,
            },
            metadata,
          ),
        requestId,
        actor,
      );
      if (!response.ticket) throw new BookingDependencyError(requestId);
      return { ...response, ticket: response.ticket };
    } catch (error) {
      if (error instanceof BookingDependencyError) throw error;
      if (isGrpcCode(error, status.INVALID_ARGUMENT)) {
        throw new BookingValidationGatewayError(requestId, grpcDetails(error), { cause: error });
      }
      if (isGrpcCode(error, status.PERMISSION_DENIED)) {
        throw new BookingForbiddenGatewayError(requestId, { cause: error });
      }
      if (isGrpcCode(error, status.NOT_FOUND)) {
        throw new BookingTicketNotFoundGatewayError(requestId, { cause: error });
      }
      if (isGrpcCode(error, status.ABORTED)) {
        throw new BookingIdempotencyGatewayError(requestId, { cause: error });
      }
      if (isGrpcCode(error, status.FAILED_PRECONDITION)) {
        const details = grpcDetails(error);
        if (details.startsWith('WRONG_TRIP:')) {
          throw new BookingWrongTripGatewayError(requestId, { cause: error });
        }
        throw new BookingInvalidStateGatewayError(
          requestId,
          details.replace('INVALID_STATE_TRANSITION:', '').trim(),
          { cause: error },
        );
      }
      throw new BookingDependencyError(requestId, { cause: error });
    }
  }

  async getAdminOperations(
    input: { tripId?: string; bookingLimit: number; auditLimit: number },
    actor: BookingOperationsActor,
    inboundRequestId?: string,
  ): Promise<
    Required<
      Pick<AdminOperationsGatewayResponse, 'bookings' | 'summary' | 'auditEvents' | 'requestId'>
    >
  > {
    const requestId = createRequestId(inboundRequestId);
    try {
      const response = await this.call(
        (client, metadata) => client.getAdminOperations({ ...input, requestId }, metadata),
        requestId,
        actor,
      );
      return {
        bookings: response.bookings ?? [],
        summary: response.summary ?? {
          bookingCount: 0,
          passengerCount: 0,
          revenueVnd: 0,
          statusCounts: [],
        },
        auditEvents: response.auditEvents ?? [],
        requestId: response.requestId,
      };
    } catch (error) {
      if (isGrpcCode(error, status.INVALID_ARGUMENT)) {
        throw new BookingValidationGatewayError(requestId, grpcDetails(error), { cause: error });
      }
      if (isGrpcCode(error, status.PERMISSION_DENIED)) {
        throw new BookingForbiddenGatewayError(requestId, { cause: error });
      }
      throw new BookingDependencyError(requestId, { cause: error });
    }
  }

  private async call<T>(
    operation: (client: BookingClientContract, metadata: Metadata) => Observable<T>,
    requestId: string,
    actor?: BookingGatewayActor | BookingOperationsActor,
  ): Promise<T> {
    if (!this.client) throw new BookingDependencyError(requestId);
    const metadata = new Metadata();
    metadata.set('x-request-id', requestId);
    if (actor) {
      metadata.set('x-actor-id', actor.id);
      metadata.set('x-actor-role', actor.role);
      metadata.set('x-actor-token-id', actor.tokenId);
    }
    for (const [key, value] of Object.entries(activePropagationHeaders())) metadata.set(key, value);
    return firstValueFrom(operation(this.client, metadata).pipe(timeout(3_000)));
  }
}

function mapStaffTicketCredentialKind(kind: StaffTicketCredentialKind): 1 | 2 | 3 {
  if (kind === 'BOOKING_CODE') return 1;
  if (kind === 'TICKET_CODE') return 2;
  return 3;
}

function isGrpcCode(error: unknown, code: number): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

function grpcDetails(error: unknown): string {
  return typeof error === 'object' && error !== null && 'details' in error
    ? String(error.details)
    : 'Booking input is invalid.';
}
