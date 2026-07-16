import {
  currentTraceContext,
  createRequestId,
  logEvent,
  withRequestContext,
} from '@bus/observability';
import type { Metadata } from '@grpc/grpc-js';
import { status } from '@grpc/grpc-js';
import { Controller, Get, Inject, Req, ServiceUnavailableException } from '@nestjs/common';
import { GrpcMethod, RpcException } from '@nestjs/microservices';

import { CatalogDependencyError, CatalogTripNotFoundError } from './catalog.client';
import { PaymentDependencyError, PaymentIdempotencyError } from './payment.client';
import type {
  BookingView,
  BookingPassengerInput,
  CheckoutOwner,
  CreateBookingRequest,
  StaffActor,
  StaffTicketCredentialKind,
} from './booking.types';
import type { RequestWithContext } from './request-context.middleware';
import {
  BookingIdempotencyConflictError,
  BookingCancellationPolicyError,
  BookingInvalidStateTransitionError,
  BookingCheckInForbiddenError,
  BookingAdminForbiddenError,
  BookingPaymentForbiddenError,
  BookingService,
  BookingValidationError,
  BookingTicketNotFoundError,
  BookingLookupNotFoundError,
  BookingWrongTripError,
  type CreateBookingResponse,
  type CancelBookingRequest,
  type CancelBookingResponse,
  type HealthRequest,
  type HealthResponse,
  type ListMyBookingsRequest,
  type ListMyBookingsResponse,
  type GetGuestBookingLookupRequest,
  type GetGuestBookingLookupResponse,
  type GetFulfillmentSnapshotRequest,
  type MarkTicketIssuedRequest,
  type MarkTicketIssuedResponse,
  type StaffTicketLookupRequest,
  type StaffTicketLookupResponse,
  type CheckInTicketRequest,
  type CheckInTicketResponse,
  type GetAdminOperationsRequest,
  type GetAdminOperationsResponse,
  type SimulatePaymentRequest,
  type SimulatePaymentResponse,
} from './booking.service';
import {
  BookingHoldExpiredError,
  BookingHoldForbiddenError,
  BookingSeatIdempotencyError,
  BookingSeatUnavailableError,
  SeatInventoryDependencyError,
} from './seat-inventory.client';

type GrpcCheckoutOwner = { type?: number | string; id?: string };
type GrpcPassengerInput = Partial<BookingPassengerInput>;
type GrpcCreateBookingRequest = Omit<CreateBookingRequest, 'owner' | 'passengers'> & {
  owner?: GrpcCheckoutOwner;
  passengers?: GrpcPassengerInput[];
};
type GrpcCreateBookingResponse = Omit<CreateBookingResponse, 'booking'> & {
  booking: Omit<BookingView, 'status'> & { status: 2 };
};
type GrpcSimulatePaymentRequest = Omit<SimulatePaymentRequest, 'owner' | 'outcome'> & {
  owner?: GrpcCheckoutOwner;
  outcome?: number | string;
};
type GrpcSimulatePaymentResponse = Omit<SimulatePaymentResponse, 'result'> & {
  result: Omit<SimulatePaymentResponse['result'], 'status' | 'booking'> & {
    status: 1 | 2;
    booking: Omit<BookingView, 'status'> & { status: number };
  };
};
type GrpcGetFulfillmentSnapshotResponse = {
  snapshot: {
    bookingId: string;
    bookingCode: string;
    status: number;
    owner: { type: 1 | 2; id: string };
    contactEmail: string;
    trip: BookingView['trip'];
    passengers: BookingView['passengers'];
    totalPriceVnd: number;
    paidAt: string;
  };
  requestId: string;
};
type GrpcListMyBookingsResponse = Omit<ListMyBookingsResponse, 'bookings'> & {
  bookings: Array<Omit<BookingView, 'status'> & { status: number }>;
};
type GrpcCancelBookingResponse = Omit<CancelBookingResponse, 'result'> & {
  result: Omit<CancelBookingResponse['result'], 'booking'> & {
    booking: Omit<BookingView, 'status'> & { status: number };
  };
};
type GrpcStaffTicketLookupRequest = Omit<StaffTicketLookupRequest, 'kind' | 'actor'> & {
  kind?: number | string;
};
type GrpcCheckInTicketRequest = Omit<CheckInTicketRequest, 'kind' | 'actor'> & {
  kind?: number | string;
};

@Controller()
export class BookingController {
  constructor(@Inject(BookingService) private readonly bookingService: BookingService) {}

  @Get('health')
  httpHealth(@Req() request: RequestWithContext): HealthResponse {
    return this.httpLiveness(request);
  }

  @Get('health/live')
  httpLiveness(@Req() request: RequestWithContext): HealthResponse {
    return this.bookingService.health(
      { requestId: request.requestId },
      currentTraceContext().traceId ?? 'unavailable',
    );
  }

  @Get('health/ready')
  async httpReadiness(@Req() request: RequestWithContext): Promise<HealthResponse> {
    try {
      return await this.bookingService.readiness(
        { requestId: request.requestId },
        currentTraceContext().traceId ?? 'unavailable',
      );
    } catch {
      logEvent({
        service: 'booking-service',
        level: 'error',
        event: 'booking.readiness.failed',
        message: 'Booking readiness check failed.',
        requestId: request.requestId,
        fields: { dependencies: ['postgresql', 'catalog-service', 'seat-inventory-service'] },
      });
      throw new ServiceUnavailableException({
        code: 'DEPENDENCY_UNAVAILABLE',
        message: 'Booking dependencies are unavailable.',
      });
    }
  }

  @GrpcMethod('BookingService', 'Health')
  async grpcHealth(request: HealthRequest, metadata: Metadata): Promise<HealthResponse> {
    const requestId = grpcRequestId(request.requestId, metadata);
    return withRequestContext(requestId, async () => {
      try {
        return await this.bookingService.readiness(
          { requestId },
          currentTraceContext().traceId ?? 'unavailable',
        );
      } catch {
        throw new RpcException({ code: status.UNAVAILABLE, message: 'Booking unavailable.' });
      }
    });
  }

  @GrpcMethod('BookingService', 'CreateBooking')
  async grpcCreateBooking(
    request: GrpcCreateBookingRequest,
    metadata: Metadata,
  ): Promise<GrpcCreateBookingResponse> {
    const requestId = grpcRequestId(request.requestId, metadata);
    return withRequestContext(requestId, async () => {
      const startedAt = performance.now();
      try {
        assertCustomerOwner(metadata, request.owner);
        const response = await this.bookingService.createBooking({
          ...request,
          owner: mapOwner(request.owner),
          passengers: request.passengers,
          requestId,
        });
        logEvent({
          service: 'booking-service',
          event: 'grpc.booking.create-booking',
          message: 'Guest booking created or replayed.',
          requestId,
          fields: {
            rpc: 'BookingService.CreateBooking',
            bookingId: response.booking.id,
            status: response.booking.status,
            seatCount: response.booking.passengers.length,
            ownerType: request.owner?.type,
            durationMs: Math.round(performance.now() - startedAt),
          },
        });
        return { ...response, booking: { ...response.booking, status: 2 } };
      } catch (error) {
        logEvent({
          service: 'booking-service',
          level:
            error instanceof BookingValidationError ||
            error instanceof BookingHoldExpiredError ||
            error instanceof BookingHoldForbiddenError
              ? 'warn'
              : 'error',
          event: 'grpc.booking.create-booking.rejected',
          message: 'Guest booking creation was rejected.',
          requestId,
          fields: {
            rpc: 'BookingService.CreateBooking',
            reason: error instanceof Error ? error.name : 'UnknownError',
            ownerType: request.owner?.type,
            passengerCount: request.passengers?.length ?? 0,
            durationMs: Math.round(performance.now() - startedAt),
          },
        });
        throwBookingError(error);
      }
    });
  }

  @GrpcMethod('BookingService', 'SimulatePayment')
  async grpcSimulatePayment(
    request: GrpcSimulatePaymentRequest,
    metadata: Metadata,
  ): Promise<GrpcSimulatePaymentResponse> {
    const requestId = grpcRequestId(request.requestId, metadata);
    return withRequestContext(requestId, async () => {
      const startedAt = performance.now();
      try {
        assertCustomerOwner(metadata, request.owner);
        const response = await this.bookingService.simulatePayment({
          ...request,
          owner: mapOwner(request.owner),
          outcome: mapPaymentOutcome(request.outcome),
          requestId,
        });
        logEvent({
          service: 'booking-service',
          event: 'grpc.booking.simulate-payment',
          message: 'Simulated payment processed.',
          requestId,
          fields: {
            rpc: 'BookingService.SimulatePayment',
            bookingId: response.result.booking.id,
            paymentAttemptId: response.result.paymentAttemptId,
            paymentStatus: response.result.status,
            bookingStatus: response.result.booking.status,
            ownerType: request.owner?.type,
            durationMs: Math.round(performance.now() - startedAt),
          },
        });
        return {
          ...response,
          result: {
            ...response.result,
            status: response.result.status === 'SUCCEEDED' ? 1 : 2,
            booking: {
              ...response.result.booking,
              status: mapBookingStatus(response.result.booking.status),
            },
          },
        };
      } catch (error) {
        logEvent({
          service: 'booking-service',
          level:
            error instanceof BookingValidationError ||
            error instanceof BookingHoldExpiredError ||
            error instanceof BookingPaymentForbiddenError ||
            error instanceof BookingInvalidStateTransitionError
              ? 'warn'
              : 'error',
          event: 'grpc.booking.simulate-payment.rejected',
          message: 'Simulated payment was rejected.',
          requestId,
          fields: {
            rpc: 'BookingService.SimulatePayment',
            bookingId: request.bookingId,
            reason: error instanceof Error ? error.name : 'UnknownError',
            ownerType: request.owner?.type,
            durationMs: Math.round(performance.now() - startedAt),
          },
        });
        throwBookingError(error);
      }
    });
  }

  @GrpcMethod('BookingService', 'ListMyBookings')
  async grpcListMyBookings(
    request: Omit<ListMyBookingsRequest, 'customerId'>,
    metadata: Metadata,
  ): Promise<GrpcListMyBookingsResponse> {
    const requestId = grpcRequestId(request.requestId, metadata);
    const customerId = requireCustomerActor(metadata);
    return withRequestContext(requestId, async () => {
      try {
        const response = await this.bookingService.listMyBookings({
          ...request,
          customerId,
          requestId,
        });
        logEvent({
          service: 'booking-service',
          event: 'grpc.booking.list-my-bookings',
          message: 'Customer booking history returned.',
          requestId,
          fields: {
            rpc: 'BookingService.ListMyBookings',
            actorId: customerId,
            resultCount: response.bookings.length,
            hasNextPage: Boolean(response.nextCursor),
          },
        });
        return {
          ...response,
          bookings: response.bookings.map((booking) => ({
            ...booking,
            status: mapBookingStatus(booking.status),
          })),
        };
      } catch (error) {
        throwBookingError(error);
      }
    });
  }

  @GrpcMethod('BookingService', 'CancelBooking')
  async grpcCancelBooking(
    request: Omit<CancelBookingRequest, 'customerId'>,
    metadata: Metadata,
  ): Promise<GrpcCancelBookingResponse> {
    const requestId = grpcRequestId(request.requestId, metadata);
    const customerId = requireCustomerActor(metadata);
    return withRequestContext(requestId, async () => {
      const startedAt = performance.now();
      try {
        const response = await this.bookingService.cancelBooking({
          ...request,
          customerId,
          requestId,
        });
        logEvent({
          service: 'booking-service',
          event: 'grpc.booking.cancel-booking',
          message: 'Customer booking cancelled or replayed.',
          requestId,
          fields: {
            rpc: 'BookingService.CancelBooking',
            bookingId: response.result.booking.id,
            actorId: customerId,
            seatsReleased: response.result.seatsReleased,
            durationMs: Math.round(performance.now() - startedAt),
          },
        });
        return {
          ...response,
          result: {
            ...response.result,
            booking: {
              ...response.result.booking,
              status: mapBookingStatus(response.result.booking.status),
            },
          },
        };
      } catch (error) {
        logEvent({
          service: 'booking-service',
          level:
            error instanceof BookingValidationError ||
            error instanceof BookingPaymentForbiddenError ||
            error instanceof BookingInvalidStateTransitionError ||
            error instanceof BookingCancellationPolicyError
              ? 'warn'
              : 'error',
          event: 'grpc.booking.cancel-booking.rejected',
          message: 'Customer booking cancellation was rejected.',
          requestId,
          fields: {
            rpc: 'BookingService.CancelBooking',
            bookingId: request.bookingId,
            actorId: customerId,
            reason: error instanceof Error ? error.name : 'UnknownError',
            durationMs: Math.round(performance.now() - startedAt),
          },
        });
        throwBookingError(error);
      }
    });
  }

  @GrpcMethod('BookingService', 'GetGuestBookingLookup')
  async grpcGetGuestBookingLookup(
    request: GetGuestBookingLookupRequest,
    metadata: Metadata,
  ): Promise<
    Omit<GetGuestBookingLookupResponse, 'booking'> & {
      booking: Omit<GetGuestBookingLookupResponse['booking'], 'status'> & { status: number };
    }
  > {
    const requestId = grpcRequestId(request.requestId, metadata);
    return withRequestContext(requestId, async () => {
      const startedAt = performance.now();
      try {
        const response = await this.bookingService.getGuestBookingLookup({
          ...request,
          requestId,
        });
        logEvent({
          service: 'booking-service',
          event: 'grpc.booking.guest-lookup',
          message: 'Guest booking lookup returned.',
          requestId,
          fields: {
            rpc: 'BookingService.GetGuestBookingLookup',
            status: response.booking.status,
            durationMs: Math.round(performance.now() - startedAt),
          },
        });
        return {
          ...response,
          booking: { ...response.booking, status: mapBookingStatus(response.booking.status) },
        };
      } catch (error) {
        logEvent({
          service: 'booking-service',
          level: error instanceof BookingValidationError ? 'warn' : 'info',
          event: 'grpc.booking.guest-lookup.rejected',
          message: 'Guest booking lookup was rejected.',
          requestId,
          fields: {
            rpc: 'BookingService.GetGuestBookingLookup',
            reason: error instanceof Error ? error.name : 'UnknownError',
            durationMs: Math.round(performance.now() - startedAt),
          },
        });
        throwBookingError(error);
      }
    });
  }

  @GrpcMethod('BookingService', 'GetFulfillmentSnapshot')
  async grpcGetFulfillmentSnapshot(
    request: GetFulfillmentSnapshotRequest,
    metadata: Metadata,
  ): Promise<GrpcGetFulfillmentSnapshotResponse> {
    assertSystemActor(metadata);
    const requestId = grpcRequestId(request.requestId, metadata);
    return withRequestContext(requestId, async () => {
      try {
        const response = await this.bookingService.getFulfillmentSnapshot({
          ...request,
          requestId,
        });
        return {
          requestId: response.requestId,
          snapshot: {
            bookingId: response.snapshot.booking.id,
            bookingCode: response.snapshot.booking.bookingCode,
            status: mapBookingStatus(response.snapshot.booking.status),
            owner: {
              type: response.snapshot.owner.type === 'GUEST_SESSION' ? 1 : 2,
              id: response.snapshot.owner.id,
            },
            contactEmail: response.snapshot.booking.contact.email,
            trip: response.snapshot.booking.trip,
            passengers: response.snapshot.booking.passengers,
            totalPriceVnd: response.snapshot.booking.totalPriceVnd,
            paidAt: response.snapshot.paidAt,
          },
        };
      } catch (error) {
        throwBookingError(error);
      }
    });
  }

  @GrpcMethod('BookingService', 'MarkTicketIssued')
  async grpcMarkTicketIssued(
    request: MarkTicketIssuedRequest,
    metadata: Metadata,
  ): Promise<Omit<MarkTicketIssuedResponse, 'status'> & { status: number }> {
    assertSystemActor(metadata);
    const requestId = grpcRequestId(request.requestId, metadata);
    return withRequestContext(requestId, async () => {
      try {
        const response = await this.bookingService.markTicketIssued({ ...request, requestId });
        return { ...response, status: mapBookingStatus(response.status) };
      } catch (error) {
        throwBookingError(error);
      }
    });
  }

  @GrpcMethod('BookingService', 'StaffTicketLookup')
  async grpcStaffTicketLookup(
    request: GrpcStaffTicketLookupRequest,
    metadata: Metadata,
  ): Promise<Omit<StaffTicketLookupResponse, 'tickets'> & { tickets: unknown[] }> {
    const requestId = grpcRequestId(request.requestId, metadata);
    const actor = requireStaffActor(metadata);
    return withRequestContext(requestId, async () => {
      const startedAt = performance.now();
      try {
        const response = await this.bookingService.staffTicketLookup({
          ...request,
          kind: mapStaffTicketCredentialKind(request.kind),
          actor,
          requestId,
        });
        logEvent({
          service: 'booking-service',
          event: 'grpc.booking.staff-ticket-lookup',
          message: 'Staff ticket lookup completed.',
          requestId,
          fields: {
            rpc: 'BookingService.StaffTicketLookup',
            actorId: actor.id,
            actorRole: actor.role,
            resultCount: response.tickets.length,
            durationMs: Math.round(performance.now() - startedAt),
          },
        });
        return {
          ...response,
          tickets: response.tickets.map((ticket) => ({
            ...ticket,
            bookingStatus: mapBookingStatus(ticket.bookingStatus),
          })),
        };
      } catch (error) {
        throwBookingError(error);
      }
    });
  }

  @GrpcMethod('BookingService', 'CheckInTicket')
  async grpcCheckInTicket(
    request: GrpcCheckInTicketRequest,
    metadata: Metadata,
  ): Promise<Omit<CheckInTicketResponse, 'ticket'> & { ticket: unknown }> {
    const requestId = grpcRequestId(request.requestId, metadata);
    const actor = requireStaffActor(metadata);
    return withRequestContext(requestId, async () => {
      const startedAt = performance.now();
      try {
        const response = await this.bookingService.checkInTicket({
          ...request,
          kind: mapStaffTicketCredentialKind(request.kind),
          actor,
          requestId,
        });
        logEvent({
          service: 'booking-service',
          event: 'grpc.booking.check-in-ticket',
          message: 'Passenger ticket check-in processed.',
          requestId,
          fields: {
            rpc: 'BookingService.CheckInTicket',
            actorId: actor.id,
            actorRole: actor.role,
            bookingId: response.ticket.bookingId,
            ticketId: response.ticket.ticketId,
            tripId: response.ticket.tripId,
            transitioned: response.transitioned,
            durationMs: Math.round(performance.now() - startedAt),
          },
        });
        return {
          ...response,
          ticket: {
            ...response.ticket,
            bookingStatus: mapBookingStatus(response.ticket.bookingStatus),
          },
        };
      } catch (error) {
        throwBookingError(error);
      }
    });
  }

  @GrpcMethod('BookingService', 'GetAdminOperations')
  async grpcGetAdminOperations(
    request: Omit<GetAdminOperationsRequest, 'actor'>,
    metadata: Metadata,
  ): Promise<
    Omit<GetAdminOperationsResponse, 'bookings' | 'summary'> & {
      bookings: unknown[];
      summary: unknown;
    }
  > {
    const requestId = grpcRequestId(request.requestId, metadata);
    const actor = requireAdminActor(metadata);
    return withRequestContext(requestId, async () => {
      const startedAt = performance.now();
      try {
        const response = await this.bookingService.getAdminOperations({
          ...request,
          actor,
          requestId,
        });
        logEvent({
          service: 'booking-service',
          event: 'grpc.booking.get-admin-operations',
          message: 'Admin operational booking view returned.',
          requestId,
          fields: {
            rpc: 'BookingService.GetAdminOperations',
            actorId: actor.id,
            bookingCount: response.bookings.length,
            auditCount: response.auditEvents.length,
            durationMs: Math.round(performance.now() - startedAt),
          },
        });
        return {
          ...response,
          bookings: response.bookings.map((booking) => ({
            ...booking,
            status: mapBookingStatus(booking.status),
          })),
          summary: {
            ...response.summary,
            statusCounts: response.summary.statusCounts.map((entry) => ({
              ...entry,
              status: mapBookingStatus(entry.status),
            })),
          },
        };
      } catch (error) {
        throwBookingError(error);
      }
    });
  }
}

const SYSTEM_ACTOR_ID = '00000000-0000-4000-8000-000000000001';

function assertSystemActor(metadata: Metadata): void {
  const category = metadata.get('x-actor-category')[0];
  const actorId = metadata.get('x-actor-id')[0];
  if (category !== 'SYSTEM' || actorId !== SYSTEM_ACTOR_ID) {
    throw new RpcException({ code: status.PERMISSION_DENIED, message: 'System actor required.' });
  }
}

function assertCustomerOwner(metadata: Metadata, owner: GrpcCheckoutOwner | undefined): void {
  const mapped = mapOwner(owner);
  if (mapped?.type !== 'CUSTOMER') return;
  const actorId = requireCustomerActor(metadata);
  if (actorId !== mapped.id) {
    throw new RpcException({ code: status.PERMISSION_DENIED, message: 'Customer owner mismatch.' });
  }
}

function requireCustomerActor(metadata: Metadata): string {
  const actorId = metadata.get('x-actor-id')[0];
  const actorRole = metadata.get('x-actor-role')[0];
  const tokenId = metadata.get('x-actor-token-id')[0];
  if (
    actorRole !== 'CUSTOMER' ||
    typeof actorId !== 'string' ||
    !isUuid(actorId) ||
    typeof tokenId !== 'string' ||
    !isUuid(tokenId)
  ) {
    throw new RpcException({ code: status.PERMISSION_DENIED, message: 'Customer actor required.' });
  }
  return actorId;
}

function requireStaffActor(metadata: Metadata): StaffActor {
  const actorId = metadata.get('x-actor-id')[0];
  const actorRole = metadata.get('x-actor-role')[0];
  const tokenId = metadata.get('x-actor-token-id')[0];
  if (
    (actorRole !== 'STAFF' && actorRole !== 'ADMIN') ||
    typeof actorId !== 'string' ||
    !isUuid(actorId) ||
    typeof tokenId !== 'string' ||
    !isUuid(tokenId)
  ) {
    throw new RpcException({ code: status.PERMISSION_DENIED, message: 'Staff actor required.' });
  }
  return { id: actorId, role: actorRole };
}

function requireAdminActor(metadata: Metadata): { id: string; role: 'ADMIN' } {
  const actorId = metadata.get('x-actor-id')[0];
  const actorRole = metadata.get('x-actor-role')[0];
  const tokenId = metadata.get('x-actor-token-id')[0];
  if (
    actorRole !== 'ADMIN' ||
    typeof actorId !== 'string' ||
    !isUuid(actorId) ||
    typeof tokenId !== 'string' ||
    !isUuid(tokenId)
  ) {
    throw new RpcException({ code: status.PERMISSION_DENIED, message: 'Admin actor required.' });
  }
  return { id: actorId, role: 'ADMIN' };
}

function grpcRequestId(requestId: string | undefined, metadata: Metadata): string {
  const metadataRequestId = metadata.get('x-request-id')[0];
  return createRequestId(typeof metadataRequestId === 'string' ? metadataRequestId : requestId);
}

function mapOwner(owner: GrpcCheckoutOwner | undefined): CheckoutOwner | undefined {
  if (!owner) return undefined;
  if (
    owner.type === 1 ||
    owner.type === 'CHECKOUT_OWNER_TYPE_GUEST_SESSION' ||
    owner.type === 'GUEST_SESSION'
  ) {
    return { type: 'GUEST_SESSION', id: owner.id ?? '' };
  }
  if (
    owner.type === 2 ||
    owner.type === 'CHECKOUT_OWNER_TYPE_CUSTOMER' ||
    owner.type === 'CUSTOMER'
  ) {
    return { type: 'CUSTOMER', id: owner.id ?? '' };
  }
  return undefined;
}

function mapPaymentOutcome(value: number | string | undefined): 'SUCCESS' | 'FAILURE' | undefined {
  if (value === 1 || value === 'SIMULATED_PAYMENT_OUTCOME_SUCCESS' || value === 'SUCCESS') {
    return 'SUCCESS';
  }
  if (value === 2 || value === 'SIMULATED_PAYMENT_OUTCOME_FAILURE' || value === 'FAILURE') {
    return 'FAILURE';
  }
  return undefined;
}

function mapStaffTicketCredentialKind(
  value: number | string | undefined,
): StaffTicketCredentialKind | undefined {
  if (
    value === 1 ||
    value === 'STAFF_TICKET_CREDENTIAL_KIND_BOOKING_CODE' ||
    value === 'BOOKING_CODE'
  ) {
    return 'BOOKING_CODE';
  }
  if (
    value === 2 ||
    value === 'STAFF_TICKET_CREDENTIAL_KIND_TICKET_CODE' ||
    value === 'TICKET_CODE'
  ) {
    return 'TICKET_CODE';
  }
  if (
    value === 3 ||
    value === 'STAFF_TICKET_CREDENTIAL_KIND_QR_PAYLOAD' ||
    value === 'QR_PAYLOAD'
  ) {
    return 'QR_PAYLOAD';
  }
  return undefined;
}

function mapBookingStatus(statusValue: BookingView['status']): number {
  const statuses: BookingView['status'][] = [
    'DRAFT',
    'PENDING_PAYMENT',
    'PAID',
    'TICKET_ISSUED',
    'CHECKED_IN',
    'COMPLETED',
    'EXPIRED',
    'CANCELLED',
  ];
  return statuses.indexOf(statusValue) + 1;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function throwBookingError(error: unknown): never {
  if (error instanceof RpcException) throw error;
  if (error instanceof BookingValidationError) {
    throw new RpcException({ code: status.INVALID_ARGUMENT, message: error.message });
  }
  if (error instanceof BookingHoldExpiredError) {
    throw new RpcException({ code: status.FAILED_PRECONDITION, message: error.message });
  }
  if (error instanceof BookingHoldForbiddenError) {
    throw new RpcException({ code: status.PERMISSION_DENIED, message: error.message });
  }
  if (error instanceof BookingIdempotencyConflictError) {
    throw new RpcException({ code: status.ABORTED, message: error.message });
  }
  if (error instanceof BookingPaymentForbiddenError) {
    throw new RpcException({ code: status.PERMISSION_DENIED, message: error.message });
  }
  if (error instanceof BookingCheckInForbiddenError) {
    throw new RpcException({ code: status.PERMISSION_DENIED, message: error.message });
  }
  if (error instanceof BookingAdminForbiddenError) {
    throw new RpcException({ code: status.PERMISSION_DENIED, message: error.message });
  }
  if (error instanceof BookingTicketNotFoundError) {
    throw new RpcException({ code: status.NOT_FOUND, message: error.message });
  }
  if (error instanceof BookingLookupNotFoundError) {
    throw new RpcException({ code: status.NOT_FOUND, message: error.message });
  }
  if (error instanceof BookingWrongTripError) {
    throw new RpcException({
      code: status.FAILED_PRECONDITION,
      message: `WRONG_TRIP: ${error.message}`,
    });
  }
  if (error instanceof BookingInvalidStateTransitionError) {
    throw new RpcException({
      code: status.FAILED_PRECONDITION,
      message: `INVALID_STATE_TRANSITION: ${error.message}`,
    });
  }
  if (error instanceof BookingCancellationPolicyError) {
    throw new RpcException({
      code: status.FAILED_PRECONDITION,
      message: `CANCELLATION_NOT_ALLOWED: ${error.message}`,
    });
  }
  if (error instanceof BookingSeatUnavailableError) {
    throw new RpcException({ code: status.ALREADY_EXISTS, message: error.message });
  }
  if (error instanceof BookingSeatIdempotencyError || error instanceof PaymentIdempotencyError) {
    throw new RpcException({ code: status.ABORTED, message: error.message });
  }
  if (error instanceof CatalogTripNotFoundError) {
    throw new RpcException({ code: status.NOT_FOUND, message: error.message });
  }
  if (
    error instanceof CatalogDependencyError ||
    error instanceof SeatInventoryDependencyError ||
    error instanceof PaymentDependencyError
  ) {
    throw new RpcException({ code: status.UNAVAILABLE, message: error.message });
  }
  throw new RpcException({ code: status.UNAVAILABLE, message: 'Booking unavailable.' });
}
