import { createHash, randomUUID } from 'node:crypto';

import {
  createRequestId,
  currentTraceContext,
  logEvent,
  withRequestContext,
} from '@bus/observability';
import { Inject, Injectable } from '@nestjs/common';

import type { CatalogBookingSnapshot } from './catalog.client';
import { CatalogClient } from './catalog.client';
import { BookingDatabase } from './booking.database';
import {
  createBookingCreatedDispatch,
  createBookingCancelledDispatch,
  createBookingExpiredDispatch,
  createBookingPaidDispatch,
  cancellationPolicyCode,
  type BookingExpiryReason,
} from './booking.events';
import {
  BookingRepository,
  TicketCheckInIdempotencyConflictError,
  TicketCheckInStateError,
  TicketReferenceConflictError,
  TicketWrongTripError,
} from './booking.repository';
import { PaymentClient } from './payment.client';
import type {
  BookingPassengerInput,
  BookingAuditEvent,
  BookingFulfillmentSnapshot,
  BookingHistoryCursor,
  BookingPaymentRecord,
  BookingView,
  BookingOperationalSummary,
  GuestBookingLookup,
  CheckoutOwner,
  CreateBookingRequest,
  IssuedTicketReference,
  PersistBookingInput,
  StaffActor,
  StaffTicketCredentialKind,
  StaffTicketView,
  ValidatedCreateBookingRequest,
} from './booking.types';
import { BookingHoldExpiredError, SeatInventoryClient } from './seat-inventory.client';

export interface HealthRequest {
  requestId?: string;
}

export interface HealthResponse {
  service: string;
  status: string;
  version: string;
  requestId: string;
  traceId: string;
  checkedAt: string;
}

export interface CreateBookingResponse {
  booking: BookingView;
  requestId: string;
}

export interface SimulatePaymentRequest {
  bookingId?: string;
  owner?: CheckoutOwner;
  outcome?: 'SUCCESS' | 'FAILURE';
  idempotencyKey?: string;
  requestId?: string;
}

export interface SimulatedPaymentResult {
  paymentAttemptId: string;
  status: 'SUCCEEDED' | 'FAILED';
  booking: BookingView;
  failureCode?: string;
  processedAt: string;
}

export interface SimulatePaymentResponse {
  result: SimulatedPaymentResult;
  requestId: string;
}

export interface GetFulfillmentSnapshotRequest {
  bookingId?: string;
  requestId?: string;
}

export interface GetFulfillmentSnapshotResponse {
  snapshot: BookingFulfillmentSnapshot;
  requestId: string;
}

export interface MarkTicketIssuedRequest {
  bookingId?: string;
  sourceEventId?: string;
  issuedAt?: string;
  ticketCount?: number;
  requestId?: string;
  tickets?: IssuedTicketReference[];
}

export interface StaffTicketLookupRequest {
  kind?: StaffTicketCredentialKind;
  credential?: string;
  actor?: StaffActor;
  requestId?: string;
}

export interface StaffTicketLookupResponse {
  tickets: StaffTicketView[];
  requestId: string;
}

export interface CheckInTicketRequest {
  kind?: StaffTicketCredentialKind;
  credential?: string;
  tripId?: string;
  idempotencyKey?: string;
  actor?: StaffActor;
  requestId?: string;
}

export interface CheckInTicketResponse {
  ticket: StaffTicketView;
  transitioned: boolean;
  requestId: string;
}

export interface GetAdminOperationsRequest {
  tripId?: string;
  bookingLimit?: number;
  auditLimit?: number;
  actor?: StaffActor;
  requestId?: string;
}

export interface GetAdminOperationsResponse {
  bookings: BookingView[];
  summary: BookingOperationalSummary;
  auditEvents: BookingAuditEvent[];
  requestId: string;
}

export interface MarkTicketIssuedResponse {
  bookingId: string;
  status: BookingView['status'];
  transitioned: boolean;
  requestId: string;
}

export interface ListMyBookingsRequest {
  customerId?: string;
  pageSize?: number;
  cursor?: string;
  requestId?: string;
}

export interface ListMyBookingsResponse {
  bookings: BookingView[];
  nextCursor?: string;
  requestId: string;
}

export interface CancelBookingRequest {
  bookingId?: string;
  customerId?: string;
  idempotencyKey?: string;
  requestId?: string;
}

export interface CancelBookingResponse {
  result: {
    booking: BookingView;
    cancelledAt: string;
    policyCode: typeof cancellationPolicyCode;
    seatsReleased: boolean;
  };
  requestId: string;
}

export interface GetGuestBookingLookupRequest {
  bookingCode?: string;
  normalizedEmail?: string;
  requestId?: string;
}

export interface GetGuestBookingLookupResponse {
  booking: GuestBookingLookup;
  requestId: string;
}

export class BookingValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BookingValidationError';
  }
}

export class BookingIdempotencyConflictError extends Error {
  constructor() {
    super('Idempotency key was already used for a different booking request.');
    this.name = 'BookingIdempotencyConflictError';
  }
}

export class BookingPaymentForbiddenError extends Error {
  constructor() {
    super('Booking is unavailable for this checkout session.');
    this.name = 'BookingPaymentForbiddenError';
  }
}

export class BookingInvalidStateTransitionError extends Error {
  constructor(message = 'Booking cannot transition from its current state.') {
    super(message);
    this.name = 'BookingInvalidStateTransitionError';
  }
}

export class BookingCancellationPolicyError extends Error {
  constructor() {
    super('Booking can only be cancelled before departure.');
    this.name = 'BookingCancellationPolicyError';
  }
}

export class BookingTicketNotFoundError extends Error {
  constructor() {
    super('Ticket was not found.');
    this.name = 'BookingTicketNotFoundError';
  }
}

export class BookingLookupNotFoundError extends Error {
  constructor() {
    super('Booking lookup credentials are invalid.');
    this.name = 'BookingLookupNotFoundError';
  }
}

export class BookingCheckInForbiddenError extends Error {
  constructor() {
    super('Staff or admin role is required.');
    this.name = 'BookingCheckInForbiddenError';
  }
}

export class BookingAdminForbiddenError extends Error {
  constructor() {
    super('Admin role is required.');
    this.name = 'BookingAdminForbiddenError';
  }
}

export class BookingWrongTripError extends Error {
  constructor() {
    super('Ticket does not belong to the selected trip.');
    this.name = 'BookingWrongTripError';
  }
}

@Injectable()
export class BookingService {
  constructor(
    @Inject(BookingDatabase) private readonly database: BookingDatabase,
    @Inject(BookingRepository) private readonly bookingRepository: BookingRepository,
    @Inject(SeatInventoryClient) private readonly seatInventoryClient: SeatInventoryClient,
    @Inject(CatalogClient) private readonly catalogClient: CatalogClient,
    @Inject(PaymentClient) private readonly paymentClient: PaymentClient,
  ) {}

  health(request: HealthRequest, traceId = 'unavailable'): HealthResponse {
    return {
      service: 'booking-service',
      status: 'UP',
      version: '0.1.0',
      requestId: request.requestId ?? 'missing-request-id',
      traceId,
      checkedAt: new Date().toISOString(),
    };
  }

  async readiness(request: HealthRequest, traceId = 'unavailable'): Promise<HealthResponse> {
    await Promise.all([
      this.database.ping(),
      this.seatInventoryClient.readiness(request.requestId),
      this.catalogClient.readiness(request.requestId),
      this.paymentClient.readiness(request.requestId),
    ]);
    return this.health(request, traceId);
  }

  async createBooking(request: CreateBookingRequest): Promise<CreateBookingResponse> {
    const validated = validateCreateBookingRequest(request);
    const replay = await this.bookingRepository.findByIdempotency(
      validated.owner,
      validated.idempotencyKey,
    );
    if (replay) {
      if (replay.requestFingerprint !== validated.requestFingerprint) {
        throw new BookingIdempotencyConflictError();
      }
      return { booking: replay.booking, requestId: request.requestId ?? 'missing-request-id' };
    }

    const hold = await this.seatInventoryClient.getActiveHold(
      validated.holdToken,
      validated.owner,
      request.requestId,
    );
    if (Date.parse(hold.expiresAt) <= Date.now()) throw new BookingHoldExpiredError();
    validatePassengerSeatMapping(validated.passengers, hold.seatIds);
    if (
      !Number.isInteger(hold.unitPriceVnd) ||
      hold.unitPriceVnd < 0 ||
      hold.totalPriceVnd !== hold.unitPriceVnd * hold.seatIds.length
    ) {
      throw new Error('Seat hold returned inconsistent pricing.');
    }

    const catalogSnapshot = await this.catalogClient.getBookingSnapshot(
      hold.tripId,
      request.requestId,
    );
    const createdAt = new Date().toISOString();
    if (Date.parse(hold.expiresAt) <= Date.parse(createdAt)) throw new BookingHoldExpiredError();
    const input = toPersistBookingInput(validated, catalogSnapshot, hold, createdAt);
    const persisted = await this.bookingRepository.createOrReplay(
      input,
      createBookingCreatedDispatch(input, request.requestId),
    );
    if (persisted.requestFingerprint !== validated.requestFingerprint) {
      throw new BookingIdempotencyConflictError();
    }
    return {
      booking: persisted.booking,
      requestId: request.requestId ?? 'missing-request-id',
    };
  }

  async simulatePayment(request: SimulatePaymentRequest): Promise<SimulatePaymentResponse> {
    const validated = validateSimulatePaymentRequest(request);
    return this.database.withPaymentCommandLock(validated.bookingId, () =>
      this.simulatePaymentLocked(request, validated),
    );
  }

  async listMyBookings(request: ListMyBookingsRequest): Promise<ListMyBookingsResponse> {
    const customerId = request.customerId ?? '';
    if (!isUuid(customerId)) throw new BookingValidationError('Customer ID must be a valid UUID.');
    const pageSize = request.pageSize ?? 10;
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 20) {
      throw new BookingValidationError('Page size must be an integer between 1 and 20.');
    }
    const cursor = request.cursor ? decodeBookingCursor(request.cursor) : undefined;
    const page = await this.bookingRepository.listCustomerBookings(customerId, pageSize, cursor);
    return {
      bookings: page.bookings,
      ...(page.nextCursor && { nextCursor: encodeBookingCursor(page.nextCursor) }),
      requestId: request.requestId ?? 'missing-request-id',
    };
  }

  async getGuestBookingLookup(
    request: GetGuestBookingLookupRequest,
  ): Promise<GetGuestBookingLookupResponse> {
    const bookingCode = request.bookingCode?.trim().toUpperCase() ?? '';
    if (!/^BV-\d{4}-[A-Z0-9]{10}$/.test(bookingCode)) {
      throw new BookingValidationError('Booking lookup credentials are invalid.');
    }
    const normalizedEmail = normalizeEmail(request.normalizedEmail);
    const booking = await this.bookingRepository.findGuestBookingLookup(
      bookingCode,
      normalizedEmail,
      new Date(),
    );
    if (!booking) throw new BookingLookupNotFoundError();
    return { booking, requestId: request.requestId ?? 'missing-request-id' };
  }

  async cancelBooking(request: CancelBookingRequest): Promise<CancelBookingResponse> {
    const validated = validateCancelBookingRequest(request);
    return this.database.withPaymentCommandLock(validated.bookingId, () =>
      this.cancelBookingLocked(validated, request.requestId),
    );
  }

  async getFulfillmentSnapshot(
    request: GetFulfillmentSnapshotRequest,
  ): Promise<GetFulfillmentSnapshotResponse> {
    const bookingId = request.bookingId ?? '';
    if (!isUuid(bookingId)) throw new BookingValidationError('Booking ID must be a valid UUID.');
    const snapshot = await this.bookingRepository.findFulfillmentSnapshot(bookingId);
    if (!snapshot) throw new BookingPaymentForbiddenError();
    if (
      !['PAID', 'TICKET_ISSUED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED'].includes(
        snapshot.booking.status,
      )
    ) {
      throw new BookingInvalidStateTransitionError('Booking is not paid for fulfillment.');
    }
    return { snapshot, requestId: request.requestId ?? 'missing-request-id' };
  }

  async markTicketIssued(request: MarkTicketIssuedRequest): Promise<MarkTicketIssuedResponse> {
    const bookingId = request.bookingId ?? '';
    if (!isUuid(bookingId)) throw new BookingValidationError('Booking ID must be a valid UUID.');
    if (!isUuid(request.sourceEventId ?? '')) {
      throw new BookingValidationError('Source event ID must be a valid UUID.');
    }
    const issuedAt = request.issuedAt ?? '';
    if (!Number.isFinite(Date.parse(issuedAt))) {
      throw new BookingValidationError('Issued timestamp must be valid UTC ISO-8601.');
    }
    if (!Number.isInteger(request.ticketCount) || (request.ticketCount ?? 0) < 1) {
      throw new BookingValidationError('Ticket count must be a positive integer.');
    }
    const tickets = validateIssuedTicketReferences(request.tickets);
    if (tickets.length !== request.ticketCount) {
      throw new BookingValidationError('Ticket references must match the declared ticket count.');
    }
    const snapshot = await this.bookingRepository.findFulfillmentSnapshot(bookingId);
    if (!snapshot) throw new BookingPaymentForbiddenError();
    if (!['PAID', 'TICKET_ISSUED', 'CHECKED_IN', 'COMPLETED'].includes(snapshot.booking.status)) {
      throw new BookingInvalidStateTransitionError('Booking cannot be marked ticket issued.');
    }
    if (snapshot.booking.passengers.length !== request.ticketCount) {
      throw new BookingValidationError('Ticket count must match the booking passenger count.');
    }
    const passengerIds = new Set(snapshot.booking.passengers.map((passenger) => passenger.id));
    if (
      tickets.some((ticket) => !passengerIds.has(ticket.passengerId)) ||
      new Set(tickets.map((ticket) => ticket.passengerId)).size !== passengerIds.size
    ) {
      throw new BookingValidationError('Ticket references must map exactly to booking passengers.');
    }
    let transition;
    try {
      transition = await this.bookingRepository.markTicketIssued(
        bookingId,
        issuedAt,
        SYSTEM_ACTOR.id,
        tickets.map((ticket) => ({
          ticketId: ticket.ticketId,
          passengerId: ticket.passengerId,
          ticketCode: ticket.ticketCode,
          qrPayloadHash: createHash('sha256').update(ticket.qrPayload).digest('hex'),
        })),
      );
    } catch (error) {
      if (error instanceof TicketReferenceConflictError) {
        throw new BookingIdempotencyConflictError();
      }
      throw error;
    }
    if (!['TICKET_ISSUED', 'CHECKED_IN', 'COMPLETED'].includes(transition.status)) {
      throw new BookingInvalidStateTransitionError('Booking cannot be marked ticket issued.');
    }
    return {
      bookingId,
      status: transition.status,
      transitioned: transition.transitioned,
      requestId: request.requestId ?? 'missing-request-id',
    };
  }

  async staffTicketLookup(request: StaffTicketLookupRequest): Promise<StaffTicketLookupResponse> {
    validateStaffActor(request.actor);
    const { kind, credential } = validateStaffTicketCredential(request.kind, request.credential);
    return {
      tickets: await this.bookingRepository.findStaffTickets(kind, credential),
      requestId: request.requestId ?? 'missing-request-id',
    };
  }

  async checkInTicket(request: CheckInTicketRequest): Promise<CheckInTicketResponse> {
    const actor = validateStaffActor(request.actor);
    const { kind, credential } = validateStaffTicketCredential(request.kind, request.credential);
    if (kind === 'BOOKING_CODE') {
      throw new BookingValidationError('Check-in requires a ticket code or QR payload.');
    }
    const tripId = request.tripId ?? '';
    if (!isUuid(tripId)) throw new BookingValidationError('Trip ID must be a valid UUID.');
    const idempotencyKey = request.idempotencyKey?.trim() ?? '';
    if (!/^[A-Za-z0-9._-]{16,128}$/.test(idempotencyKey)) {
      throw new BookingValidationError('Idempotency key format is invalid.');
    }
    try {
      const result = await this.bookingRepository.checkInTicket({
        kind,
        credential,
        tripId,
        idempotencyKey,
        actor,
        requestId: request.requestId ?? 'missing-request-id',
        traceId: currentTraceContext().traceId ?? 'unavailable',
      });
      if (!result) throw new BookingTicketNotFoundError();
      return { ...result, requestId: request.requestId ?? 'missing-request-id' };
    } catch (error) {
      if (error instanceof TicketCheckInIdempotencyConflictError) {
        throw new BookingIdempotencyConflictError();
      }
      if (error instanceof TicketWrongTripError) throw new BookingWrongTripError();
      if (error instanceof TicketCheckInStateError) {
        throw new BookingInvalidStateTransitionError(error.message);
      }
      throw error;
    }
  }

  async getAdminOperations(
    request: GetAdminOperationsRequest,
  ): Promise<GetAdminOperationsResponse> {
    validateAdminActor(request.actor);
    const tripId = request.tripId?.trim() || undefined;
    if (tripId && !isUuid(tripId)) {
      throw new BookingValidationError('Trip ID must be a valid UUID.');
    }
    const bookingLimit = validateOperationsLimit(request.bookingLimit, 50, 'Booking limit');
    const auditLimit = validateOperationsLimit(request.auditLimit, 50, 'Audit limit');
    const operations = await this.bookingRepository.getAdminOperations(
      tripId,
      bookingLimit,
      auditLimit,
    );
    return { ...operations, requestId: request.requestId ?? 'missing-request-id' };
  }

  async reconcileExpiredBookings(limit = 50): Promise<number> {
    const candidates = await this.bookingRepository.findExpiryCandidates(limit);
    let transitioned = 0;
    for (const candidate of candidates) {
      const requestId = createRequestId();
      const didTransition = await withRequestContext(requestId, () =>
        this.database.withPaymentCommandLock(candidate.bookingId, async () => {
          const record = await this.bookingRepository.findOwnedById(
            candidate.bookingId,
            candidate.owner,
          );
          if (
            !record ||
            record.booking.status !== 'PENDING_PAYMENT' ||
            !paymentWindowExpired(record.booking)
          ) {
            return false;
          }
          return this.transitionExpired({
            bookingRecord: record,
            owner: candidate.owner,
            releaseIdempotencyKey: randomUUID(),
            requestId,
            reason: paymentExpiryReason(record.booking),
            actor: SYSTEM_ACTOR,
          });
        }),
      );
      if (didTransition) transitioned += 1;
    }
    return transitioned;
  }

  async reconcileCancelledSeatReleases(limit = 50): Promise<number> {
    const candidates = await this.bookingRepository.findCancellationReleaseCandidates(limit);
    let released = 0;
    for (const candidate of candidates) {
      const requestId = createRequestId();
      const didRelease = await withRequestContext(requestId, () =>
        this.database.withPaymentCommandLock(candidate.bookingId, async () => {
          const record = await this.bookingRepository.findOwnedById(
            candidate.bookingId,
            candidate.owner,
          );
          if (!record || record.booking.status !== 'CANCELLED') return false;
          return this.releaseCancelledSeats(record, candidate.idempotencyKey, requestId);
        }),
      );
      if (didRelease) released += 1;
    }
    return released;
  }

  private async cancelBookingLocked(
    validated: ReturnType<typeof validateCancelBookingRequest>,
    requestId?: string,
  ): Promise<CancelBookingResponse> {
    const owner: CheckoutOwner = { type: 'CUSTOMER', id: validated.customerId };
    const record = await this.bookingRepository.findOwnedById(validated.bookingId, owner);
    if (!record) throw new BookingPaymentForbiddenError();

    if (record.booking.status === 'CANCELLED') {
      if (record.cancellationIdempotencyKey !== validated.idempotencyKey) {
        throw new BookingIdempotencyConflictError();
      }
      const seatsReleased =
        Boolean(record.cancellationSeatsReleasedAt) ||
        (await this.releaseCancelledSeats(record, validated.idempotencyKey, requestId));
      return cancellationResponse(record, seatsReleased, requestId);
    }
    if (record.booking.status !== 'PAID' && record.booking.status !== 'TICKET_ISSUED') {
      throw new BookingInvalidStateTransitionError('Only paid bookings can be cancelled.');
    }
    assertCancellationAllowed(record.booking, new Date());

    const cancelledAt = new Date().toISOString();
    const transition = await this.bookingRepository.markCancelled(
      record.booking.id,
      owner,
      validated.idempotencyKey,
      cancelledAt,
      cancellationPolicyCode,
      createBookingCancelledDispatch({
        booking: record.booking,
        owner,
        cancelledAt,
        requestId,
      }),
      {
        actorId: owner.id,
        actorRole: owner.type,
        requestId: requestId ?? 'missing-request-id',
        traceId: currentTraceContext().traceId ?? 'unavailable',
      },
    );
    if (transition.record.booking.status !== 'CANCELLED') {
      throw new BookingInvalidStateTransitionError(
        'Booking cancellation conflicted with another command.',
      );
    }
    const seatsReleased = await this.releaseCancelledSeats(
      transition.record,
      validated.idempotencyKey,
      requestId,
    );
    return cancellationResponse(transition.record, seatsReleased, requestId);
  }

  private async releaseCancelledSeats(
    record: BookingPaymentRecord,
    idempotencyKey: string,
    requestId?: string,
  ): Promise<boolean> {
    const releasedAt = await this.seatInventoryClient.releaseBookedSeats({
      bookingId: record.booking.id,
      tripId: record.booking.trip.tripId,
      seatIds: record.booking.passengers.map((passenger) => passenger.seatId).sort(),
      idempotencyKey,
      requestId,
    });
    await this.bookingRepository.markCancellationSeatsReleased(
      record.booking.id,
      idempotencyKey,
      releasedAt,
    );
    return true;
  }

  private async simulatePaymentLocked(
    request: SimulatePaymentRequest,
    validated: ReturnType<typeof validateSimulatePaymentRequest>,
  ): Promise<SimulatePaymentResponse> {
    const bookingRecord = await this.bookingRepository.findOwnedById(
      validated.bookingId,
      validated.owner,
    );
    if (!bookingRecord) throw new BookingPaymentForbiddenError();

    if (bookingRecord.booking.status === 'PAID') {
      if (
        bookingRecord.paymentIdempotencyKey === validated.idempotencyKey &&
        bookingRecord.paidPaymentAttemptId
      ) {
        return paymentSuccessResponse(
          bookingRecord,
          bookingRecord.paidPaymentAttemptId,
          bookingRecord.paidAt ?? bookingRecord.booking.createdAt,
          request.requestId,
        );
      }
      throw new BookingInvalidStateTransitionError('Booking has already been paid.');
    }
    if (bookingRecord.booking.status === 'EXPIRED') throw new BookingHoldExpiredError();
    if (bookingRecord.booking.status !== 'PENDING_PAYMENT') {
      throw new BookingInvalidStateTransitionError();
    }

    if (paymentWindowExpired(bookingRecord.booking)) {
      await this.expireBooking(bookingRecord, validated.owner, validated.idempotencyKey, request);
      throw new BookingHoldExpiredError();
    }

    const attempt = await this.paymentClient.createPaymentAttempt({
      bookingId: bookingRecord.booking.id,
      owner: validated.owner,
      amountVnd: bookingRecord.booking.totalPriceVnd,
      outcome: validated.outcome,
      idempotencyKey: validated.idempotencyKey,
      requestId: request.requestId,
    });
    if (attempt.status === 'FAILED') {
      return {
        result: {
          paymentAttemptId: attempt.id,
          status: 'FAILED',
          booking: bookingRecord.booking,
          failureCode: attempt.failureCode ?? 'SIMULATED_FAILURE',
          processedAt: attempt.createdAt,
        },
        requestId: request.requestId ?? 'missing-request-id',
      };
    }

    let confirmedAt: string;
    try {
      confirmedAt = await this.seatInventoryClient.confirmSeats({
        holdToken: bookingRecord.holdToken,
        owner: validated.owner,
        tripId: bookingRecord.booking.trip.tripId,
        seatIds: bookingRecord.booking.passengers.map((passenger) => passenger.seatId).sort(),
        bookingId: bookingRecord.booking.id,
        idempotencyKey: attempt.id,
        requestId: request.requestId,
      });
    } catch (error) {
      if (error instanceof BookingHoldExpiredError) {
        await this.expireBooking(bookingRecord, validated.owner, validated.idempotencyKey, request);
      }
      throw error;
    }

    const paid = await this.bookingRepository.markPaid(
      bookingRecord.booking.id,
      validated.owner,
      attempt.id,
      validated.idempotencyKey,
      confirmedAt,
      createBookingPaidDispatch({
        booking: bookingRecord.booking,
        owner: validated.owner,
        paymentAttemptId: attempt.id,
        paidAt: confirmedAt,
        requestId: request.requestId,
      }),
      {
        actorId: validated.owner.id,
        actorRole: validated.owner.type,
        requestId: request.requestId ?? 'missing-request-id',
        traceId: currentTraceContext().traceId ?? 'unavailable',
      },
    );
    if (
      paid.booking.status !== 'PAID' ||
      paid.paidPaymentAttemptId !== attempt.id ||
      paid.paymentIdempotencyKey !== validated.idempotencyKey
    ) {
      throw new BookingInvalidStateTransitionError(
        'Booking payment transition conflicted with another command.',
      );
    }
    return paymentSuccessResponse(paid, attempt.id, confirmedAt, request.requestId);
  }

  private async expireBooking(
    bookingRecord: BookingPaymentRecord,
    owner: CheckoutOwner,
    idempotencyKey: string,
    request: SimulatePaymentRequest,
  ): Promise<void> {
    await this.transitionExpired({
      bookingRecord,
      owner,
      releaseIdempotencyKey: idempotencyKey,
      requestId: request.requestId,
      reason: paymentExpiryReason(bookingRecord.booking),
      actor: owner,
    });
  }

  private async transitionExpired(input: {
    bookingRecord: BookingPaymentRecord;
    owner: CheckoutOwner;
    releaseIdempotencyKey: string;
    requestId?: string;
    reason: BookingExpiryReason;
    actor: { type: CheckoutOwner['type'] | 'SYSTEM'; id: string };
  }): Promise<boolean> {
    const expiredAt = new Date().toISOString();
    const transition = await this.bookingRepository.markExpired(
      input.bookingRecord.booking.id,
      input.owner,
      expiredAt,
      input.actor,
      createBookingExpiredDispatch({
        booking: input.bookingRecord.booking,
        owner: input.owner,
        expiredAt,
        reason: input.reason,
        requestId: input.requestId,
        actor: {
          category: input.actor.type === 'SYSTEM' ? 'SYSTEM' : ownerEventCategory(input.owner),
          id: input.actor.id,
        },
      }),
    );
    if (transition.record.booking.status === 'PAID') {
      throw new BookingInvalidStateTransitionError('Booking was paid by another request.');
    }
    if (!transition.transitioned) return false;
    try {
      await this.seatInventoryClient.releaseHold(
        input.bookingRecord.holdToken,
        input.owner,
        input.releaseIdempotencyKey,
        input.requestId,
      );
    } catch (error) {
      logEvent({
        service: 'booking-service',
        level: 'error',
        event: 'booking.expiry.release-hold.failed',
        message: 'Expired booking transition succeeded but hold release failed.',
        requestId: input.requestId,
        fields: {
          bookingId: input.bookingRecord.booking.id,
          reason: error instanceof Error ? error.name : 'UnknownError',
        },
      });
    }
    return true;
  }
}

export function validateSimulatePaymentRequest(request: SimulatePaymentRequest) {
  const bookingId = request.bookingId ?? '';
  if (!isUuid(bookingId)) throw new BookingValidationError('Booking ID must be a valid UUID.');
  const owner = validateOwner(request.owner);
  if (request.outcome !== 'SUCCESS' && request.outcome !== 'FAILURE') {
    throw new BookingValidationError('Simulated payment outcome is invalid.');
  }
  const idempotencyKey = request.idempotencyKey?.trim() ?? '';
  if (!/^[A-Za-z0-9._-]{16,128}$/.test(idempotencyKey)) {
    throw new BookingValidationError('Idempotency key format is invalid.');
  }
  return { bookingId, owner, outcome: request.outcome, idempotencyKey };
}

function validateIssuedTicketReferences(
  tickets: IssuedTicketReference[] | undefined,
): IssuedTicketReference[] {
  if (!tickets || tickets.length < 1 || tickets.length > 10) {
    throw new BookingValidationError('Between 1 and 10 issued ticket references are required.');
  }
  const normalized = tickets.map((ticket) => ({
    ticketId: ticket.ticketId?.trim() ?? '',
    passengerId: ticket.passengerId?.trim() ?? '',
    ticketCode: ticket.ticketCode?.trim().toUpperCase() ?? '',
    qrPayload: ticket.qrPayload?.trim() ?? '',
  }));
  if (
    normalized.some(
      (ticket) =>
        !isUuid(ticket.ticketId) ||
        !isUuid(ticket.passengerId) ||
        !/^VT-[A-Z0-9-]{8,100}$/.test(ticket.ticketCode) ||
        !/^[A-Za-z0-9-]{16,256}$/.test(ticket.qrPayload),
    ) ||
    new Set(normalized.map((ticket) => ticket.ticketId)).size !== normalized.length ||
    new Set(normalized.map((ticket) => ticket.ticketCode)).size !== normalized.length
  ) {
    throw new BookingValidationError('Issued ticket reference format is invalid.');
  }
  return normalized;
}

function validateStaffActor(actor: StaffActor | undefined): StaffActor {
  if (!actor || !isUuid(actor.id) || (actor.role !== 'STAFF' && actor.role !== 'ADMIN')) {
    throw new BookingCheckInForbiddenError();
  }
  return actor;
}

function validateAdminActor(actor: StaffActor | undefined): StaffActor {
  if (!actor || !isUuid(actor.id) || actor.role !== 'ADMIN') {
    throw new BookingAdminForbiddenError();
  }
  return actor;
}

function validateOperationsLimit(
  value: number | undefined,
  fallback: number,
  label: string,
): number {
  const limit = value ?? fallback;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new BookingValidationError(`${label} must be an integer between 1 and 100.`);
  }
  return limit;
}

function validateStaffTicketCredential(
  kind: StaffTicketCredentialKind | undefined,
  rawCredential: string | undefined,
): { kind: StaffTicketCredentialKind; credential: string } {
  if (kind !== 'BOOKING_CODE' && kind !== 'TICKET_CODE' && kind !== 'QR_PAYLOAD') {
    throw new BookingValidationError('Ticket credential kind is invalid.');
  }
  const credential = rawCredential?.trim() ?? '';
  if (kind === 'BOOKING_CODE') {
    const normalized = credential.toUpperCase();
    if (!/^BV-[A-Z0-9-]{8,100}$/.test(normalized)) {
      throw new BookingValidationError('Booking code format is invalid.');
    }
    return { kind, credential: normalized };
  }
  if (kind === 'TICKET_CODE') {
    const normalized = credential.toUpperCase();
    if (!/^VT-[A-Z0-9-]{8,100}$/.test(normalized)) {
      throw new BookingValidationError('Ticket code format is invalid.');
    }
    return { kind, credential: normalized };
  }
  if (!/^[A-Za-z0-9-]{16,256}$/.test(credential)) {
    throw new BookingValidationError('QR payload format is invalid.');
  }
  return { kind, credential: createHash('sha256').update(credential).digest('hex') };
}

export function validateCancelBookingRequest(request: CancelBookingRequest) {
  const bookingId = request.bookingId ?? '';
  const customerId = request.customerId ?? '';
  if (!isUuid(bookingId)) throw new BookingValidationError('Booking ID must be a valid UUID.');
  if (!isUuid(customerId)) throw new BookingValidationError('Customer ID must be a valid UUID.');
  const idempotencyKey = request.idempotencyKey?.trim() ?? '';
  if (!/^[A-Za-z0-9._-]{16,128}$/.test(idempotencyKey)) {
    throw new BookingValidationError('Idempotency key format is invalid.');
  }
  return { bookingId, customerId, idempotencyKey };
}

export function assertCancellationAllowed(booking: BookingView, now: Date): void {
  if (Date.parse(booking.trip.departureAt) <= now.getTime()) {
    throw new BookingCancellationPolicyError();
  }
}

function cancellationResponse(
  record: BookingPaymentRecord,
  seatsReleased: boolean,
  requestId?: string,
): CancelBookingResponse {
  if (!record.cancelledAt || record.cancellationPolicyCode !== cancellationPolicyCode) {
    throw new Error('Cancelled booking is missing cancellation metadata.');
  }
  return {
    result: {
      booking: record.booking,
      cancelledAt: record.cancelledAt,
      policyCode: record.cancellationPolicyCode,
      seatsReleased,
    },
    requestId: requestId ?? 'missing-request-id',
  };
}

function paymentWindowExpired(booking: BookingView): boolean {
  const now = Date.now();
  return Date.parse(booking.holdExpiresAt) <= now || Date.parse(booking.trip.departureAt) <= now;
}

function paymentExpiryReason(booking: BookingView): BookingExpiryReason {
  return Date.parse(booking.trip.departureAt) <= Date.now() ? 'DEPARTURE_REACHED' : 'HOLD_EXPIRED';
}

function ownerEventCategory(owner: CheckoutOwner): 'GUEST' | 'CUSTOMER' {
  return owner.type === 'GUEST_SESSION' ? 'GUEST' : 'CUSTOMER';
}

const SYSTEM_ACTOR = {
  type: 'SYSTEM' as const,
  id: '00000000-0000-4000-8000-000000000001',
};

function paymentSuccessResponse(
  record: BookingPaymentRecord,
  paymentAttemptId: string,
  processedAt: string,
  requestId?: string,
): SimulatePaymentResponse {
  return {
    result: {
      paymentAttemptId,
      status: 'SUCCEEDED',
      booking: record.booking,
      processedAt,
    },
    requestId: requestId ?? 'missing-request-id',
  };
}

export function validateCreateBookingRequest(
  request: CreateBookingRequest,
): ValidatedCreateBookingRequest {
  const holdToken = request.holdToken?.trim() ?? '';
  if (!/^[A-Za-z0-9._-]{16,256}$/.test(holdToken)) {
    throw new BookingValidationError('Hold token format is invalid.');
  }
  const owner = validateOwner(request.owner);
  const idempotencyKey = request.idempotencyKey?.trim() ?? '';
  if (!/^[A-Za-z0-9._-]{16,128}$/.test(idempotencyKey)) {
    throw new BookingValidationError('Idempotency key format is invalid.');
  }
  const contact = {
    fullName: normalizeName(request.contact?.fullName, 'Contact full name'),
    email: normalizeEmail(request.contact?.email),
    phone: normalizePhone(request.contact?.phone, 'Contact phone'),
  };
  const passengers = normalizePassengers(request.passengers);
  const normalizedEmail = contact.email.toLowerCase();
  const fingerprintSource = {
    holdToken,
    owner,
    contact,
    passengers,
  };
  return {
    holdToken,
    owner,
    contact,
    normalizedEmail,
    passengers,
    idempotencyKey,
    requestFingerprint: createHash('sha256')
      .update(JSON.stringify(fingerprintSource))
      .digest('hex'),
  };
}

export function validatePassengerSeatMapping(
  passengers: BookingPassengerInput[],
  holdSeatIds: string[],
): void {
  const passengerSeats = passengers.map((passenger) => passenger.seatId).sort();
  const heldSeats = [...holdSeatIds].sort();
  if (
    passengerSeats.length !== heldSeats.length ||
    passengerSeats.some((seatId, index) => seatId !== heldSeats[index])
  ) {
    throw new BookingValidationError('Passengers must map exactly once to every held seat.');
  }
}

function toPersistBookingInput(
  request: ValidatedCreateBookingRequest,
  catalogSnapshot: CatalogBookingSnapshot,
  hold: {
    token: string;
    expiresAt: string;
    unitPriceVnd: number;
    totalPriceVnd: number;
  },
  createdAt: string,
): PersistBookingInput {
  return {
    id: randomUUID(),
    bookingCode: createBookingCode(),
    owner: request.owner,
    idempotencyKey: request.idempotencyKey,
    requestFingerprint: request.requestFingerprint,
    holdToken: hold.token,
    holdExpiresAt: hold.expiresAt,
    contact: request.contact,
    normalizedEmail: request.normalizedEmail,
    trip: { ...catalogSnapshot, unitPriceVnd: hold.unitPriceVnd },
    passengers: request.passengers.map((passenger) => ({
      ...passenger,
      id: randomUUID(),
      ...(passenger.documentNumber !== undefined && {
        documentNumberHash: createHash('sha256')
          .update(randomUUID())
          .update(passenger.documentNumber)
          .digest('hex'),
      }),
    })),
    totalPriceVnd: hold.totalPriceVnd,
    createdAt,
  };
}

function normalizePassengers(
  values: Array<Partial<BookingPassengerInput>> | undefined,
): BookingPassengerInput[] {
  if (!Array.isArray(values) || values.length < 1 || values.length > 10) {
    throw new BookingValidationError('Booking must contain between 1 and 10 passengers.');
  }
  const passengers = values.map((value) => {
    const seatId = value.seatId?.trim() ?? '';
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(seatId)) {
      throw new BookingValidationError('Passenger seat ID is invalid.');
    }
    const phone = value.phone?.trim();
    const documentNumber = value.documentNumber?.trim();
    if (documentNumber && !/^[A-Za-z0-9./-]{4,32}$/.test(documentNumber)) {
      throw new BookingValidationError('Passenger document number format is invalid.');
    }
    return {
      seatId,
      fullName: normalizeName(value.fullName, 'Passenger full name'),
      ...(phone && { phone: normalizePhone(phone, 'Passenger phone') }),
      ...(documentNumber && { documentNumber }),
    };
  });
  if (new Set(passengers.map((passenger) => passenger.seatId)).size !== passengers.length) {
    throw new BookingValidationError('Each held seat must have exactly one passenger.');
  }
  return passengers.sort((left, right) => left.seatId.localeCompare(right.seatId));
}

function normalizeName(value: string | undefined, label: string): string {
  const normalized = value?.trim().replace(/\s+/g, ' ') ?? '';
  if (normalized.length < 2 || normalized.length > 100) {
    throw new BookingValidationError(`${label} must contain between 2 and 100 characters.`);
  }
  return normalized;
}

function normalizeEmail(value: string | undefined): string {
  const normalized = value?.trim().toLowerCase() ?? '';
  if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new BookingValidationError('Contact email format is invalid.');
  }
  return normalized;
}

function normalizePhone(value: string | undefined, label: string): string {
  const candidate = value?.trim() ?? '';
  const normalized = candidate.startsWith('+')
    ? `+${candidate.slice(1).replace(/[^0-9]/g, '')}`
    : candidate.replace(/[^0-9]/g, '');
  const digits = normalized.startsWith('+') ? normalized.slice(1) : normalized;
  if (digits.length < 8 || digits.length > 15) {
    throw new BookingValidationError(`${label} must contain between 8 and 15 digits.`);
  }
  return normalized;
}

function validateOwner(owner: CheckoutOwner | undefined): CheckoutOwner {
  if (!owner || !['GUEST_SESSION', 'CUSTOMER'].includes(owner.type) || !isUuid(owner.id)) {
    throw new BookingValidationError('A valid checkout owner is required.');
  }
  return owner;
}

function createBookingCode(): string {
  const year = new Date().getUTCFullYear();
  return `BV-${year}-${randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()}`;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function encodeBookingCursor(cursor: BookingHistoryCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeBookingCursor(value: string): BookingHistoryCursor {
  if (value.length < 8 || value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new BookingValidationError('Booking cursor is invalid.');
  }
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'createdAt' in parsed &&
      'id' in parsed &&
      typeof parsed.createdAt === 'string' &&
      Number.isFinite(Date.parse(parsed.createdAt)) &&
      typeof parsed.id === 'string' &&
      isUuid(parsed.id)
    ) {
      return { createdAt: parsed.createdAt, id: parsed.id };
    }
  } catch {
    // The public error stays neutral for malformed opaque cursors.
  }
  throw new BookingValidationError('Booking cursor is invalid.');
}
