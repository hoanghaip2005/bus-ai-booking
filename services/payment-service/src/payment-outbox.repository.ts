import { randomUUID } from 'node:crypto';

import { paymentEventsTopic, type PaymentAttemptedV1 } from '@bus/contracts-events';
import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient, QueryResultRow } from 'pg';

import { PaymentDatabase } from './payment.database';
import type { PaymentEventDispatch } from './payment.events';

interface OutboxRow extends QueryResultRow {
  id: string;
  event_id: string;
  channel_name: string;
  message_key: string;
  event_type: 'PaymentAttemptedV1';
  event_version: number;
  aggregate_id: string;
  payload: PaymentAttemptedV1;
  headers: Record<string, string>;
  occurred_at: Date;
  attempt_count: number;
}

export interface PaymentOutboxMessage {
  id: string;
  eventId: string;
  channelName: string;
  messageKey: string;
  eventType: 'PaymentAttemptedV1';
  eventVersion: number;
  aggregateId: string;
  payload: PaymentAttemptedV1;
  headers: Record<string, string>;
  occurredAt: string;
  attemptCount: number;
}

export async function enqueuePaymentEvent(
  client: PoolClient,
  dispatch: PaymentEventDispatch,
): Promise<void> {
  await client.query(
    `INSERT INTO payment.outbox_events (
      id, event_id, destination, channel_name, message_key,
      event_type, event_version, aggregate_id, payload, headers, occurred_at
    ) VALUES ($1, $2, 'KAFKA', $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10)
    ON CONFLICT ON CONSTRAINT payment_outbox_event_destination_key DO NOTHING`,
    [
      randomUUID(),
      dispatch.event.eventId,
      paymentEventsTopic,
      dispatch.event.aggregateId,
      dispatch.event.eventType,
      dispatch.event.eventVersion,
      dispatch.event.aggregateId,
      JSON.stringify(dispatch.event),
      JSON.stringify(dispatch.headers),
      dispatch.event.occurredAt,
    ],
  );
}

@Injectable()
export class PaymentOutboxRepository {
  constructor(@Inject(PaymentDatabase) private readonly database: PaymentDatabase) {}

  async claimBatch(
    lockOwner: string,
    batchSize: number,
    lockTimeoutSeconds: number,
  ): Promise<PaymentOutboxMessage[]> {
    return this.database.withTransaction(async (client) => {
      const result = await client.query<OutboxRow>(
        `WITH candidates AS (
           SELECT id
           FROM payment.outbox_events
           WHERE published_at IS NULL
             AND dead_lettered_at IS NULL
             AND available_at <= now()
             AND (locked_at IS NULL OR locked_at < now() - make_interval(secs => $3))
           ORDER BY occurred_at, id
           LIMIT $2
           FOR UPDATE SKIP LOCKED
         )
         UPDATE payment.outbox_events AS outbox
         SET locked_at = now(),
             lock_owner = $1,
             attempt_count = outbox.attempt_count + 1
         FROM candidates
         WHERE outbox.id = candidates.id
         RETURNING
           outbox.id, outbox.event_id, outbox.channel_name, outbox.message_key,
           outbox.event_type, outbox.event_version, outbox.aggregate_id,
           outbox.payload, outbox.headers, outbox.occurred_at, outbox.attempt_count`,
        [lockOwner, batchSize, lockTimeoutSeconds],
      );
      return result.rows.map(mapOutboxMessage);
    });
  }

  async markPublished(messageId: string, lockOwner: string, publishedAt: string): Promise<void> {
    await this.database.query(
      `UPDATE payment.outbox_events
       SET published_at = $3, locked_at = NULL, lock_owner = NULL, last_error_code = NULL
       WHERE id = $1 AND lock_owner = $2 AND published_at IS NULL`,
      [messageId, lockOwner, publishedAt],
    );
  }

  async markFailed(input: {
    messageId: string;
    lockOwner: string;
    errorCode: string;
    maxAttempts: number;
    backoffMs: number;
  }): Promise<{ deadLettered: boolean }> {
    const result = await this.database.query<{ dead_lettered_at: Date | null } & QueryResultRow>(
      `UPDATE payment.outbox_events
       SET locked_at = NULL,
           lock_owner = NULL,
           last_error_code = $3,
           dead_lettered_at = CASE WHEN attempt_count >= $4 THEN now() ELSE NULL END,
           available_at = CASE
             WHEN attempt_count >= $4 THEN available_at
             ELSE now() + ($5 * interval '1 millisecond')
           END
       WHERE id = $1 AND lock_owner = $2 AND published_at IS NULL
       RETURNING dead_lettered_at`,
      [input.messageId, input.lockOwner, input.errorCode, input.maxAttempts, input.backoffMs],
    );
    return { deadLettered: Boolean(result.rows[0]?.dead_lettered_at) };
  }
}

function mapOutboxMessage(row: OutboxRow): PaymentOutboxMessage {
  return {
    id: row.id,
    eventId: row.event_id,
    channelName: row.channel_name,
    messageKey: row.message_key,
    eventType: row.event_type,
    eventVersion: row.event_version,
    aggregateId: row.aggregate_id,
    payload: row.payload,
    headers: row.headers,
    occurredAt: row.occurred_at.toISOString(),
    attemptCount: row.attempt_count,
  };
}
