import { randomUUID } from 'node:crypto';

import { incrementCounter, logEvent } from '@bus/observability';
import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';

import { BookingOutboxRepository, type BookingOutboxMessage } from './booking-outbox.repository';
import {
  KafkaOutboxPublisher,
  RabbitOutboxPublisher,
  type BookingOutboxPublisher,
} from './booking-outbox.publishers';

@Injectable()
export class BookingOutboxRelay implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly lockOwner = randomUUID();
  private readonly batchSize = positiveInteger(process.env.BOOKING_OUTBOX_BATCH_SIZE, 50);
  private readonly pollIntervalMs = positiveInteger(process.env.BOOKING_OUTBOX_POLL_MS, 250);
  private readonly lockTimeoutSeconds = positiveInteger(
    process.env.BOOKING_OUTBOX_LOCK_TIMEOUT_SECONDS,
    30,
  );
  private readonly maxAttempts = positiveInteger(process.env.BOOKING_OUTBOX_MAX_ATTEMPTS, 5);
  private readonly baseBackoffMs = positiveInteger(process.env.BOOKING_OUTBOX_BACKOFF_MS, 250);
  private timer?: NodeJS.Timeout;
  private scheduled?: Promise<number>;

  constructor(
    @Inject(BookingOutboxRepository) private readonly repository: BookingOutboxRepository,
    @Inject(RabbitOutboxPublisher) private readonly rabbitPublisher: RabbitOutboxPublisher,
    @Inject(KafkaOutboxPublisher) private readonly kafkaPublisher: KafkaOutboxPublisher,
  ) {}

  onApplicationBootstrap(): void {
    void this.runScheduled();
    this.timer = setInterval(() => void this.runScheduled(), this.pollIntervalMs);
    this.timer.unref();
  }

  async drainOnce(): Promise<number> {
    const messages = await this.repository.claimBatch(
      this.lockOwner,
      this.batchSize,
      this.lockTimeoutSeconds,
    );
    for (const message of messages) await this.deliver(message);
    return messages.length;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.scheduled;
    await Promise.all([this.rabbitPublisher.close(), this.kafkaPublisher.close()]);
  }

  private async deliver(message: BookingOutboxMessage): Promise<void> {
    const startedAt = performance.now();
    try {
      await this.publisherFor(message).publish(message);
      await this.repository.markPublished(message.id, this.lockOwner, new Date().toISOString());
      incrementCounter('bus.worker.outbox.published', {
        service: 'booking-service',
        destination: message.destination,
        event_type: message.eventType,
      });
      logEvent({
        service: 'booking-service',
        event: 'booking.outbox.published',
        message: 'Booking outbox event published.',
        requestId: message.headers.requestId,
        fields: {
          eventId: message.eventId,
          eventType: message.eventType,
          destination: message.destination,
          attempt: message.attemptCount,
          durationMs: Math.round(performance.now() - startedAt),
        },
      });
    } catch (error) {
      const errorCode = safeErrorCode(error);
      const failed = await this.repository.markFailed({
        messageId: message.id,
        lockOwner: this.lockOwner,
        errorCode,
        maxAttempts: this.maxAttempts,
        backoffMs: retryBackoff(message.eventId, message.attemptCount, this.baseBackoffMs),
      });
      incrementCounter(
        failed.deadLettered ? 'bus.worker.outbox.dead_lettered' : 'bus.worker.outbox.retry',
        {
          service: 'booking-service',
          destination: message.destination,
          event_type: message.eventType,
          reason: errorCode,
        },
      );
      logEvent({
        service: 'booking-service',
        level: 'error',
        event: failed.deadLettered
          ? 'booking.outbox.dead-lettered'
          : 'booking.outbox.publish-failed',
        message: failed.deadLettered
          ? 'Booking outbox event moved to durable dead-letter state.'
          : 'Booking outbox event publish will be retried.',
        requestId: message.headers.requestId,
        fields: {
          eventId: message.eventId,
          eventType: message.eventType,
          destination: message.destination,
          attempt: message.attemptCount,
          reason: errorCode,
          traceId: message.headers.traceId,
          durationMs: Math.round(performance.now() - startedAt),
        },
      });
    }
  }

  private publisherFor(message: BookingOutboxMessage): BookingOutboxPublisher {
    return message.destination === 'RABBITMQ' ? this.rabbitPublisher : this.kafkaPublisher;
  }

  private runScheduled(): Promise<number> {
    if (this.scheduled) return this.scheduled;
    this.scheduled = this.drainOnce()
      .catch((error: unknown) => {
        incrementCounter('bus.worker.outbox.poll_failed', { service: 'booking-service' });
        logEvent({
          service: 'booking-service',
          level: 'error',
          event: 'booking.outbox.poll-failed',
          message: 'Booking outbox poll failed.',
          fields: { dependency: 'postgresql', reason: safeErrorCode(error) },
        });
        return 0;
      })
      .finally(() => {
        this.scheduled = undefined;
      });
    return this.scheduled;
  }
}

function retryBackoff(eventId: string, attempt: number, baseMs: number): number {
  const exponential = Math.min(30_000, baseMs * 2 ** Math.max(0, attempt - 1));
  const jitter = Number.parseInt(eventId.slice(0, 4), 16) % Math.max(1, baseMs);
  return exponential + jitter;
}

function safeErrorCode(error: unknown): string {
  const name = error instanceof Error ? error.name : 'UnknownError';
  return /^[A-Za-z0-9._-]{1,128}$/.test(name) ? name : 'PublishError';
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
