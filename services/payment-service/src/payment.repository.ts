import { Inject, Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';

import { PaymentDatabase } from './payment.database';
import type { PaymentEventDispatch } from './payment.events';
import { enqueuePaymentEvent } from './payment-outbox.repository';
import type { PaymentAttemptView, PersistPaymentAttemptInput } from './payment.types';

interface PaymentAttemptRow extends QueryResultRow {
  id: string;
  booking_id: string;
  status: 'SUCCEEDED' | 'FAILED';
  amount_vnd: number;
  failure_code: string | null;
  request_fingerprint: string;
  created_at: Date;
}

export interface PaymentAttemptRecord {
  attempt: PaymentAttemptView;
  requestFingerprint: string;
}

@Injectable()
export class PaymentRepository {
  constructor(@Inject(PaymentDatabase) private readonly database: PaymentDatabase) {}

  async findByIdempotency(
    bookingId: string,
    idempotencyKey: string,
  ): Promise<PaymentAttemptRecord | null> {
    const result = await this.database.query<PaymentAttemptRow>(paymentByIdempotencySql, [
      bookingId,
      idempotencyKey,
    ]);
    return result.rows[0] ? mapRecord(result.rows[0]) : null;
  }

  async createOrReplay(
    input: PersistPaymentAttemptInput,
    dispatch: PaymentEventDispatch,
  ): Promise<PaymentAttemptRecord> {
    return this.database.withTransaction(async (client) => {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO payment.attempts (
          id, booking_id, owner_type, owner_id, amount_vnd,
          requested_outcome, status, failure_code, idempotency_key,
          request_fingerprint, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT DO NOTHING
        RETURNING id`,
        [
          input.id,
          input.bookingId,
          input.owner.type,
          input.owner.id,
          input.amountVnd,
          input.requestedOutcome,
          input.status,
          input.failureCode ?? null,
          input.idempotencyKey,
          input.requestFingerprint,
          input.createdAt,
        ],
      );
      if (inserted.rowCount === 1) await enqueuePaymentEvent(client, dispatch);

      const idempotent = await client.query<PaymentAttemptRow>(paymentByIdempotencySql, [
        input.bookingId,
        input.idempotencyKey,
      ]);
      if (idempotent.rows[0]) return mapRecord(idempotent.rows[0]);

      if (input.status === 'SUCCEEDED') {
        const successful = await client.query<PaymentAttemptRow>(
          `${paymentSelectSql}
           WHERE booking_id = $1 AND status = 'SUCCEEDED'
           ORDER BY created_at
           LIMIT 1`,
          [input.bookingId],
        );
        if (successful.rows[0]) return mapRecord(successful.rows[0]);
      }

      throw new Error('Payment attempt insert did not produce an idempotency record.');
    });
  }
}

const paymentSelectSql = `SELECT
  id, booking_id, status, amount_vnd, failure_code,
  request_fingerprint, created_at
FROM payment.attempts`;

const paymentByIdempotencySql = `${paymentSelectSql}
WHERE booking_id = $1 AND idempotency_key = $2`;

function mapRecord(row: PaymentAttemptRow): PaymentAttemptRecord {
  return {
    attempt: {
      id: row.id,
      bookingId: row.booking_id,
      status: row.status,
      amountVnd: row.amount_vnd,
      ...(row.failure_code !== null && { failureCode: row.failure_code }),
      createdAt: row.created_at.toISOString(),
    },
    requestFingerprint: row.request_fingerprint.trim(),
  };
}
