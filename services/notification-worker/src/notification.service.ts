import type { BookingPaidV1 } from '@bus/contracts-events';
import { incrementCounter, logEvent } from '@bus/observability';
import { Inject, Injectable } from '@nestjs/common';

import { BookingNotificationClient } from './booking.client';
import { NotificationRepository } from './notification.repository';

@Injectable()
export class NotificationService {
  constructor(
    @Inject(NotificationRepository) private readonly repository: NotificationRepository,
    @Inject(BookingNotificationClient)
    private readonly bookingClient: BookingNotificationClient,
  ) {}

  async processBookingPaid(event: BookingPaidV1, headers: Record<string, string>): Promise<void> {
    if (await this.repository.hasProcessed(event.eventId)) return;
    const recipient = await this.bookingClient.getRecipient(
      event.aggregateId,
      event.requestId,
      headers,
    );
    if (recipient.bookingId !== event.aggregateId) {
      throw namedError('BookingSnapshotMismatch', 'Booking snapshot does not match paid event.');
    }
    if (recipient.status === 'CANCELLED') {
      await this.repository.recordSkippedEvent({
        eventId: event.eventId,
        eventType: event.eventType,
        bookingId: event.aggregateId,
        traceId: event.traceId,
        requestId: event.requestId,
        processedAt: new Date().toISOString(),
      });
      return;
    }
    const inserted = await this.repository.recordSimulatedEmail({
      eventId: event.eventId,
      eventType: event.eventType,
      bookingId: event.aggregateId,
      traceId: event.traceId,
      requestId: event.requestId,
      recipientEmail: recipient.contactEmail,
      bookingCode: recipient.bookingCode,
      sentAt: new Date().toISOString(),
    });
    if (inserted) {
      incrementCounter('bus.notification.email.sent_simulated');
      logEvent({
        service: 'notification-worker',
        event: 'notification.email.sent-simulated',
        message: 'A simulated booking email was recorded.',
        requestId: event.requestId,
        fields: { bookingId: event.aggregateId, eventId: event.eventId },
      });
    }
  }

  readiness(): Promise<void> {
    return this.repository.ping();
  }
}

function namedError(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}
