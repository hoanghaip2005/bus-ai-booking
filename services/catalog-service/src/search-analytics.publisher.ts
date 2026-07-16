import type { SearchPerformedEvent } from '@bus/contracts-events';
import { logEvent } from '@bus/observability';
import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Kafka, logLevel, type Producer } from 'kafkajs';

const SEARCH_TOPIC = 'search-events';

@Injectable()
export class SearchAnalyticsPublisher implements OnModuleDestroy {
  private readonly producer: Producer;
  private publishChain: Promise<void> = Promise.resolve();
  private connectPromise?: Promise<void>;
  private connected = false;

  constructor() {
    const brokers = (process.env.KAFKA_BROKERS ?? 'localhost:9092')
      .split(',')
      .map((broker) => broker.trim())
      .filter(Boolean);
    this.producer = new Kafka({
      clientId: 'catalog-service',
      brokers,
      logLevel: logLevel.NOTHING,
      connectionTimeout: 1_000,
      requestTimeout: 2_000,
      retry: { retries: 1, initialRetryTime: 100 },
    }).producer({ allowAutoTopicCreation: true });
  }

  publish(event: SearchPerformedEvent): void {
    this.publishChain = this.publishChain.then(() => this.send(event));
  }

  async onModuleDestroy(): Promise<void> {
    await this.publishChain;
    if (this.connected) {
      await this.producer.disconnect();
    }
  }

  private async send(event: SearchPerformedEvent): Promise<void> {
    try {
      await this.ensureConnected();
      await this.producer.send({
        topic: SEARCH_TOPIC,
        messages: [
          {
            key: event.searchSessionId,
            value: JSON.stringify(event),
            headers: {
              eventType: event.eventType,
              eventVersion: String(event.eventVersion),
              traceId: event.traceId,
            },
          },
        ],
      });
      logEvent({
        service: 'catalog-service',
        event: 'catalog.search-performed.published',
        message: 'Search analytics fact published.',
        fields: { eventId: event.eventId, topic: SEARCH_TOPIC },
      });
    } catch {
      logEvent({
        service: 'catalog-service',
        level: 'error',
        event: 'catalog.search-performed.publish-failed',
        message: 'Search analytics fact could not be published.',
        fields: { eventId: event.eventId, topic: SEARCH_TOPIC },
      });
    }
  }

  private async ensureConnected(): Promise<void> {
    if (this.connected) return;
    if (!this.connectPromise) {
      this.connectPromise = this.producer.connect().then(() => {
        this.connected = true;
      });
    }
    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = undefined;
    }
  }
}
