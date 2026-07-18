import type { SearchPerformedEvent } from '@bus/contracts-events';
import { Inject, Injectable } from '@nestjs/common';
import { Kafka, logLevel, type Producer } from 'kafkajs';

import { SearchOutboxRepository, type SearchOutboxMessage } from './search-outbox.repository';

@Injectable()
export class SearchAnalyticsPublisher {
  constructor(
    @Inject(SearchOutboxRepository) private readonly repository: SearchOutboxRepository,
  ) {}

  publish(event: SearchPerformedEvent): Promise<void> {
    return this.repository.enqueue(event);
  }
}

export interface SearchOutboxPublisher {
  publish(message: SearchOutboxMessage): Promise<void>;
  close(): Promise<void>;
}

@Injectable()
export class SearchKafkaOutboxPublisher implements SearchOutboxPublisher {
  private readonly producer: Producer;
  private connectPromise?: Promise<void>;
  private connected = false;

  constructor() {
    const brokers = (process.env.KAFKA_BROKERS ?? 'localhost:9092')
      .split(',')
      .map((broker) => broker.trim())
      .filter(Boolean);
    this.producer = new Kafka({
      clientId: 'catalog-search-outbox',
      brokers,
      logLevel: logLevel.NOTHING,
      connectionTimeout: 1_000,
      requestTimeout: 5_000,
      retry: { retries: 2, initialRetryTime: 100 },
    }).producer({ allowAutoTopicCreation: true, idempotent: true, maxInFlightRequests: 1 });
  }

  async publish(message: SearchOutboxMessage): Promise<void> {
    await this.ensureConnected();
    await this.producer.send({
      topic: message.channelName,
      acks: -1,
      messages: [
        {
          key: message.messageKey,
          value: JSON.stringify(message.payload),
          headers: message.headers,
        },
      ],
    });
  }

  async close(): Promise<void> {
    if (this.connected) await this.producer.disconnect();
    this.connected = false;
    this.connectPromise = undefined;
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
