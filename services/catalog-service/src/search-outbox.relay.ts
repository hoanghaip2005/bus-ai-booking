import { randomUUID } from 'node:crypto';

import { incrementCounter, logEvent } from '@bus/observability';
import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';

import {
  SearchKafkaOutboxPublisher,
  type SearchOutboxPublisher,
} from './search-analytics.publisher';
import { SearchOutboxRepository, type SearchOutboxMessage } from './search-outbox.repository';

@Injectable()
export class SearchOutboxRelay implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly lockOwner = randomUUID();
  private readonly batchSize = positiveInteger(process.env.SEARCH_OUTBOX_BATCH_SIZE, 50);
  private readonly pollIntervalMs = positiveInteger(process.env.SEARCH_OUTBOX_POLL_MS, 250);
  private readonly lockTimeoutSeconds = positiveInteger(
    process.env.SEARCH_OUTBOX_LOCK_TIMEOUT_SECONDS,
    30,
  );
  private readonly maxAttempts = positiveInteger(process.env.SEARCH_OUTBOX_MAX_ATTEMPTS, 5);
  private readonly baseBackoffMs = positiveInteger(process.env.SEARCH_OUTBOX_BACKOFF_MS, 250);
  private timer?: NodeJS.Timeout;
  private scheduled?: Promise<number>;

  constructor(
    @Inject(SearchOutboxRepository) private readonly repository: SearchOutboxRepository,
    @Inject(SearchKafkaOutboxPublisher) private readonly publisher: SearchOutboxPublisher,
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

  private async deliver(message: SearchOutboxMessage): Promise<void> {
    try {
      await this.publisher.publish(message);
      await this.repository.markPublished(message.id, this.lockOwner, new Date().toISOString());
      incrementCounter('bus.worker.outbox.published', {
        service: 'catalog-service',
        destination: 'KAFKA',
        event_type: message.eventType,
      });
      logEvent({
        service: 'catalog-service',
        event: 'catalog.search-outbox.published',
        message: 'Search analytics event published from the durable outbox.',
        fields: { eventId: message.eventId, eventType: message.eventType },
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
          service: 'catalog-service',
          destination: 'KAFKA',
          event_type: message.eventType,
          reason: errorCode,
        },
      );
      logEvent({
        service: 'catalog-service',
        level: 'error',
        event: failed.deadLettered
          ? 'catalog.search-outbox.dead-lettered'
          : 'catalog.search-outbox.publish-failed',
        message: failed.deadLettered
          ? 'Search analytics event moved to durable dead-letter state.'
          : 'Search analytics event publish will be retried.',
        fields: { eventId: message.eventId, attempt: message.attemptCount, reason: errorCode },
      });
    }
  }

  private runScheduled(): Promise<number> {
    if (this.scheduled) return this.scheduled;
    this.scheduled = this.drainOnce()
      .catch((error: unknown) => {
        incrementCounter('bus.worker.outbox.poll_failed', { service: 'catalog-service' });
        logEvent({
          service: 'catalog-service',
          level: 'error',
          event: 'catalog.search-outbox.poll-failed',
          message: 'Search analytics outbox poll failed.',
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
