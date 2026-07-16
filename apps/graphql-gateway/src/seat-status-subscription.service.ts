import { seatStatusChangedChannel, type SeatStatusChangedEvent } from '@bus/contracts-events';
import { logEvent } from '@bus/observability';
import { Injectable, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { createClient, type RedisClientType } from 'redis';

export interface SeatStatusGraphQlEvent {
  tripId: string;
  seatIds: string[];
  status: 'HELD' | 'AVAILABLE' | 'BOOKED' | 'BLOCKED';
  expiresAt?: string;
  version: number;
  occurredAt: string;
}

type SubscriptionPayload = { seatStatusChanged: SeatStatusGraphQlEvent };

@Injectable()
export class SeatStatusSubscriptionService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly client: RedisClientType;
  private readonly channel: string;
  private readonly streams = new Map<string, Set<PushAsyncIterator<SubscriptionPayload>>>();

  constructor() {
    this.client = createClient({
      url: process.env.GRAPHQL_REDIS_URL ?? 'redis://localhost:6379',
      socket: {
        connectTimeout: 1_000,
        reconnectStrategy: (retries) => Math.min(1_000, 100 * 2 ** Math.min(retries, 4)),
      },
    });
    this.channel = process.env.SEAT_STATUS_REDIS_CHANNEL ?? seatStatusChangedChannel;
    this.client.on('error', (error: Error) => {
      logEvent({
        service: 'graphql-gateway',
        level: 'error',
        event: 'seat-status.redis.error',
        message: 'Seat status Redis subscriber reported an error.',
        fields: { dependency: 'redis', reason: error.name },
      });
    });
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.client.connect();
    await this.client.subscribe(this.channel, (message) => this.deliver(message));
  }

  async ping(): Promise<{ status: 'UP' }> {
    if (!this.client.isReady) throw new Error('Seat status Redis subscriber is unavailable.');
    await this.client.ping();
    return { status: 'UP' };
  }

  subscribeToTrip(tripId: string): AsyncIterableIterator<SubscriptionPayload> {
    const stream = new PushAsyncIterator<SubscriptionPayload>(() => {
      const tripStreams = this.streams.get(tripId);
      tripStreams?.delete(stream);
      if (tripStreams?.size === 0) this.streams.delete(tripId);
    });
    const tripStreams = this.streams.get(tripId) ?? new Set();
    tripStreams.add(stream);
    this.streams.set(tripId, tripStreams);
    return stream;
  }

  async onModuleDestroy(): Promise<void> {
    for (const tripStreams of this.streams.values()) {
      for (const stream of tripStreams) stream.close();
    }
    this.streams.clear();
    if (!this.client.isOpen) return;
    await this.client.unsubscribe(this.channel);
    await this.client.quit();
  }

  private deliver(message: string): void {
    const event = parseSeatStatusEvent(message);
    if (!event) {
      logEvent({
        service: 'graphql-gateway',
        level: 'warn',
        event: 'seat-status.event.rejected',
        message: 'Invalid seat status event was ignored.',
        fields: { channel: this.channel },
      });
      return;
    }
    const payload: SubscriptionPayload = {
      seatStatusChanged: {
        tripId: event.tripId,
        seatIds: event.seatIds,
        status: event.status,
        ...('expiresAt' in event &&
          event.expiresAt !== undefined && { expiresAt: event.expiresAt }),
        version: event.version,
        occurredAt: event.occurredAt,
      },
    };
    for (const stream of this.streams.get(event.tripId) ?? []) stream.push(payload);
  }
}

export function parseSeatStatusEvent(message: string): SeatStatusChangedEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(message);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  const allowedKeys = new Set([
    'eventId',
    'eventType',
    'eventVersion',
    'occurredAt',
    'producer',
    'tripId',
    'seatIds',
    'status',
    'expiresAt',
    'version',
  ]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) return null;
  if (!isUuid(value.eventId) || value.producer !== 'seat-inventory-service') return null;
  if (!isIsoDate(value.occurredAt) || !isUuid(value.tripId)) return null;
  if (
    !Array.isArray(value.seatIds) ||
    value.seatIds.length < 1 ||
    value.seatIds.length > 100 ||
    value.seatIds.some((seatId) => typeof seatId !== 'string' || !seatIdPattern.test(seatId)) ||
    new Set(value.seatIds).size !== value.seatIds.length
  ) {
    return null;
  }
  if (value.expiresAt !== undefined && !isIsoDate(value.expiresAt)) return null;
  if (!Number.isInteger(value.version) || Number(value.version) < 1) return null;
  if (
    value.eventType === 'SeatStatusChangedV1' &&
    value.eventVersion === 1 &&
    ['HELD', 'AVAILABLE'].includes(String(value.status))
  ) {
    return value as unknown as SeatStatusChangedEvent;
  }
  if (
    value.eventType === 'SeatStatusChangedV2' &&
    value.eventVersion === 2 &&
    (value.status === 'BOOKED' || value.status === 'BLOCKED') &&
    value.expiresAt === undefined
  ) {
    return value as unknown as SeatStatusChangedEvent;
  }
  return null;
}

class PushAsyncIterator<T> implements AsyncIterableIterator<T> {
  private readonly queue: T[] = [];
  private readonly waiting: Array<(result: IteratorResult<T>) => void> = [];
  private closed = false;

  constructor(private readonly onClose: () => void) {}

  push(value: T): void {
    if (this.closed) return;
    const resolve = this.waiting.shift();
    if (resolve) resolve({ value, done: false });
    else {
      if (this.queue.length >= 100) this.queue.shift();
      this.queue.push(value);
    }
  }

  next(): Promise<IteratorResult<T>> {
    const value = this.queue.shift();
    if (value !== undefined) return Promise.resolve({ value, done: false });
    if (this.closed) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  return(): Promise<IteratorResult<T>> {
    this.close();
    return Promise.resolve({ value: undefined, done: true });
  }

  throw(error: unknown): Promise<IteratorResult<T>> {
    this.close();
    return Promise.reject(error instanceof Error ? error : new Error('Subscription failed.'));
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.onClose();
    for (const resolve of this.waiting.splice(0)) resolve({ value: undefined, done: true });
    this.queue.length = 0;
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<T> {
    return this;
  }
}

const seatIdPattern = /^[A-Za-z0-9._-]{1,64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}
