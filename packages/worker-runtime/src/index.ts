import { once } from 'node:events';

import { bookingDomainExchange, type BookingPaidV1 } from '@bus/contracts-events';
import { incrementCounter, logEvent } from '@bus/observability';
import {
  connect,
  type ChannelModel,
  type ConfirmChannel,
  type ConsumeMessage,
  type Options,
} from 'amqplib';

export interface WorkflowMessage<Event> {
  event: Event;
  headers: Record<string, string>;
  retryCount: number;
}

export interface RabbitWorkflowConsumerOptions<Event> {
  service: string;
  queueName: string;
  bindingKey: string;
  workerExchange: string;
  maxAttempts: number;
  retryDelayMs: number;
  prefetch: number;
  parse: (payload: unknown) => Event;
  handle: (message: WorkflowMessage<Event>) => Promise<void>;
}

export class RabbitWorkflowConsumer<Event> {
  private connection?: ChannelModel;
  private channel?: ConfirmChannel;
  private ready = false;

  constructor(private readonly options: RabbitWorkflowConsumerOptions<Event>) {}

  async start(): Promise<void> {
    if (this.ready) return;
    const connection = await connect(
      process.env.RABBITMQ_URL ?? 'amqp://bus:bus_local_password@localhost:5672',
    );
    const channel = await connection.createConfirmChannel();
    const retryQueue = `${this.options.queueName}.retry`;
    const deadLetterQueue = `${this.options.queueName}.dlq`;
    await channel.assertExchange(bookingDomainExchange, 'topic', { durable: true });
    await channel.assertExchange(this.options.workerExchange, 'topic', { durable: true });
    await channel.assertQueue(this.options.queueName, { durable: true });
    await channel.assertQueue(retryQueue, {
      durable: true,
      arguments: {
        'x-message-ttl': this.options.retryDelayMs,
        'x-dead-letter-exchange': this.options.workerExchange,
        'x-dead-letter-routing-key': 'retry.return',
      },
    });
    await channel.assertQueue(deadLetterQueue, { durable: true });
    await channel.bindQueue(this.options.queueName, bookingDomainExchange, this.options.bindingKey);
    await channel.bindQueue(this.options.queueName, this.options.workerExchange, 'retry.return');
    await channel.bindQueue(retryQueue, this.options.workerExchange, 'retry.wait');
    await channel.bindQueue(deadLetterQueue, this.options.workerExchange, 'dead-letter');
    await channel.prefetch(this.options.prefetch);
    this.connection = connection;
    this.channel = channel;
    connection.on('error', () => undefined);
    channel.on('error', () => undefined);
    connection.on('close', () => {
      this.ready = false;
    });
    channel.on('close', () => {
      this.ready = false;
    });
    await channel.consume(this.options.queueName, (message) => void this.consume(message), {
      noAck: false,
    });
    this.ready = true;
  }

  isReady(): boolean {
    return this.ready;
  }

  async close(): Promise<void> {
    this.ready = false;
    const channel = this.channel;
    const connection = this.connection;
    this.channel = undefined;
    this.connection = undefined;
    if (channel) await channel.close().catch(() => undefined);
    if (connection) await connection.close().catch(() => undefined);
  }

  private async consume(message: ConsumeMessage | null): Promise<void> {
    if (!message || !this.channel) return;
    const startedAt = performance.now();
    const headers = normalizeHeaders(message.properties.headers);
    const retryCount = positiveIntegerHeader(message.properties.headers?.['x-retry-count']);
    let eventType = message.properties.type ?? 'UnknownEvent';
    try {
      const payload = JSON.parse(message.content.toString()) as unknown;
      const event = this.options.parse(payload);
      eventType = eventTypeOf(event, eventType);
      await this.options.handle({ event, headers, retryCount });
      this.channel.ack(message);
      incrementCounter('bus.worker.consumer.processed', {
        service: this.options.service,
        event_type: eventType,
      });
      logEvent({
        service: this.options.service,
        event: 'worker.message.processed',
        message: 'Workflow message processed.',
        requestId: headers.requestId,
        fields: {
          eventId: headers.eventId ?? message.properties.messageId,
          eventType,
          retryCount,
          durationMs: Math.round(performance.now() - startedAt),
        },
      });
    } catch (error) {
      await this.routeFailure(message, headers, retryCount, eventType, error, startedAt);
    }
  }

  private async routeFailure(
    message: ConsumeMessage,
    headers: Record<string, string>,
    retryCount: number,
    eventType: string,
    error: unknown,
    startedAt: number,
  ): Promise<void> {
    if (!this.channel) return;
    const errorCode = safeErrorCode(error);
    const nextAttempt = retryCount + 1;
    const deadLettered = nextAttempt >= this.options.maxAttempts;
    const routingKey = deadLettered ? 'dead-letter' : 'retry.wait';
    const published = this.channel.publish(
      this.options.workerExchange,
      routingKey,
      message.content,
      copyProperties(message, {
        ...headers,
        'x-retry-count': String(nextAttempt),
        'x-last-error-code': errorCode,
      }),
    );
    if (!published) await once(this.channel, 'drain');
    await this.channel.waitForConfirms();
    this.channel.ack(message);
    incrementCounter(
      deadLettered ? 'bus.worker.consumer.dead_lettered' : 'bus.worker.consumer.retry',
      { service: this.options.service, event_type: eventType, reason: errorCode },
    );
    logEvent({
      service: this.options.service,
      level: 'error',
      event: deadLettered ? 'worker.message.dead-lettered' : 'worker.message.retry-scheduled',
      message: deadLettered
        ? 'Workflow message moved to RabbitMQ dead-letter queue.'
        : 'Workflow message scheduled for retry.',
      requestId: headers.requestId,
      fields: {
        eventId: headers.eventId ?? message.properties.messageId,
        eventType,
        retryCount: nextAttempt,
        reason: errorCode,
        traceId: headers.traceId,
        durationMs: Math.round(performance.now() - startedAt),
      },
    });
  }
}

export function parseBookingPaidV1(payload: unknown): BookingPaidV1 {
  if (!isRecord(payload) || payload.eventType !== 'BookingPaidV1' || payload.eventVersion !== 1) {
    throw namedError('InvalidBookingPaidEvent', 'Message is not BookingPaidV1.');
  }
  if (
    !isUuid(payload.eventId) ||
    !isUuid(payload.aggregateId) ||
    typeof payload.traceId !== 'string' ||
    typeof payload.requestId !== 'string' ||
    !isRecord(payload.payload) ||
    payload.payload.bookingId !== payload.aggregateId ||
    !Array.isArray(payload.payload.seatIds)
  ) {
    throw namedError('InvalidBookingPaidEvent', 'BookingPaidV1 envelope is invalid.');
  }
  return payload as unknown as BookingPaidV1;
}

function copyProperties(message: ConsumeMessage, headers: Record<string, string>): Options.Publish {
  return {
    persistent: true,
    contentType: message.properties.contentType ?? 'application/json',
    contentEncoding: message.properties.contentEncoding ?? 'utf-8',
    messageId: message.properties.messageId,
    type: message.properties.type,
    timestamp: message.properties.timestamp,
    correlationId: message.properties.correlationId,
    headers,
  };
}

function normalizeHeaders(headers: Record<string, unknown> | undefined): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (typeof value === 'string') normalized[key] = value;
    else if (typeof value === 'number' || typeof value === 'boolean')
      normalized[key] = String(value);
    else if (Buffer.isBuffer(value)) normalized[key] = value.toString('utf8');
  }
  return normalized;
}

function positiveIntegerHeader(value: unknown): number {
  const parsed = Number(Buffer.isBuffer(value) ? value.toString('utf8') : value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function eventTypeOf(event: unknown, fallback: string): string {
  return isRecord(event) && typeof event.eventType === 'string' ? event.eventType : fallback;
}

function safeErrorCode(error: unknown): string {
  const name = error instanceof Error ? error.name : 'UnknownError';
  return /^[A-Za-z0-9._-]{1,128}$/.test(name) ? name : 'WorkerError';
}

function namedError(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}
