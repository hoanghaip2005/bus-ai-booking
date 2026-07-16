import { Kafka, logLevel, type Producer } from 'kafkajs';

import type { PaymentOutboxMessage } from './payment-outbox.repository';

export interface PaymentOutboxPublisher {
  publish(message: PaymentOutboxMessage): Promise<void>;
  close(): Promise<void>;
}

export class PaymentKafkaOutboxPublisher implements PaymentOutboxPublisher {
  private readonly producer: Producer;
  private connectPromise?: Promise<void>;
  private connected = false;

  constructor() {
    const brokers = (process.env.KAFKA_BROKERS ?? 'localhost:9092')
      .split(',')
      .map((broker) => broker.trim())
      .filter(Boolean);
    this.producer = new Kafka({
      clientId: 'payment-service-outbox',
      brokers,
      logLevel: logLevel.NOTHING,
      connectionTimeout: 1_000,
      requestTimeout: 5_000,
      retry: { retries: 2, initialRetryTime: 100 },
    }).producer({ allowAutoTopicCreation: true, idempotent: true, maxInFlightRequests: 1 });
  }

  async publish(message: PaymentOutboxMessage): Promise<void> {
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
