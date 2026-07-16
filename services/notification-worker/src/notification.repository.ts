import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';

import { NotificationDatabase } from './notification.database';

@Injectable()
export class NotificationRepository {
  constructor(@Inject(NotificationDatabase) private readonly database: NotificationDatabase) {}

  async hasProcessed(eventId: string): Promise<boolean> {
    const result = await this.database.query<QueryResultRow>(
      'SELECT 1 FROM notification.inbox_events WHERE event_id = $1',
      [eventId],
    );
    return result.rowCount === 1;
  }

  async recordSimulatedEmail(input: {
    eventId: string;
    eventType: string;
    bookingId: string;
    traceId: string;
    requestId: string;
    recipientEmail: string;
    bookingCode: string;
    sentAt: string;
  }): Promise<boolean> {
    return this.database.withTransaction(async (client) => {
      const inbox = await client.query(
        `INSERT INTO notification.inbox_events (
          event_id, event_type, booking_id, trace_id, request_id, processed_at
        ) VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (event_id) DO NOTHING`,
        [
          input.eventId,
          input.eventType,
          input.bookingId,
          input.traceId,
          input.requestId,
          input.sentAt,
        ],
      );
      if (inbox.rowCount !== 1) return false;
      await client.query(
        `INSERT INTO notification.email_delivery_logs (
          id, booking_id, recipient_email, subject, template_name, status, sent_at
        ) VALUES ($1, $2, $3, $4, 'BOOKING_PAID_V1', 'SENT_SIMULATED', $5)
        ON CONFLICT (booking_id) DO NOTHING`,
        [
          randomUUID(),
          input.bookingId,
          input.recipientEmail,
          `Vé điện tử Bến Việt - ${input.bookingCode}`,
          input.sentAt,
        ],
      );
      return true;
    });
  }

  async recordSkippedEvent(input: {
    eventId: string;
    eventType: string;
    bookingId: string;
    traceId: string;
    requestId: string;
    processedAt: string;
  }): Promise<void> {
    await this.database.query(
      `INSERT INTO notification.inbox_events (
        event_id, event_type, booking_id, trace_id, request_id, processed_at
      ) VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (event_id) DO NOTHING`,
      [
        input.eventId,
        input.eventType,
        input.bookingId,
        input.traceId,
        input.requestId,
        input.processedAt,
      ],
    );
  }

  ping(): Promise<void> {
    return this.database.ping();
  }
}
