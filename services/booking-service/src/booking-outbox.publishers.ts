import { once } from 'node:events';

import { connect, type ChannelModel, type ConfirmChannel } from 'amqplib';
import { Kafka, logLevel, type Producer } from 'kafkajs';

import type { BookingOutboxMessage } from './booking-outbox.repository';

export interface BookingOutboxPublisher {
  publish(message: BookingOutboxMessage): Promise<void>;
  close(): Promise<void>;
}

export class RabbitOutboxPublisher implements BookingOutboxPublisher {
  private connection?: ChannelModel;
  private channel?: ConfirmChannel;
  private connectPromise?: Promise<ConfirmChannel>;
  private readonly assertedExchanges = new Set<string>();

  async publish(message: BookingOutboxMessage): Promise<void> {
    const channel = await this.ensureChannel();
    if (!this.assertedExchanges.has(message.channelName)) {
      await channel.assertExchange(message.channelName, 'topic', { durable: true });
      this.assertedExchanges.add(message.channelName);
    }
    const writable = channel.publish(
      message.channelName,
      message.messageKey,
      Buffer.from(JSON.stringify(message.payload)),
      {
        persistent: true,
        contentType: 'application/json',
        contentEncoding: 'utf-8',
        messageId: message.eventId,
        type: message.eventType,
        timestamp: Math.floor(Date.parse(message.occurredAt) / 1_000),
        headers: message.headers,
      },
    );
    if (!writable) await once(channel, 'drain');
    await channel.waitForConfirms();
  }

  async close(): Promise<void> {
    const channel = this.channel;
    const connection = this.connection;
    this.channel = undefined;
    this.connection = undefined;
    this.connectPromise = undefined;
    this.assertedExchanges.clear();
    if (channel) await channel.close().catch(() => undefined);
    if (connection) await connection.close().catch(() => undefined);
  }

  private async ensureChannel(): Promise<ConfirmChannel> {
    if (this.channel) return this.channel;
    if (!this.connectPromise) {
      this.connectPromise = connect(
        process.env.RABBITMQ_URL ?? 'amqp://bus:bus_local_password@localhost:5672',
      ).then(async (connection) => {
        const channel = await connection.createConfirmChannel();
        this.connection = connection;
        this.channel = channel;
        connection.on('close', () => this.reset());
        connection.on('error', () => undefined);
        channel.on('close', () => this.reset());
        channel.on('error', () => undefined);
        return channel;
      });
    }
    try {
      return await this.connectPromise;
    } finally {
      this.connectPromise = undefined;
    }
  }

  private reset(): void {
    this.connection = undefined;
    this.channel = undefined;
    this.connectPromise = undefined;
    this.assertedExchanges.clear();
  }
}

export class KafkaOutboxPublisher implements BookingOutboxPublisher {
  private readonly producer: Producer;
  private connectPromise?: Promise<void>;
  private connected = false;

  constructor() {
    const brokers = (process.env.KAFKA_BROKERS ?? 'localhost:9092')
      .split(',')
      .map((broker) => broker.trim())
      .filter(Boolean);
    this.producer = new Kafka({
      clientId: 'booking-service-outbox',
      brokers,
      logLevel: logLevel.NOTHING,
      connectionTimeout: 1_000,
      requestTimeout: 5_000,
      retry: { retries: 2, initialRetryTime: 100 },
    }).producer({ allowAutoTopicCreation: true, idempotent: true, maxInFlightRequests: 1 });
  }

  async publish(message: BookingOutboxMessage): Promise<void> {
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
