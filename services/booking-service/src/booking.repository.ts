import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient, QueryResultRow } from 'pg';

import { BookingDatabase } from './booking.database';
import type { EventDispatch } from './booking.events';
import { enqueueBookingEvent } from './booking-outbox.repository';
import type {
  BookingActor,
  BookingAuditEvent,
  BookingFulfillmentSnapshot,
  BookingHistoryCursor,
  GuestBookingLookup,
  BookingPassenger,
  BookingPaymentRecord,
  BookingStatus,
  BookingOperationalSummary,
  BookingTripSnapshot,
  BookingView,
  CheckoutOwner,
  PersistBookingInput,
  StaffActor,
  StaffTicketCredentialKind,
  StaffTicketView,
} from './booking.types';

interface BookingRow extends QueryResultRow {
  id: string;
  booking_code: string;
  status: BookingStatus;
  checkout_owner_type: CheckoutOwner['type'];
  checkout_owner_id: string;
  request_fingerprint: string;
  hold_token: string;
  hold_expires_at: Date;
  contact_full_name: string;
  contact_email: string;
  contact_phone: string;
  trip_id: string;
  route_id: string;
  route_code: string;
  operator_name: string;
  vehicle_type_name: string;
  vehicle_code: string;
  vehicle_plate: string;
  origin_name: string;
  destination_name: string;
  pickup_name: string;
  dropoff_name: string;
  departure_at: Date;
  arrival_at: Date;
  timezone: string;
  unit_price_vnd: number;
  total_price_vnd: number;
  paid_payment_attempt_id: string | null;
  payment_idempotency_key: string | null;
  paid_at: Date | null;
  expired_at: Date | null;
  cancelled_at: Date | null;
  cancellation_idempotency_key: string | null;
  cancellation_policy_code: 'BEFORE_DEPARTURE_FULL_RELEASE' | null;
  cancellation_seats_released_at: Date | null;
  created_at: Date;
}

interface PassengerRow extends QueryResultRow {
  id: string;
  seat_id: string;
  full_name: string;
  phone: string | null;
  has_document_number: boolean;
}

interface TicketReferenceRow extends QueryResultRow {
  ticket_id: string;
  booking_id: string;
  passenger_id: string;
  ticket_code: string;
  qr_payload_hash: string;
}

interface StaffTicketRow extends QueryResultRow {
  ticket_id: string;
  ticket_code: string;
  booking_id: string;
  booking_code: string;
  booking_status: BookingStatus;
  passenger_id: string;
  passenger_name: string;
  seat_id: string;
  trip_id: string;
  origin_name: string;
  destination_name: string;
  departure_at: Date;
  checked_in_at: Date | null;
}

interface BookingSummaryRow extends QueryResultRow {
  booking_count: number;
  passenger_count: number;
  revenue_vnd: string;
}

interface BookingStatusCountRow extends QueryResultRow {
  status: BookingStatus;
  count: number;
}

interface BookingAuditRow extends QueryResultRow {
  id: string;
  action: string;
  target_type: string;
  target_id: string;
  actor_id: string;
  actor_role: BookingAuditEvent['actorRole'];
  occurred_at: Date;
  request_id: string;
  trace_id: string;
}

export interface BookingReplayRecord {
  booking: BookingView;
  requestFingerprint: string;
}

export interface BookingExpiryCandidate {
  bookingId: string;
  owner: CheckoutOwner;
}

export interface BookingExpiryTransition {
  record: BookingPaymentRecord;
  transitioned: boolean;
}

export interface BookingCancellationTransition {
  record: BookingPaymentRecord;
  transitioned: boolean;
}

export interface BookingCancellationReleaseCandidate {
  bookingId: string;
  owner: CheckoutOwner;
  idempotencyKey: string;
}

export interface TicketIssuedTransition {
  status: BookingStatus;
  transitioned: boolean;
}

export interface PersistedTicketReference {
  ticketId: string;
  passengerId: string;
  ticketCode: string;
  qrPayloadHash: string;
}

export interface TicketCheckInCommand {
  kind: Exclude<StaffTicketCredentialKind, 'BOOKING_CODE'>;
  credential: string;
  tripId: string;
  idempotencyKey: string;
  actor: StaffActor;
  requestId: string;
  traceId: string;
}

export interface TicketCheckInTransition {
  ticket: StaffTicketView;
  transitioned: boolean;
}

export class TicketReferenceConflictError extends Error {
  constructor() {
    super('Issued ticket references conflict with an earlier fulfillment request.');
    this.name = 'TicketReferenceConflictError';
  }
}

export class TicketCheckInIdempotencyConflictError extends Error {
  constructor() {
    super('Idempotency key was already used for another ticket check-in.');
    this.name = 'TicketCheckInIdempotencyConflictError';
  }
}

export class TicketWrongTripError extends Error {
  constructor() {
    super('Ticket does not belong to the selected trip.');
    this.name = 'TicketWrongTripError';
  }
}

export class TicketCheckInStateError extends Error {
  constructor(readonly bookingStatus: BookingStatus) {
    super(`Ticket cannot be checked in while booking is ${bookingStatus}.`);
    this.name = 'TicketCheckInStateError';
  }
}

export interface CustomerBookingPage {
  bookings: BookingView[];
  nextCursor?: BookingHistoryCursor;
}

export interface AdminBookingOperations {
  bookings: BookingView[];
  summary: BookingOperationalSummary;
  auditEvents: BookingAuditEvent[];
}

export interface OperationalAuditContext {
  actorId: string;
  actorRole: BookingAuditEvent['actorRole'];
  requestId: string;
  traceId: string;
}

@Injectable()
export class BookingRepository {
  constructor(@Inject(BookingDatabase) private readonly database: BookingDatabase) {}

  async findByIdempotency(
    owner: CheckoutOwner,
    idempotencyKey: string,
  ): Promise<BookingReplayRecord | null> {
    const result = await this.database.query<BookingRow>(bookingByIdempotencySql, [
      owner.type,
      owner.id,
      idempotencyKey,
    ]);
    const row = result.rows[0];
    if (!row) return null;
    return this.loadRecord(row, (text, values) => this.database.query<PassengerRow>(text, values));
  }

  async findOwnedById(
    bookingId: string,
    owner: CheckoutOwner,
  ): Promise<BookingPaymentRecord | null> {
    const result = await this.database.query<BookingRow>(bookingByIdSql, [
      bookingId,
      owner.type,
      owner.id,
    ]);
    const row = result.rows[0];
    if (!row) return null;
    return this.loadPaymentRecord(row, (text, values) =>
      this.database.query<PassengerRow>(text, values),
    );
  }

  async listCustomerBookings(
    customerId: string,
    pageSize: number,
    cursor?: BookingHistoryCursor,
  ): Promise<CustomerBookingPage> {
    const values: unknown[] = [customerId, pageSize + 1];
    const cursorClause = cursor ? `AND (created_at, id) < ($3::timestamptz, $4::uuid)` : '';
    if (cursor) values.push(cursor.createdAt, cursor.id);
    const result = await this.database.query<BookingRow>(
      `${bookingSelectSql}
       WHERE checkout_owner_type = 'CUSTOMER'
         AND checkout_owner_id = $1
         ${cursorClause}
       ORDER BY created_at DESC, id DESC
       LIMIT $2`,
      values,
    );
    const hasNextPage = result.rows.length > pageSize;
    const rows = result.rows.slice(0, pageSize);
    const bookings = await Promise.all(
      rows.map(async (row) => {
        const record = await this.loadRecord(row, (text, passengerValues) =>
          this.database.query<PassengerRow>(text, passengerValues),
        );
        return record.booking;
      }),
    );
    const last = hasNextPage ? rows.at(-1) : undefined;
    return {
      bookings,
      ...(last && { nextCursor: { createdAt: last.created_at.toISOString(), id: last.id } }),
    };
  }

  async getAdminOperations(
    tripId: string | undefined,
    bookingLimit: number,
    auditLimit: number,
  ): Promise<AdminBookingOperations> {
    const tripClause = tripId ? 'WHERE trip_id = $1' : '';
    const tripValues = tripId ? [tripId] : [];
    const bookingResult = await this.database.query<BookingRow>(
      `${bookingSelectSql}
       ${tripClause}
       ORDER BY created_at DESC, id DESC
       LIMIT $${tripValues.length + 1}`,
      [...tripValues, bookingLimit],
    );
    const bookings = await Promise.all(
      bookingResult.rows.map(async (row) => {
        const record = await this.loadRecord(row, (text, values) =>
          this.database.query<PassengerRow>(text, values),
        );
        return record.booking;
      }),
    );
    const summaryResult = await this.database.query<BookingSummaryRow>(
      `SELECT COUNT(*)::int AS booking_count,
              COALESCE(SUM(seat_count), 0)::int AS passenger_count,
              COALESCE(SUM(CASE WHEN status IN ('PAID', 'TICKET_ISSUED', 'CHECKED_IN', 'COMPLETED')
                                THEN total_price_vnd ELSE 0 END), 0)::bigint::text AS revenue_vnd
       FROM booking.bookings
       ${tripClause}`,
      tripValues,
    );
    const statusResult = await this.database.query<BookingStatusCountRow>(
      `SELECT status, COUNT(*)::int AS count
       FROM booking.bookings
       ${tripClause}
       GROUP BY status
       ORDER BY status`,
      tripValues,
    );
    const auditTripClause = tripId ? 'WHERE trip_id = $1' : '';
    const auditResult = await this.database.query<BookingAuditRow>(
      `SELECT id, action, target_type, target_id, actor_id, actor_role,
              occurred_at, request_id, trace_id
       FROM booking.operational_audit
       ${auditTripClause}
       ORDER BY occurred_at DESC, id DESC
       LIMIT $${tripValues.length + 1}`,
      [...tripValues, auditLimit],
    );
    const summary = summaryResult.rows[0];
    return {
      bookings,
      summary: {
        bookingCount: summary?.booking_count ?? 0,
        passengerCount: summary?.passenger_count ?? 0,
        revenueVnd: Number(summary?.revenue_vnd ?? 0),
        statusCounts: statusResult.rows.map((row) => ({ status: row.status, count: row.count })),
      },
      auditEvents: auditResult.rows.map((row) => ({
        id: row.id,
        action: row.action,
        targetType: row.target_type,
        targetId: row.target_id,
        actorId: row.actor_id,
        actorRole: row.actor_role,
        occurredAt: row.occurred_at.toISOString(),
        requestId: row.request_id,
        traceId: row.trace_id,
      })),
    };
  }

  async findFulfillmentSnapshot(bookingId: string): Promise<BookingFulfillmentSnapshot | null> {
    const result = await this.database.query<BookingRow>(bookingByUnscopedIdSql, [bookingId]);
    const row = result.rows[0];
    if (!row || row.paid_at === null) return null;
    const record = await this.loadRecord(row, (text, values) =>
      this.database.query<PassengerRow>(text, values),
    );
    return {
      booking: record.booking,
      owner: { type: row.checkout_owner_type, id: row.checkout_owner_id },
      paidAt: row.paid_at.toISOString(),
    };
  }

  async findGuestBookingLookup(
    bookingCode: string,
    normalizedEmail: string,
    now: Date,
  ): Promise<GuestBookingLookup | null> {
    const result = await this.database.query<
      QueryResultRow & {
        booking_code: string;
        status: BookingStatus;
        trip_id: string;
        origin_name: string;
        destination_name: string;
        departure_at: Date;
        timezone: string;
        seat_ids: string[];
      }
    >(
      `SELECT
        booking.booking_code,
        booking.status,
        booking.trip_id,
        booking.origin_name,
        booking.destination_name,
        booking.departure_at,
        booking.timezone,
        COALESCE(array_agg(passenger.seat_id ORDER BY passenger.seat_id), ARRAY[]::text[]) AS seat_ids
      FROM booking.bookings AS booking
      LEFT JOIN booking.passengers AS passenger ON passenger.booking_id = booking.id
      WHERE booking.booking_code = $1 AND booking.normalized_email = $2
      GROUP BY booking.id`,
      [bookingCode, normalizedEmail],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      bookingCode: row.booking_code,
      status: row.status,
      tripId: row.trip_id,
      originName: row.origin_name,
      destinationName: row.destination_name,
      departureAt: row.departure_at.toISOString(),
      timezone: row.timezone,
      seatIds: row.seat_ids,
      ticketIssued: ['TICKET_ISSUED', 'CHECKED_IN', 'COMPLETED'].includes(row.status),
      cancellationEligible:
        ['PAID', 'TICKET_ISSUED'].includes(row.status) &&
        row.departure_at.getTime() > now.getTime(),
    };
  }

  async markTicketIssued(
    bookingId: string,
    occurredAt: string,
    actorId: string,
    tickets: PersistedTicketReference[],
  ): Promise<TicketIssuedTransition> {
    return this.database.withTransaction(async (client) => {
      const lockedBooking = await client.query<{ status: BookingStatus } & QueryResultRow>(
        'SELECT status FROM booking.bookings WHERE id = $1 FOR UPDATE',
        [bookingId],
      );
      const currentStatus = lockedBooking.rows[0]?.status;
      if (!currentStatus) throw new Error('Booking was not found before ticket issuance.');
      if (!['PAID', 'TICKET_ISSUED', 'CHECKED_IN', 'COMPLETED'].includes(currentStatus)) {
        return { status: currentStatus, transitioned: false };
      }

      for (const ticket of tickets) {
        await client.query(
          `INSERT INTO booking.issued_ticket_refs (
            ticket_id, booking_id, passenger_id, ticket_code, qr_payload_hash, issued_at
          ) VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (ticket_id) DO NOTHING`,
          [
            ticket.ticketId,
            bookingId,
            ticket.passengerId,
            ticket.ticketCode,
            ticket.qrPayloadHash,
            occurredAt,
          ],
        );
      }
      const storedTickets = await client.query<TicketReferenceRow>(
        `SELECT ticket_id, booking_id, passenger_id, ticket_code, qr_payload_hash
         FROM booking.issued_ticket_refs WHERE booking_id = $1 ORDER BY passenger_id`,
        [bookingId],
      );
      if (!sameTicketReferences(storedTickets.rows, tickets)) {
        throw new TicketReferenceConflictError();
      }
      const updated = await client.query(
        `UPDATE booking.bookings
         SET status = 'TICKET_ISSUED', updated_at = $2
         WHERE id = $1 AND status = 'PAID'`,
        [bookingId, occurredAt],
      );
      if (updated.rowCount === 1) {
        await client.query(
          `INSERT INTO booking.status_history (
            id, booking_id, from_status, to_status, actor_type, actor_id, occurred_at
          ) VALUES ($1, $2, 'PAID', 'TICKET_ISSUED', 'SYSTEM', $3, $4)`,
          [randomUUID(), bookingId, actorId, occurredAt],
        );
      }
      const selected = await client.query<{ status: BookingStatus } & QueryResultRow>(
        'SELECT status FROM booking.bookings WHERE id = $1',
        [bookingId],
      );
      const status = selected.rows[0]?.status;
      if (!status) throw new Error('Booking was not found after ticket-issued transition.');
      return { status, transitioned: updated.rowCount === 1 };
    });
  }

  async findStaffTickets(
    kind: StaffTicketCredentialKind,
    credential: string,
  ): Promise<StaffTicketView[]> {
    const result = await this.database.query<StaffTicketRow>(
      `${staffTicketSelectSql}
       WHERE ${ticketCredentialClause(kind)}
       ORDER BY passenger.seat_id`,
      [credential],
    );
    return result.rows.map(mapStaffTicket);
  }

  async checkInTicket(command: TicketCheckInCommand): Promise<TicketCheckInTransition | null> {
    return this.database.withTransaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `booking-check-in:${command.actor.id}:${command.idempotencyKey}`,
      ]);
      const target = await client.query<StaffTicketRow>(
        `${staffTicketSelectSql}
         WHERE ${ticketCredentialClause(command.kind)}
         FOR UPDATE OF ticket_ref, booking`,
        [command.credential],
      );
      const ticket = target.rows[0];
      if (!ticket) return null;
      if (ticket.trip_id !== command.tripId) throw new TicketWrongTripError();

      const prior = await client.query<{ ticket_id: string } & QueryResultRow>(
        `SELECT ticket_id FROM booking.ticket_check_ins
         WHERE actor_id = $1 AND idempotency_key = $2`,
        [command.actor.id, command.idempotencyKey],
      );
      if (prior.rows[0]) {
        if (prior.rows[0].ticket_id !== ticket.ticket_id) {
          throw new TicketCheckInIdempotencyConflictError();
        }
        return { ticket: mapStaffTicket(ticket), transitioned: true };
      }
      if (ticket.booking_status !== 'TICKET_ISSUED' && ticket.booking_status !== 'CHECKED_IN') {
        throw new TicketCheckInStateError(ticket.booking_status);
      }
      if (ticket.checked_in_at) {
        return { ticket: mapStaffTicket(ticket), transitioned: false };
      }

      const checkedInAt = new Date().toISOString();
      await client.query(
        `INSERT INTO booking.ticket_check_ins (
          ticket_id, booking_id, passenger_id, idempotency_key,
          actor_id, actor_role, request_id, trace_id, checked_in_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          ticket.ticket_id,
          ticket.booking_id,
          ticket.passenger_id,
          command.idempotencyKey,
          command.actor.id,
          command.actor.role,
          command.requestId,
          command.traceId,
          checkedInAt,
        ],
      );
      await insertOperationalAudit(client, {
        action: 'TICKET_CHECKED_IN',
        targetType: 'TICKET',
        targetId: ticket.ticket_id,
        tripId: ticket.trip_id,
        actorId: command.actor.id,
        actorRole: command.actor.role,
        requestId: command.requestId,
        traceId: command.traceId,
        occurredAt: checkedInAt,
      });
      if (ticket.booking_status === 'TICKET_ISSUED') {
        await client.query(
          `UPDATE booking.bookings SET status = 'CHECKED_IN', updated_at = $2
           WHERE id = $1 AND status = 'TICKET_ISSUED'`,
          [ticket.booking_id, checkedInAt],
        );
        await client.query(
          `INSERT INTO booking.status_history (
            id, booking_id, from_status, to_status, actor_type, actor_id, occurred_at
          ) VALUES ($1, $2, 'TICKET_ISSUED', 'CHECKED_IN', $3, $4, $5)`,
          [randomUUID(), ticket.booking_id, command.actor.role, command.actor.id, checkedInAt],
        );
      }
      return {
        ticket: mapStaffTicket({
          ...ticket,
          booking_status: 'CHECKED_IN',
          checked_in_at: new Date(checkedInAt),
        }),
        transitioned: true,
      };
    });
  }

  async markPaid(
    bookingId: string,
    owner: CheckoutOwner,
    paymentAttemptId: string,
    paymentIdempotencyKey: string,
    occurredAt: string,
    dispatch: EventDispatch,
    audit?: OperationalAuditContext,
  ): Promise<BookingPaymentRecord> {
    return this.database.withTransaction(async (client) => {
      const updated = await client.query(
        `UPDATE booking.bookings
         SET status = 'PAID',
             paid_payment_attempt_id = $4,
             payment_idempotency_key = $5,
             paid_at = $6,
             updated_at = $6
         WHERE id = $1
           AND checkout_owner_type = $2
           AND checkout_owner_id = $3
           AND status = 'PENDING_PAYMENT'`,
        [bookingId, owner.type, owner.id, paymentAttemptId, paymentIdempotencyKey, occurredAt],
      );
      if (updated.rowCount === 1) {
        await client.query(
          `INSERT INTO booking.status_history (
            id, booking_id, from_status, to_status, actor_type, actor_id, occurred_at
          ) VALUES ($1, $2, 'PENDING_PAYMENT', 'PAID', $3, $4, $5)`,
          [randomUUID(), bookingId, owner.type, owner.id, occurredAt],
        );
        await enqueueBookingEvent(client, dispatch);
        if (audit) {
          await insertOperationalAudit(client, {
            action: 'BOOKING_PAID',
            targetType: 'BOOKING',
            targetId: bookingId,
            tripId: dispatch.event.payload.tripId,
            ...audit,
            occurredAt,
          });
        }
      }
      const selected = await client.query<BookingRow>(bookingByIdSql, [
        bookingId,
        owner.type,
        owner.id,
      ]);
      const row = selected.rows[0];
      if (!row) throw new Error('Booking was not found after payment transition.');
      return this.loadPaymentRecord(row, (text, values) =>
        client.query<PassengerRow>(text, [...values]),
      );
    });
  }

  async markExpired(
    bookingId: string,
    owner: CheckoutOwner,
    occurredAt: string,
    actor: BookingActor,
    dispatch: EventDispatch,
  ): Promise<BookingExpiryTransition> {
    return this.database.withTransaction(async (client) => {
      const updated = await client.query(
        `UPDATE booking.bookings
         SET status = 'EXPIRED', expired_at = $4, updated_at = $4
         WHERE id = $1
           AND checkout_owner_type = $2
           AND checkout_owner_id = $3
           AND status = 'PENDING_PAYMENT'`,
        [bookingId, owner.type, owner.id, occurredAt],
      );
      if (updated.rowCount === 1) {
        await client.query(
          `INSERT INTO booking.status_history (
            id, booking_id, from_status, to_status, actor_type, actor_id, occurred_at
          ) VALUES ($1, $2, 'PENDING_PAYMENT', 'EXPIRED', $3, $4, $5)`,
          [randomUUID(), bookingId, actor.type, actor.id, occurredAt],
        );
        await enqueueBookingEvent(client, dispatch);
      }
      const selected = await client.query<BookingRow>(bookingByIdSql, [
        bookingId,
        owner.type,
        owner.id,
      ]);
      const row = selected.rows[0];
      if (!row) throw new Error('Booking was not found after expiry transition.');
      return {
        record: await this.loadPaymentRecord(row, (text, values) =>
          client.query<PassengerRow>(text, [...values]),
        ),
        transitioned: updated.rowCount === 1,
      };
    });
  }

  async markCancelled(
    bookingId: string,
    owner: CheckoutOwner,
    idempotencyKey: string,
    occurredAt: string,
    policyCode: 'BEFORE_DEPARTURE_FULL_RELEASE',
    dispatch: EventDispatch,
    audit?: OperationalAuditContext,
  ): Promise<BookingCancellationTransition> {
    return this.database.withTransaction(async (client) => {
      const selected = await client.query<BookingRow>(`${bookingByIdSql} FOR UPDATE`, [
        bookingId,
        owner.type,
        owner.id,
      ]);
      const before = selected.rows[0];
      if (!before) throw new Error('Booking was not found during cancellation transition.');
      let transitioned = false;
      if (before.status === 'PAID' || before.status === 'TICKET_ISSUED') {
        await client.query(
          `UPDATE booking.bookings
           SET status = 'CANCELLED', cancelled_at = $4,
               cancellation_idempotency_key = $5,
               cancellation_policy_code = $6,
               updated_at = $4
           WHERE id = $1 AND checkout_owner_type = $2 AND checkout_owner_id = $3`,
          [bookingId, owner.type, owner.id, occurredAt, idempotencyKey, policyCode],
        );
        await client.query(
          `INSERT INTO booking.status_history (
            id, booking_id, from_status, to_status, actor_type, actor_id, occurred_at
          ) VALUES ($1, $2, $3, 'CANCELLED', 'CUSTOMER', $4, $5)`,
          [randomUUID(), bookingId, before.status, owner.id, occurredAt],
        );
        await enqueueBookingEvent(client, dispatch);
        if (audit) {
          await insertOperationalAudit(client, {
            action: 'BOOKING_CANCELLED',
            targetType: 'BOOKING',
            targetId: bookingId,
            tripId: dispatch.event.payload.tripId,
            ...audit,
            occurredAt,
          });
        }
        transitioned = true;
      }
      const after = await client.query<BookingRow>(bookingByIdSql, [
        bookingId,
        owner.type,
        owner.id,
      ]);
      return {
        record: await this.loadPaymentRecord(after.rows[0]!, (text, values) =>
          client.query<PassengerRow>(text, [...values]),
        ),
        transitioned,
      };
    });
  }

  async markCancellationSeatsReleased(
    bookingId: string,
    idempotencyKey: string,
    releasedAt: string,
  ): Promise<void> {
    await this.database.query(
      `UPDATE booking.bookings
       SET cancellation_seats_released_at = COALESCE(cancellation_seats_released_at, $3),
           updated_at = GREATEST(updated_at, $3::timestamptz)
       WHERE id = $1 AND status = 'CANCELLED' AND cancellation_idempotency_key = $2`,
      [bookingId, idempotencyKey, releasedAt],
    );
  }

  async findCancellationReleaseCandidates(
    limit: number,
  ): Promise<BookingCancellationReleaseCandidate[]> {
    const result = await this.database.query<
      QueryResultRow & {
        id: string;
        checkout_owner_id: string;
        cancellation_idempotency_key: string;
      }
    >(
      `SELECT id, checkout_owner_id, cancellation_idempotency_key
       FROM booking.bookings
       WHERE status = 'CANCELLED'
         AND checkout_owner_type = 'CUSTOMER'
         AND cancellation_seats_released_at IS NULL
       ORDER BY cancelled_at, id
       LIMIT $1`,
      [limit],
    );
    return result.rows.map((row) => ({
      bookingId: row.id,
      owner: { type: 'CUSTOMER', id: row.checkout_owner_id },
      idempotencyKey: row.cancellation_idempotency_key,
    }));
  }

  async findExpiryCandidates(limit: number): Promise<BookingExpiryCandidate[]> {
    const result = await this.database.query<
      QueryResultRow & {
        id: string;
        checkout_owner_type: CheckoutOwner['type'];
        checkout_owner_id: string;
      }
    >(
      `SELECT id, checkout_owner_type, checkout_owner_id
       FROM booking.bookings
       WHERE status = 'PENDING_PAYMENT'
         AND (hold_expires_at <= now() OR departure_at <= now())
       ORDER BY LEAST(hold_expires_at, departure_at), id
       LIMIT $1`,
      [limit],
    );
    return result.rows.map((row) => ({
      bookingId: row.id,
      owner: { type: row.checkout_owner_type, id: row.checkout_owner_id },
    }));
  }

  async createOrReplay(
    input: PersistBookingInput,
    dispatch: EventDispatch,
  ): Promise<BookingReplayRecord> {
    return this.database.withTransaction(async (client) => {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO booking.bookings (
          id, booking_code, status, checkout_owner_type, checkout_owner_id,
          idempotency_key, request_fingerprint, hold_token, hold_expires_at,
          contact_full_name, contact_email, normalized_email, contact_phone,
          trip_id, route_id, route_code, operator_name, vehicle_type_name,
          vehicle_code, vehicle_plate, origin_name, destination_name,
          pickup_name, dropoff_name, departure_at, arrival_at, timezone,
          unit_price_vnd, seat_count, total_price_vnd, created_at, updated_at
        ) VALUES (
          $1, $2, 'PENDING_PAYMENT', $3, $4,
          $5, $6, $7, $8,
          $9, $10, $11, $12,
          $13, $14, $15, $16, $17,
          $18, $19, $20, $21,
          $22, $23, $24, $25, $26,
          $27, $28, $29, $30, $30
        )
        ON CONFLICT ON CONSTRAINT bookings_owner_idempotency_key DO NOTHING
        RETURNING id`,
        [
          input.id,
          input.bookingCode,
          input.owner.type,
          input.owner.id,
          input.idempotencyKey,
          input.requestFingerprint,
          input.holdToken,
          input.holdExpiresAt,
          input.contact.fullName,
          input.contact.email,
          input.normalizedEmail,
          input.contact.phone,
          input.trip.tripId,
          input.trip.routeId,
          input.trip.routeCode,
          input.trip.operatorName,
          input.trip.vehicleTypeName,
          input.trip.vehicleCode,
          input.trip.vehiclePlate,
          input.trip.originName,
          input.trip.destinationName,
          input.trip.pickupName,
          input.trip.dropoffName,
          input.trip.departureAt,
          input.trip.arrivalAt,
          input.trip.timezone,
          input.trip.unitPriceVnd,
          input.passengers.length,
          input.totalPriceVnd,
          input.createdAt,
        ],
      );

      if (inserted.rowCount === 1) {
        for (const passenger of input.passengers) {
          await client.query(
            `INSERT INTO booking.passengers (
              id, booking_id, seat_id, full_name, phone,
              document_number_hash, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              passenger.id,
              input.id,
              passenger.seatId,
              passenger.fullName,
              passenger.phone ?? null,
              passenger.documentNumberHash ?? null,
              input.createdAt,
            ],
          );
        }
        await client.query(
          `INSERT INTO booking.status_history (
            id, booking_id, from_status, to_status, actor_type, actor_id, occurred_at
          ) VALUES ($1, $2, NULL, 'PENDING_PAYMENT', $3, $4, $5)`,
          [randomUUID(), input.id, input.owner.type, input.owner.id, input.createdAt],
        );
        await enqueueBookingEvent(client, dispatch);
      }

      const existing = await client.query<BookingRow>(bookingByIdempotencySql, [
        input.owner.type,
        input.owner.id,
        input.idempotencyKey,
      ]);
      const row = existing.rows[0];
      if (!row) throw new Error('Booking insert did not produce an idempotency record.');
      return this.loadRecord(row, (text, values) => client.query<PassengerRow>(text, [...values]));
    });
  }

  private async loadRecord(
    row: BookingRow,
    queryPassengers: (
      text: string,
      values: readonly unknown[],
    ) => Promise<{ rows: PassengerRow[] }>,
  ): Promise<BookingReplayRecord> {
    const passengerResult = await queryPassengers(
      `SELECT
        id, seat_id, full_name, phone,
        document_number_hash IS NOT NULL AS has_document_number
      FROM booking.passengers
      WHERE booking_id = $1
      ORDER BY seat_id`,
      [row.id],
    );
    return {
      booking: mapBooking(row, passengerResult.rows),
      requestFingerprint: row.request_fingerprint.trim(),
    };
  }

  private async loadPaymentRecord(
    row: BookingRow,
    queryPassengers: (
      text: string,
      values: readonly unknown[],
    ) => Promise<{ rows: PassengerRow[] }>,
  ): Promise<BookingPaymentRecord> {
    const record = await this.loadRecord(row, queryPassengers);
    return {
      booking: record.booking,
      holdToken: row.hold_token,
      ...(row.paid_payment_attempt_id !== null && {
        paidPaymentAttemptId: row.paid_payment_attempt_id,
      }),
      ...(row.payment_idempotency_key !== null && {
        paymentIdempotencyKey: row.payment_idempotency_key,
      }),
      ...(row.paid_at !== null && { paidAt: row.paid_at.toISOString() }),
      ...(row.cancelled_at !== null && { cancelledAt: row.cancelled_at.toISOString() }),
      ...(row.cancellation_idempotency_key !== null && {
        cancellationIdempotencyKey: row.cancellation_idempotency_key,
      }),
      ...(row.cancellation_policy_code !== null && {
        cancellationPolicyCode: row.cancellation_policy_code,
      }),
      ...(row.cancellation_seats_released_at !== null && {
        cancellationSeatsReleasedAt: row.cancellation_seats_released_at.toISOString(),
      }),
    };
  }
}

const bookingSelectSql = `SELECT
  id, booking_code, status, checkout_owner_type, checkout_owner_id,
  request_fingerprint, hold_token, hold_expires_at,
  contact_full_name, contact_email, contact_phone,
  trip_id, route_id, route_code, operator_name, vehicle_type_name,
  vehicle_code, vehicle_plate, origin_name, destination_name,
  pickup_name, dropoff_name, departure_at, arrival_at, timezone,
  unit_price_vnd, total_price_vnd,
  paid_payment_attempt_id, payment_idempotency_key, paid_at, expired_at,
  cancelled_at, cancellation_idempotency_key, cancellation_policy_code,
  cancellation_seats_released_at,
  created_at
FROM booking.bookings`;

const bookingByIdempotencySql = `${bookingSelectSql}
WHERE checkout_owner_type = $1
  AND checkout_owner_id = $2
  AND idempotency_key = $3`;

const bookingByIdSql = `${bookingSelectSql}
WHERE id = $1
  AND checkout_owner_type = $2
  AND checkout_owner_id = $3`;

const bookingByUnscopedIdSql = `${bookingSelectSql}
WHERE id = $1`;

const staffTicketSelectSql = `SELECT
  ticket_ref.ticket_id,
  ticket_ref.ticket_code,
  booking.id AS booking_id,
  booking.booking_code,
  booking.status AS booking_status,
  passenger.id AS passenger_id,
  passenger.full_name AS passenger_name,
  passenger.seat_id,
  booking.trip_id,
  booking.origin_name,
  booking.destination_name,
  booking.departure_at,
  check_in.checked_in_at
FROM booking.issued_ticket_refs AS ticket_ref
JOIN booking.bookings AS booking ON booking.id = ticket_ref.booking_id
JOIN booking.passengers AS passenger ON passenger.id = ticket_ref.passenger_id
LEFT JOIN booking.ticket_check_ins AS check_in ON check_in.ticket_id = ticket_ref.ticket_id`;

function ticketCredentialClause(kind: StaffTicketCredentialKind): string {
  if (kind === 'BOOKING_CODE') return 'booking.booking_code = $1';
  if (kind === 'TICKET_CODE') return 'ticket_ref.ticket_code = $1';
  return 'ticket_ref.qr_payload_hash = $1';
}

function mapStaffTicket(row: StaffTicketRow): StaffTicketView {
  return {
    ticketId: row.ticket_id,
    ticketCode: row.ticket_code,
    bookingId: row.booking_id,
    bookingCode: row.booking_code,
    bookingStatus: row.booking_status,
    passengerId: row.passenger_id,
    passengerName: row.passenger_name,
    seatId: row.seat_id,
    tripId: row.trip_id,
    routeLabel: `${row.origin_name} -> ${row.destination_name}`,
    departureAt: row.departure_at.toISOString(),
    ...(row.checked_in_at !== null && { checkedInAt: row.checked_in_at.toISOString() }),
  };
}

function sameTicketReferences(
  stored: TicketReferenceRow[],
  expected: PersistedTicketReference[],
): boolean {
  if (stored.length !== expected.length) return false;
  const orderedExpected = [...expected].sort((left, right) =>
    left.passengerId.localeCompare(right.passengerId),
  );
  return stored.every((row, index) => {
    const ticket = orderedExpected[index];
    return (
      ticket !== undefined &&
      row.ticket_id === ticket.ticketId &&
      row.passenger_id === ticket.passengerId &&
      row.ticket_code === ticket.ticketCode &&
      row.qr_payload_hash.trim() === ticket.qrPayloadHash
    );
  });
}

function mapBooking(row: BookingRow, passengers: PassengerRow[]): BookingView {
  const trip: BookingTripSnapshot = {
    tripId: row.trip_id,
    routeId: row.route_id,
    routeCode: row.route_code,
    operatorName: row.operator_name,
    vehicleTypeName: row.vehicle_type_name,
    vehicleCode: row.vehicle_code,
    vehiclePlate: row.vehicle_plate,
    originName: row.origin_name,
    destinationName: row.destination_name,
    pickupName: row.pickup_name,
    dropoffName: row.dropoff_name,
    departureAt: row.departure_at.toISOString(),
    arrivalAt: row.arrival_at.toISOString(),
    timezone: row.timezone,
    unitPriceVnd: row.unit_price_vnd,
  };
  return {
    id: row.id,
    bookingCode: row.booking_code,
    status: row.status,
    trip,
    contact: {
      fullName: row.contact_full_name,
      email: row.contact_email,
      phone: row.contact_phone,
    },
    passengers: passengers.map(mapPassenger),
    totalPriceVnd: row.total_price_vnd,
    holdExpiresAt: row.hold_expires_at.toISOString(),
    createdAt: row.created_at.toISOString(),
  };
}

function mapPassenger(row: PassengerRow): BookingPassenger {
  return {
    id: row.id,
    seatId: row.seat_id,
    fullName: row.full_name,
    ...(row.phone !== null && { phone: row.phone }),
    hasDocumentNumber: row.has_document_number,
  };
}

async function insertOperationalAudit(
  client: PoolClient,
  event: {
    action: string;
    targetType: string;
    targetId: string;
    tripId: string;
    actorId: string;
    actorRole: BookingAuditEvent['actorRole'];
    requestId: string;
    traceId: string;
    occurredAt: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO booking.operational_audit (
      id, action, target_type, target_id, trip_id, actor_id, actor_role,
      request_id, trace_id, occurred_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      randomUUID(),
      event.action,
      event.targetType,
      event.targetId,
      event.tripId,
      event.actorId,
      event.actorRole,
      event.requestId,
      event.traceId,
      event.occurredAt,
    ],
  );
}
