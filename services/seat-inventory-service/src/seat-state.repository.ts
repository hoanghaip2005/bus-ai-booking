import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { QueryResultRow } from 'pg';

import { SeatInventoryDatabase } from './seat-inventory.database';

export type DurableSeatStatus = 'BOOKED' | 'BLOCKED';

export interface DurableSeatState {
  seatId: string;
  status: DurableSeatStatus;
}

interface SeatStateRow {
  seat_id: string;
  status: DurableSeatStatus;
  booking_id?: string | null;
}

interface ConfirmationRow extends QueryResultRow {
  request_fingerprint: string;
  confirmed_at: Date;
}

interface ReleaseRow extends QueryResultRow {
  idempotency_key: string;
  request_fingerprint: string;
  released_at: Date;
}

interface SeatBlockCommandRow extends QueryResultRow {
  request_fingerprint: string;
  trip_id: string;
  seat_ids: string[];
  blocked: boolean;
  changed: boolean;
  updated_at: Date;
}

export interface ConfirmDurableSeatsInput {
  bookingId: string;
  tripId: string;
  seatIds: string[];
  idempotencyKey: string;
  requestFingerprint: string;
  holdTokenHash: string;
  confirmedAt: string;
}

export interface SeatConfirmationRecord {
  requestFingerprint: string;
  confirmedAt: string;
}

export interface ReleaseBookedSeatsInput {
  bookingId: string;
  tripId: string;
  seatIds: string[];
  idempotencyKey: string;
  requestFingerprint: string;
  releasedAt: string;
}

export interface SeatReleaseRecord {
  idempotencyKey: string;
  requestFingerprint: string;
  releasedAt: string;
}

export interface SetSeatBlockedInput {
  tripId: string;
  seatIds: string[];
  blocked: boolean;
  reason: string;
  actorId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  requestId: string;
  traceId: string;
  updatedAt: string;
}

export interface SeatBlockRecord {
  tripId: string;
  seatIds: string[];
  blocked: boolean;
  changed: boolean;
  requestFingerprint: string;
  updatedAt: string;
}

export class SeatConfirmationUnavailablePersistenceError extends Error {
  constructor() {
    super('One or more seats are already booked or blocked.');
    this.name = 'SeatConfirmationUnavailablePersistenceError';
  }
}

export class SeatReleaseMismatchPersistenceError extends Error {
  constructor() {
    super('Booked seats do not exactly match the cancellation request.');
    this.name = 'SeatReleaseMismatchPersistenceError';
  }
}

export class SeatBlockBookedPersistenceError extends Error {
  constructor() {
    super('Booked seats cannot be blocked or unblocked.');
    this.name = 'SeatBlockBookedPersistenceError';
  }
}

@Injectable()
export class SeatStateRepository {
  constructor(@Inject(SeatInventoryDatabase) private readonly database: SeatInventoryDatabase) {}

  async listByTrip(tripId: string): Promise<DurableSeatState[]> {
    const result = await this.database.query<SeatStateRow>(
      `
        SELECT seat_id, status
        FROM seat_inventory.trip_seat_states
        WHERE trip_id = $1
        ORDER BY seat_id
      `,
      [tripId],
    );
    return result.rows.map((row) => ({ seatId: row.seat_id, status: row.status }));
  }

  async findConfirmation(
    bookingId: string,
    idempotencyKey: string,
  ): Promise<SeatConfirmationRecord | null> {
    const result = await this.database.query<ConfirmationRow>(
      `SELECT request_fingerprint, confirmed_at
       FROM seat_inventory.confirmation_requests
       WHERE booking_id = $1 AND idempotency_key = $2`,
      [bookingId, idempotencyKey],
    );
    const row = result.rows[0];
    return row
      ? {
          requestFingerprint: row.request_fingerprint.trim(),
          confirmedAt: row.confirmed_at.toISOString(),
        }
      : null;
  }

  async confirmSeats(input: ConfirmDurableSeatsInput): Promise<SeatConfirmationRecord> {
    return this.database.withTransaction(async (client) => {
      await client.query(
        `INSERT INTO seat_inventory.confirmation_requests (
          booking_id, idempotency_key, request_fingerprint, hold_token_hash,
          trip_id, seat_ids, confirmed_at
        ) VALUES ($1, $2, $3, $4, $5, $6::text[], $7)
        ON CONFLICT (booking_id, idempotency_key) DO NOTHING`,
        [
          input.bookingId,
          input.idempotencyKey,
          input.requestFingerprint,
          input.holdTokenHash,
          input.tripId,
          input.seatIds,
          input.confirmedAt,
        ],
      );

      const confirmation = await client.query<ConfirmationRow>(
        `SELECT request_fingerprint, confirmed_at
         FROM seat_inventory.confirmation_requests
         WHERE booking_id = $1 AND idempotency_key = $2
         FOR UPDATE`,
        [input.bookingId, input.idempotencyKey],
      );
      const confirmationRow = confirmation.rows[0];
      if (!confirmationRow) throw new Error('Seat confirmation idempotency record was not found.');
      if (confirmationRow.request_fingerprint.trim() !== input.requestFingerprint) {
        return {
          requestFingerprint: confirmationRow.request_fingerprint.trim(),
          confirmedAt: confirmationRow.confirmed_at.toISOString(),
        };
      }

      for (const seatId of input.seatIds) {
        await client.query(
          `INSERT INTO seat_inventory.trip_seat_states (
            trip_id, seat_id, status, booking_id, reason, updated_by_actor, updated_at
          ) VALUES ($1, $2, 'BOOKED', $3, NULL, $4, $5)
          ON CONFLICT (trip_id, seat_id) DO NOTHING`,
          [
            input.tripId,
            seatId,
            input.bookingId,
            `booking-service:${input.bookingId}`,
            input.confirmedAt,
          ],
        );
      }

      const states = await client.query<SeatStateRow & QueryResultRow>(
        `SELECT seat_id, status, booking_id
         FROM seat_inventory.trip_seat_states
         WHERE trip_id = $1 AND seat_id = ANY($2::text[])
         ORDER BY seat_id
         FOR UPDATE`,
        [input.tripId, input.seatIds],
      );
      if (
        states.rows.length !== input.seatIds.length ||
        states.rows.some((row) => row.status !== 'BOOKED' || row.booking_id !== input.bookingId)
      ) {
        throw new SeatConfirmationUnavailablePersistenceError();
      }

      return {
        requestFingerprint: confirmationRow.request_fingerprint.trim(),
        confirmedAt: confirmationRow.confirmed_at.toISOString(),
      };
    });
  }

  async releaseBookedSeats(input: ReleaseBookedSeatsInput): Promise<SeatReleaseRecord> {
    return this.database.withTransaction(async (client) => {
      const existing = await client.query<ReleaseRow>(
        `SELECT idempotency_key, request_fingerprint, released_at
         FROM seat_inventory.release_requests
         WHERE booking_id = $1
         FOR UPDATE`,
        [input.bookingId],
      );
      const existingRow = existing.rows[0];
      if (existingRow) return mapRelease(existingRow);

      const states = await client.query<SeatStateRow & QueryResultRow>(
        `SELECT seat_id, status, booking_id
         FROM seat_inventory.trip_seat_states
         WHERE trip_id = $1 AND seat_id = ANY($2::text[])
         ORDER BY seat_id
         FOR UPDATE`,
        [input.tripId, input.seatIds],
      );
      if (
        states.rows.length !== input.seatIds.length ||
        states.rows.some((row) => row.status !== 'BOOKED' || row.booking_id !== input.bookingId)
      ) {
        throw new SeatReleaseMismatchPersistenceError();
      }

      await client.query(
        `DELETE FROM seat_inventory.trip_seat_states
         WHERE trip_id = $1 AND seat_id = ANY($2::text[]) AND booking_id = $3`,
        [input.tripId, input.seatIds, input.bookingId],
      );
      const inserted = await client.query<ReleaseRow>(
        `INSERT INTO seat_inventory.release_requests (
          booking_id, idempotency_key, request_fingerprint, trip_id, seat_ids, released_at
        ) VALUES ($1, $2, $3, $4, $5::text[], $6)
        RETURNING idempotency_key, request_fingerprint, released_at`,
        [
          input.bookingId,
          input.idempotencyKey,
          input.requestFingerprint,
          input.tripId,
          input.seatIds,
          input.releasedAt,
        ],
      );
      return mapRelease(inserted.rows[0]!);
    });
  }

  async setSeatBlocked(input: SetSeatBlockedInput): Promise<SeatBlockRecord> {
    return this.database.withTransaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `${input.actorId}:${input.idempotencyKey}`,
      ]);
      const replay = await client.query<SeatBlockCommandRow>(
        `SELECT request_fingerprint, trip_id, seat_ids, blocked, changed, updated_at
           FROM seat_inventory.seat_block_commands
          WHERE actor_id = $1 AND idempotency_key = $2`,
        [input.actorId, input.idempotencyKey],
      );
      if (replay.rows[0]) return mapSeatBlock(replay.rows[0]);

      const existing = await client.query<SeatStateRow & QueryResultRow>(
        `SELECT seat_id, status, booking_id
           FROM seat_inventory.trip_seat_states
          WHERE trip_id = $1 AND seat_id = ANY($2::text[])
          FOR UPDATE`,
        [input.tripId, input.seatIds],
      );
      if (existing.rows.some((row) => row.status === 'BOOKED')) {
        throw new SeatBlockBookedPersistenceError();
      }
      const blockedSeats = new Set(existing.rows.map((row) => row.seat_id));
      const changed = input.blocked
        ? input.seatIds.some((seatId) => !blockedSeats.has(seatId))
        : input.seatIds.some((seatId) => blockedSeats.has(seatId));

      if (input.blocked) {
        for (const seatId of input.seatIds) {
          await client.query(
            `INSERT INTO seat_inventory.trip_seat_states (
               trip_id, seat_id, status, booking_id, reason, updated_by_actor, updated_at
             ) VALUES ($1, $2, 'BLOCKED', NULL, $3, $4, $5)
             ON CONFLICT (trip_id, seat_id) DO UPDATE
             SET reason = EXCLUDED.reason,
                 updated_by_actor = EXCLUDED.updated_by_actor,
                 updated_at = EXCLUDED.updated_at
             WHERE trip_seat_states.status = 'BLOCKED'`,
            [input.tripId, seatId, input.reason, `admin:${input.actorId}`, input.updatedAt],
          );
        }
      } else {
        await client.query(
          `DELETE FROM seat_inventory.trip_seat_states
            WHERE trip_id = $1 AND seat_id = ANY($2::text[]) AND status = 'BLOCKED'`,
          [input.tripId, input.seatIds],
        );
      }

      const audit = await client.query<SeatBlockCommandRow>(
        `INSERT INTO seat_inventory.seat_block_commands (
           id, actor_id, actor_role, idempotency_key, request_fingerprint,
           trip_id, seat_ids, blocked, reason, changed, request_id, trace_id, updated_at
         ) VALUES ($1, $2, 'ADMIN', $3, $4, $5, $6::text[], $7, $8, $9, $10, $11, $12)
         RETURNING request_fingerprint, trip_id, seat_ids, blocked, changed, updated_at`,
        [
          randomUUID(),
          input.actorId,
          input.idempotencyKey,
          input.requestFingerprint,
          input.tripId,
          input.seatIds,
          input.blocked,
          input.reason,
          changed,
          input.requestId,
          input.traceId,
          input.updatedAt,
        ],
      );
      return mapSeatBlock(audit.rows[0]!);
    });
  }
}

function mapRelease(row: ReleaseRow): SeatReleaseRecord {
  return {
    idempotencyKey: row.idempotency_key,
    requestFingerprint: row.request_fingerprint.trim(),
    releasedAt: row.released_at.toISOString(),
  };
}

function mapSeatBlock(row: SeatBlockCommandRow): SeatBlockRecord {
  return {
    tripId: row.trip_id,
    seatIds: row.seat_ids,
    blocked: row.blocked,
    changed: row.changed,
    requestFingerprint: row.request_fingerprint.trim(),
    updatedAt: row.updated_at.toISOString(),
  };
}
