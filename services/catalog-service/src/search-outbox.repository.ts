import { randomUUID } from 'node:crypto';

import type { SearchPerformedEvent } from '@bus/contracts-events';
import { Inject, Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';

import { CatalogDatabase } from './catalog.database';

interface SearchOutboxRow extends QueryResultRow {
  id: string;
  event_id: string;
  channel_name: string;
  message_key: string;
  event_type: SearchPerformedEvent['eventType'];
  event_version: number;
  payload: SearchPerformedEvent;
  headers: Record<string, string>;
  occurred_at: Date;
  attempt_count: number;
}

export interface SearchOutboxMessage {
  id: string;
  eventId: string;
  channelName: string;
  messageKey: string;
  eventType: SearchPerformedEvent['eventType'];
  eventVersion: number;
  payload: SearchPerformedEvent;
  headers: Record<string, string>;
  occurredAt: string;
  attemptCount: number;
}

@Injectable()
export class SearchOutboxRepository {
  constructor(@Inject(CatalogDatabase) private readonly database: CatalogDatabase) {}

  async enqueue(event: SearchPerformedEvent): Promise<void> {
    await this.database.query(
      `INSERT INTO catalog.search_outbox_events (
         id, event_id, channel_name, message_key, event_type, event_version,
         payload, headers, occurred_at
       ) VALUES ($1, $2, 'search-events', $3, $4, $5, $6::jsonb, $7::jsonb, $8)
       ON CONFLICT (event_id) DO NOTHING`,
      [
        randomUUID(),
        event.eventId,
        event.searchSessionId,
        event.eventType,
        event.eventVersion,
        JSON.stringify(event),
        JSON.stringify({
          eventType: event.eventType,
          eventVersion: String(event.eventVersion),
          traceId: event.traceId,
        }),
        event.occurredAt,
      ],
    );
  }

  async claimBatch(
    lockOwner: string,
    batchSize: number,
    lockTimeoutSeconds: number,
  ): Promise<SearchOutboxMessage[]> {
    return this.database.transaction(async (transaction) => {
      const result = await transaction.query<SearchOutboxRow>(
        `WITH candidates AS (
           SELECT id
           FROM catalog.search_outbox_events
           WHERE published_at IS NULL
             AND dead_lettered_at IS NULL
             AND available_at <= now()
             AND (locked_at IS NULL OR locked_at < now() - make_interval(secs => $3))
           ORDER BY occurred_at, id
           LIMIT $2
           FOR UPDATE SKIP LOCKED
         )
         UPDATE catalog.search_outbox_events AS outbox
         SET locked_at = now(),
             lock_owner = $1,
             attempt_count = outbox.attempt_count + 1
         FROM candidates
         WHERE outbox.id = candidates.id
         RETURNING outbox.id, outbox.event_id, outbox.channel_name, outbox.message_key,
                   outbox.event_type, outbox.event_version, outbox.payload, outbox.headers,
                   outbox.occurred_at, outbox.attempt_count`,
        [lockOwner, batchSize, lockTimeoutSeconds],
      );
      return result.rows.map(mapSearchOutboxMessage);
    });
  }

  async markPublished(messageId: string, lockOwner: string, publishedAt: string): Promise<void> {
    await this.database.query(
      `UPDATE catalog.search_outbox_events
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
      `UPDATE catalog.search_outbox_events
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

function mapSearchOutboxMessage(row: SearchOutboxRow): SearchOutboxMessage {
  return {
    id: row.id,
    eventId: row.event_id,
    channelName: row.channel_name,
    messageKey: row.message_key,
    eventType: row.event_type,
    eventVersion: row.event_version,
    payload: row.payload,
    headers: row.headers,
    occurredAt: row.occurred_at.toISOString(),
    attemptCount: row.attempt_count,
  };
}
