import { randomUUID } from 'node:crypto';

import {
  bookingDomainExchange,
  bookingEventsTopic,
  paymentEventsTopic,
  type BookingCreatedV1,
  type BookingDomainEvent,
  type BookingPaidV1,
  type PaymentAttemptedV1,
} from '../../packages/contracts-events/src';
import { connect, type Channel, type ChannelModel, type ConsumeMessage } from 'amqplib';
import { Kafka, logLevel, type Consumer, type KafkaMessage } from 'kafkajs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BookingDatabase } from '../../services/booking-service/src/booking.database';
import type { EventDispatch } from '../../services/booking-service/src/booking.events';
import {
  KafkaOutboxPublisher,
  RabbitOutboxPublisher,
  type BookingOutboxPublisher,
} from '../../services/booking-service/src/booking-outbox.publishers';
import { BookingOutboxRelay } from '../../services/booking-service/src/booking-outbox.relay';
import {
  BookingOutboxRepository,
  enqueueBookingEvent,
  type BookingOutboxMessage,
} from '../../services/booking-service/src/booking-outbox.repository';
import { PaymentDatabase } from '../../services/payment-service/src/payment.database';
import type { PaymentEventDispatch } from '../../services/payment-service/src/payment.events';
import {
  PaymentKafkaOutboxPublisher,
  type PaymentOutboxPublisher,
} from '../../services/payment-service/src/payment-outbox.publisher';
import { PaymentOutboxRelay } from '../../services/payment-service/src/payment-outbox.relay';
import {
  enqueuePaymentEvent,
  PaymentOutboxRepository,
  type PaymentOutboxMessage,
} from '../../services/payment-service/src/payment-outbox.repository';

interface RabbitDelivery {
  eventId: string;
  routingKey: string;
  messageId: string | undefined;
  traceId: unknown;
  requestId: unknown;
  payload: BookingDomainEvent;
}

interface KafkaDelivery {
  topic: string;
  key: string | undefined;
  eventId: string;
  payload: BookingDomainEvent | PaymentAttemptedV1;
}

const bookingDatabase = new BookingDatabase();
const paymentDatabase = new PaymentDatabase();
const bookingRepository = new BookingOutboxRepository(bookingDatabase);
const paymentRepository = new PaymentOutboxRepository(paymentDatabase);
const trackedBookingEventIds = new Set<string>();
const trackedPaymentEventIds = new Set<string>();
const rabbitDeliveries: RabbitDelivery[] = [];
const kafkaDeliveries: KafkaDelivery[] = [];
const kafka = new Kafka({
  clientId: `outbox-workers-test-${randomUUID()}`,
  brokers: (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(','),
  logLevel: logLevel.NOTHING,
});
const kafkaAdmin = kafka.admin();
const kafkaConsumer = kafka.consumer({ groupId: `outbox-workers-${randomUUID()}` });
let rabbitConnection: ChannelModel;
let rabbitChannel: Channel;

describe.sequential('outbox workers resilience integration', () => {
  beforeAll(async () => {
    await startKafkaCapture(kafkaConsumer);
    await startRabbitCapture();
  });

  afterAll(async () => {
    await kafkaConsumer.stop();
    await kafkaConsumer.disconnect();
    await kafkaAdmin.disconnect();
    await rabbitChannel?.close();
    await rabbitConnection?.close();
    if (trackedBookingEventIds.size > 0) {
      await bookingDatabase.query(
        'DELETE FROM booking.outbox_events WHERE event_id = ANY($1::uuid[])',
        [[...trackedBookingEventIds]],
      );
    }
    if (trackedPaymentEventIds.size > 0) {
      await paymentDatabase.query(
        'DELETE FROM payment.outbox_events WHERE event_id = ANY($1::uuid[])',
        [[...trackedPaymentEventIds]],
      );
    }
    await Promise.all([bookingDatabase.onModuleDestroy(), paymentDatabase.onModuleDestroy()]);
  }, 30_000);

  it('workers publish operational RabbitMQ events and keyed Kafka analytics facts', async () => {
    const bookingEvent = bookingPaidEvent();
    const paymentEvent = paymentAttemptedEvent(bookingEvent.aggregateId);
    await enqueueBooking(bookingEvent);
    await enqueuePayment(paymentEvent);
    const bookingRelay = createBookingRelay();
    const paymentRelay = createPaymentRelay();

    try {
      await bookingRelay.drainOnce();
      await paymentRelay.drainOnce();
      await waitFor(
        () =>
          rabbitDeliveries.some((delivery) => delivery.eventId === bookingEvent.eventId) &&
          kafkaDeliveries.some((delivery) => delivery.eventId === bookingEvent.eventId) &&
          kafkaDeliveries.some((delivery) => delivery.eventId === paymentEvent.eventId),
      );

      const rabbit = rabbitDeliveries.find((delivery) => delivery.eventId === bookingEvent.eventId);
      expect(rabbit).toMatchObject({
        routingKey: 'booking.paid.v1',
        messageId: bookingEvent.eventId,
        traceId: bookingEvent.traceId,
        requestId: bookingEvent.requestId,
        payload: bookingEvent,
      });
      expect(
        kafkaDeliveries.find((delivery) => delivery.eventId === bookingEvent.eventId),
      ).toMatchObject({
        topic: bookingEventsTopic,
        key: bookingEvent.aggregateId,
        payload: bookingEvent,
      });
      expect(
        kafkaDeliveries.find((delivery) => delivery.eventId === paymentEvent.eventId),
      ).toMatchObject({
        topic: paymentEventsTopic,
        key: paymentEvent.aggregateId,
        payload: paymentEvent,
      });
    } finally {
      await Promise.all([bookingRelay.onModuleDestroy(), paymentRelay.onModuleDestroy()]);
    }
  });

  it('workers recover a committed event after a process stops with the row claimed', async () => {
    const event = bookingCreatedEvent('2020-01-01T00:00:00.000Z');
    await enqueueBooking(event);
    const abandonedOwner = randomUUID();
    const claimed = await bookingRepository.claimBatch(abandonedOwner, 1, 30);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.eventId).toBe(event.eventId);
    await bookingDatabase.query(
      `UPDATE booking.outbox_events
       SET locked_at = now() - interval '2 seconds'
       WHERE event_id = $1`,
      [event.eventId],
    );

    await withEnvironment(
      { BOOKING_OUTBOX_LOCK_TIMEOUT_SECONDS: '1', BOOKING_OUTBOX_BATCH_SIZE: '1' },
      async () => {
        const restartedRelay = createBookingRelay();
        try {
          await restartedRelay.drainOnce();
          await waitFor(() =>
            kafkaDeliveries.some((delivery) => delivery.eventId === event.eventId),
          );
        } finally {
          await restartedRelay.onModuleDestroy();
        }
      },
    );

    const persisted = await bookingDatabase.query<{
      attempt_count: number;
      published_at: Date | null;
    }>(
      `SELECT attempt_count, published_at
       FROM booking.outbox_events
       WHERE event_id = $1 AND destination = 'KAFKA'`,
      [event.eventId],
    );
    expect(persisted.rows[0]?.attempt_count).toBe(2);
    expect(persisted.rows[0]?.published_at).toBeInstanceOf(Date);
  });

  it('workers tolerate publish-then-crash duplicates while an inbox applies the effect once', async () => {
    const event = bookingPaidEvent('2020-01-02T00:00:00.000Z');
    await enqueueBooking(event);
    const firstRabbitPublisher = new PublishThenThrowRabbitPublisher(event.eventId);
    const firstRelay = new BookingOutboxRelay(
      bookingRepository,
      firstRabbitPublisher,
      new KafkaOutboxPublisher(),
    );

    try {
      await firstRelay.drainOnce();
      await waitFor(
        () =>
          rabbitDeliveries.filter((delivery) => delivery.eventId === event.eventId).length === 1,
      );
    } finally {
      await firstRelay.onModuleDestroy();
    }
    await bookingDatabase.query(
      `UPDATE booking.outbox_events
       SET available_at = now()
       WHERE event_id = $1 AND destination = 'RABBITMQ'`,
      [event.eventId],
    );

    const retryRelay = createBookingRelay();
    try {
      await retryRelay.drainOnce();
      await waitFor(
        () =>
          rabbitDeliveries.filter((delivery) => delivery.eventId === event.eventId).length === 2,
      );
    } finally {
      await retryRelay.onModuleDestroy();
    }

    const duplicateDeliveries = rabbitDeliveries.filter(
      (delivery) => delivery.eventId === event.eventId,
    );
    const appliedEffects = await applyWithPostgresInbox(
      duplicateDeliveries.map((delivery) => delivery.eventId),
    );
    expect(duplicateDeliveries).toHaveLength(2);
    expect(appliedEffects).toBe(1);
    const persisted = await bookingDatabase.query<{
      attempt_count: number;
      published_at: Date | null;
    }>(
      `SELECT attempt_count, published_at
       FROM booking.outbox_events
       WHERE event_id = $1 AND destination = 'RABBITMQ'`,
      [event.eventId],
    );
    expect(persisted.rows[0]?.attempt_count).toBe(2);
    expect(persisted.rows[0]?.published_at).toBeInstanceOf(Date);
  });

  it('workers park a poison event in durable dead-letter state with correlation context', async () => {
    const event = paymentAttemptedEvent(randomUUID(), '2019-01-01T00:00:00.000Z');
    await enqueuePayment(event);

    await withEnvironment(
      {
        PAYMENT_OUTBOX_BATCH_SIZE: '1',
        PAYMENT_OUTBOX_MAX_ATTEMPTS: '3',
        PAYMENT_OUTBOX_BACKOFF_MS: '1',
      },
      async () => {
        const relay = new PaymentOutboxRelay(paymentRepository, new PoisonPaymentPublisher());
        try {
          for (let drain = 1; drain <= 10; drain += 1) {
            await relay.drainOnce();
            const state = await paymentDatabase.query<{
              dead_lettered_at: Date | null;
            }>(
              `UPDATE payment.outbox_events
               SET available_at = now()
               WHERE event_id = $1
               RETURNING dead_lettered_at`,
              [event.eventId],
            );
            if (state.rows[0]?.dead_lettered_at) break;
          }
        } finally {
          await relay.onModuleDestroy();
        }
      },
    );

    const persisted = await paymentDatabase.query<{
      attempt_count: number;
      dead_lettered_at: Date | null;
      last_error_code: string | null;
      trace_id: string | null;
      request_id: string | null;
    }>(
      `SELECT attempt_count, dead_lettered_at, last_error_code,
              headers ->> 'traceId' AS trace_id,
              headers ->> 'requestId' AS request_id
       FROM payment.outbox_events
       WHERE event_id = $1`,
      [event.eventId],
    );
    expect(persisted.rows[0]).toMatchObject({
      attempt_count: 3,
      last_error_code: 'PoisonBrokerError',
      trace_id: event.traceId,
      request_id: event.requestId,
    });
    expect(persisted.rows[0]?.dead_lettered_at).toBeInstanceOf(Date);
  });
});

function createBookingRelay(): BookingOutboxRelay {
  return new BookingOutboxRelay(
    bookingRepository,
    new RabbitOutboxPublisher(),
    new KafkaOutboxPublisher(),
  );
}

function createPaymentRelay(): PaymentOutboxRelay {
  return new PaymentOutboxRelay(paymentRepository, new PaymentKafkaOutboxPublisher());
}

async function enqueueBooking(event: BookingDomainEvent): Promise<void> {
  trackedBookingEventIds.add(event.eventId);
  const dispatch: EventDispatch = { event, headers: eventHeaders(event) };
  await bookingDatabase.withTransaction((client) => enqueueBookingEvent(client, dispatch));
}

async function enqueuePayment(event: PaymentAttemptedV1): Promise<void> {
  trackedPaymentEventIds.add(event.eventId);
  const dispatch: PaymentEventDispatch = { event, headers: eventHeaders(event) };
  await paymentDatabase.withTransaction((client) => enqueuePaymentEvent(client, dispatch));
}

async function startKafkaCapture(consumer: Consumer): Promise<void> {
  await kafkaAdmin.connect();
  await kafkaAdmin.createTopics({
    waitForLeaders: true,
    topics: [bookingEventsTopic, paymentEventsTopic].map((topic) => ({
      topic,
      numPartitions: 1,
      replicationFactor: 1,
    })),
  });
  await consumer.connect();
  await consumer.subscribe({ topic: bookingEventsTopic, fromBeginning: false });
  await consumer.subscribe({ topic: paymentEventsTopic, fromBeginning: false });
  const joined = new Promise<void>((resolve) => {
    consumer.on(consumer.events.GROUP_JOIN, () => resolve());
  });
  await consumer.run({
    eachMessage: async ({ topic, message }) => captureKafkaDelivery(topic, message),
  });
  await withTimeout(joined, 'Kafka worker test consumer did not join its group.');
}

function captureKafkaDelivery(topic: string, message: KafkaMessage): void {
  if (!message.value) return;
  const payload = JSON.parse(message.value.toString()) as BookingDomainEvent | PaymentAttemptedV1;
  kafkaDeliveries.push({
    topic,
    key: message.key?.toString(),
    eventId: payload.eventId,
    payload,
  });
}

async function startRabbitCapture(): Promise<void> {
  rabbitConnection = await connect(
    process.env.RABBITMQ_URL ?? 'amqp://bus:bus_local_password@localhost:5672',
  );
  rabbitChannel = await rabbitConnection.createChannel();
  await rabbitChannel.assertExchange(bookingDomainExchange, 'topic', { durable: true });
  const queue = await rabbitChannel.assertQueue('', { exclusive: true, autoDelete: true });
  await rabbitChannel.bindQueue(queue.queue, bookingDomainExchange, 'booking.paid.v1');
  await rabbitChannel.consume(queue.queue, consumeRabbitDelivery, { noAck: false });
}

function consumeRabbitDelivery(message: ConsumeMessage | null): void {
  if (!message) return;
  const payload = JSON.parse(message.content.toString()) as BookingDomainEvent;
  rabbitDeliveries.push({
    eventId: payload.eventId,
    routingKey: message.fields.routingKey,
    messageId: message.properties.messageId,
    traceId: message.properties.headers?.traceId,
    requestId: message.properties.headers?.requestId,
    payload,
  });
  rabbitChannel.ack(message);
}

async function applyWithPostgresInbox(eventIds: string[]): Promise<number> {
  return bookingDatabase.withTransaction(async (client) => {
    await client.query(
      `CREATE TEMP TABLE worker_test_inbox (
         event_id uuid PRIMARY KEY
       ) ON COMMIT DROP`,
    );
    await client.query(
      `CREATE TEMP TABLE worker_test_effects (
         event_id uuid PRIMARY KEY
       ) ON COMMIT DROP`,
    );
    for (const eventId of eventIds) {
      const inserted = await client.query<{ event_id: string }>(
        `INSERT INTO worker_test_inbox (event_id)
         VALUES ($1)
         ON CONFLICT (event_id) DO NOTHING
         RETURNING event_id`,
        [eventId],
      );
      if (inserted.rowCount === 1) {
        await client.query('INSERT INTO worker_test_effects (event_id) VALUES ($1)', [eventId]);
      }
    }
    const effects = await client.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM worker_test_effects',
    );
    return Number(effects.rows[0]?.count ?? 0);
  });
}

class PublishThenThrowRabbitPublisher implements BookingOutboxPublisher {
  private readonly delegate = new RabbitOutboxPublisher();

  constructor(private readonly targetEventId: string) {}

  async publish(message: BookingOutboxMessage): Promise<void> {
    await this.delegate.publish(message);
    if (message.eventId === this.targetEventId) {
      const error = new Error('Simulated process failure after broker confirmation.');
      error.name = 'PostPublishFailure';
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.delegate.close();
  }
}

class PoisonPaymentPublisher implements PaymentOutboxPublisher {
  async publish(_message: PaymentOutboxMessage): Promise<void> {
    const error = new Error('Simulated poison event.');
    error.name = 'PoisonBrokerError';
    throw error;
  }

  async close(): Promise<void> {}
}

function bookingCreatedEvent(occurredAt = new Date().toISOString()): BookingCreatedV1 {
  const aggregateId = randomUUID();
  return {
    ...baseEnvelope(aggregateId, occurredAt),
    eventId: randomUUID(),
    eventType: 'BookingCreatedV1',
    eventVersion: 1,
    producer: 'booking-service',
    payload: {
      bookingId: aggregateId,
      tripId: randomUUID(),
      routeId: randomUUID(),
      routeCode: 'HCM-DLI',
      seatIds: ['A01'],
      passengerCount: 1,
      totalPriceVnd: 280_000,
      status: 'PENDING_PAYMENT',
    },
  };
}

function bookingPaidEvent(occurredAt = new Date().toISOString()): BookingPaidV1 {
  const aggregateId = randomUUID();
  return {
    ...baseEnvelope(aggregateId, occurredAt),
    eventId: randomUUID(),
    eventType: 'BookingPaidV1',
    eventVersion: 1,
    producer: 'booking-service',
    payload: {
      bookingId: aggregateId,
      tripId: randomUUID(),
      routeId: randomUUID(),
      routeCode: 'HCM-DLI',
      seatIds: ['A01'],
      passengerCount: 1,
      totalPriceVnd: 280_000,
      paymentAttemptId: randomUUID(),
      paidAt: occurredAt,
      status: 'PAID',
    },
  };
}

function paymentAttemptedEvent(
  aggregateId: string,
  occurredAt = new Date().toISOString(),
): PaymentAttemptedV1 {
  return {
    ...baseEnvelope(aggregateId, occurredAt),
    eventId: randomUUID(),
    eventType: 'PaymentAttemptedV1',
    eventVersion: 1,
    producer: 'payment-service',
    payload: {
      paymentAttemptId: randomUUID(),
      bookingId: aggregateId,
      requestedOutcome: 'SUCCESS',
      status: 'SUCCEEDED',
      amountVnd: 280_000,
    },
  };
}

function baseEnvelope(aggregateId: string, occurredAt: string) {
  return {
    occurredAt,
    traceId: randomUUID().replaceAll('-', ''),
    requestId: randomUUID(),
    aggregateId,
    actorCategory: 'GUEST' as const,
    checkoutSessionId: randomUUID(),
  };
}

function eventHeaders(event: BookingDomainEvent | PaymentAttemptedV1): Record<string, string> {
  return {
    eventId: event.eventId,
    eventType: event.eventType,
    eventVersion: String(event.eventVersion),
    traceId: event.traceId,
    requestId: event.requestId,
    producer: event.producer,
    aggregateId: event.aggregateId,
    actorCategory: event.actorCategory,
    actorId: event.checkoutSessionId ?? randomUUID(),
  };
}

async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for worker delivery.');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function withTimeout(promise: Promise<void>, message: string): Promise<void> {
  await Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(message)), 15_000)),
  ]);
}

async function withEnvironment(
  values: Record<string, string>,
  operation: () => Promise<void>,
): Promise<void> {
  const previous = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]]),
  ) as Record<string, string | undefined>;
  Object.assign(process.env, values);
  try {
    await operation();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
