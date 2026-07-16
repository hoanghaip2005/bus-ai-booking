import { randomUUID } from 'node:crypto';

import { incrementCounter, logEvent } from '@bus/observability';
import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';

import {
  PaymentKafkaOutboxPublisher,
  type PaymentOutboxPublisher,
} from './payment-outbox.publisher';
import { PaymentOutboxRepository, type PaymentOutboxMessage } from './payment-outbox.repository';

@Injectable()
export class PaymentOutboxRelay implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly lockOwner = randomUUID();
  private readonly batchSize = positiveInteger(process.env.PAYMENT_OUTBOX_BATCH_SIZE, 50);
  private readonly pollIntervalMs = positiveInteger(process.env.PAYMENT_OUTBOX_POLL_MS, 250);
  private readonly lockTimeoutSeconds = positiveInteger(
    process.env.PAYMENT_OUTBOX_LOCK_TIMEOUT_SECONDS,
    30,
  );
  private readonly maxAttempts = positiveInteger(process.env.PAYMENT_OUTBOX_MAX_ATTEMPTS, 5);
  private readonly baseBackoffMs = positiveInteger(process.env.PAYMENT_OUTBOX_BACKOFF_MS, 250);
  private timer?: NodeJS.Timeout;
  private scheduled?: Promise<number>;

  constructor(
    @Inject(PaymentOutboxRepository) private readonly repository: PaymentOutboxRepository,
    @Inject(PaymentKafkaOutboxPublisher)
    private readonly publisher: PaymentOutboxPublisher,
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
    await this.publisher.close();
  }

  private async deliver(message: PaymentOutboxMessage): Promise<void> {
    const startedAt = performance.now();
    try {
      await this.publisher.publish(message);
      await this.repository.markPublished(message.id, this.lockOwner, new Date().toISOString());
      incrementCounter('bus.worker.outbox.published', {
        service: 'payment-service',
        destination: 'KAFKA',
        event_type: message.eventType,
      });
      logEvent({
        service: 'payment-service',
        event: 'payment.outbox.published',
        message: 'Payment analytics event published.',
        requestId: message.headers.requestId,
        fields: {
          eventId: message.eventId,
          eventType: message.eventType,
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
          service: 'payment-service',
          destination: 'KAFKA',
          event_type: message.eventType,
          reason: errorCode,
        },
      );
      logEvent({
        service: 'payment-service',
        level: 'error',
        event: failed.deadLettered
          ? 'payment.outbox.dead-lettered'
          : 'payment.outbox.publish-failed',
        message: failed.deadLettered
          ? 'Payment outbox event moved to durable dead-letter state.'
          : 'Payment outbox event publish will be retried.',
        requestId: message.headers.requestId,
        fields: {
          eventId: message.eventId,
          eventType: message.eventType,
          attempt: message.attemptCount,
          reason: errorCode,
          traceId: message.headers.traceId,
          durationMs: Math.round(performance.now() - startedAt),
        },
      });
    }
  }

  private runScheduled(): Promise<number> {
    if (this.scheduled) return this.scheduled;
    this.scheduled = this.drainOnce()
      .catch((error: unknown) => {
        incrementCounter('bus.worker.outbox.poll_failed', { service: 'payment-service' });
        logEvent({
          service: 'payment-service',
          level: 'error',
          event: 'payment.outbox.poll-failed',
          message: 'Payment outbox poll failed.',
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
