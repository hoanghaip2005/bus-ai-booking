import { createHash, randomUUID } from 'node:crypto';

import {
  seatStatusChangedChannel,
  type SeatStatusChangedV1,
  type SeatStatusChangedV2,
} from '@bus/contracts-events';
import { logEvent } from '@bus/observability';
import {
  Inject,
  Injectable,
  Optional,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { createClient, type RedisClientType } from 'redis';

export type HoldOwnerType = 'GUEST_SESSION' | 'CUSTOMER';

export interface HoldOwner {
  type: HoldOwnerType;
  id: string;
}

export interface ActiveSeatHold {
  token: string;
  tripId: string;
  seatIds: string[];
  owner: HoldOwner;
  idempotencyKey: string;
  expiresAt: string;
  unitPriceVnd: number;
  totalPriceVnd: number;
}

export type AcquireHoldResult =
  | { status: 'ACQUIRED' | 'REPLAY'; hold: ActiveSeatHold }
  | { status: 'SEAT_UNAVAILABLE'; seatId: string }
  | { status: 'IDEMPOTENCY_CONFLICT' };

export type ReleaseHoldResult =
  | { status: 'RELEASED' | 'REPLAY'; hold: ActiveSeatHold; releasedAt: string }
  | { status: 'NOT_ACTIVE' | 'OWNER_MISMATCH' | 'IDEMPOTENCY_CONFLICT' };

interface SeatHoldStoreOptions {
  namespace?: string;
  redisUrl?: string;
  idempotencyTtlSeconds?: number;
  expiryMetadataRetentionSeconds?: number;
  eventChannel?: string;
  sweepIntervalMs?: number;
  sweepBatchSize?: number;
}

const ACQUIRE_HOLD_SCRIPT = `
local existing = redis.call('GET', KEYS[2])
if existing then
  local idempotency = cjson.decode(existing)
  if idempotency.fingerprint ~= ARGV[1] then
    return {'IDEMPOTENCY_CONFLICT'}
  end
  return {'REPLAY', idempotency.hold}
end

for index = 6, #KEYS do
  if redis.call('EXISTS', KEYS[index]) == 1 then
    return {'SEAT_UNAVAILABLE', ARGV[index + 6]}
  end
end

local event = cjson.decode(ARGV[10])
local version = redis.call('INCR', KEYS[5])
event.version = version

for index = 6, #KEYS do
  redis.call('SET', KEYS[index], ARGV[2], 'PX', ARGV[4])
end

redis.call('SET', KEYS[1], ARGV[3], 'PX', ARGV[4])
redis.call('SET', KEYS[2], ARGV[5], 'EX', ARGV[6])
redis.call('SET', KEYS[4], ARGV[8], 'PX', ARGV[9])
redis.call('ZADD', KEYS[3], ARGV[7], ARGV[2])
redis.call('PUBLISH', ARGV[11], cjson.encode(event))
return {'ACQUIRED', ARGV[3]}
`;

const RELEASE_HOLD_SCRIPT = `
local existing = redis.call('GET', KEYS[4])
if existing then
  local idempotency = cjson.decode(existing)
  if idempotency.fingerprint ~= ARGV[1] then
    return {'IDEMPOTENCY_CONFLICT'}
  end
  if idempotency.status == 'RELEASED' then
    return {'REPLAY', idempotency.hold, idempotency.releasedAt}
  end
  return {idempotency.status}
end

local serialized = redis.call('GET', KEYS[1])
if not serialized then
  redis.call('SET', KEYS[4], cjson.encode({
    fingerprint = ARGV[1],
    status = 'NOT_ACTIVE'
  }), 'EX', ARGV[9])
  return {'NOT_ACTIVE'}
end

local hold = cjson.decode(serialized)
if hold.owner.type ~= ARGV[3] or hold.owner.id ~= ARGV[4] then
  return {'OWNER_MISMATCH'}
end

local versionKey = ARGV[5] .. ':trip:' .. hold.tripId .. ':version'
local version = redis.call('INCR', versionKey)

for _, seatId in ipairs(hold.seatIds) do
  local seatKey = ARGV[5] .. ':trip:' .. hold.tripId .. ':seat:' .. seatId
  if redis.call('GET', seatKey) == ARGV[2] then
    redis.call('DEL', seatKey)
  end
end

redis.call('DEL', KEYS[1])
redis.call('ZREM', KEYS[2], ARGV[2])
redis.call('DEL', KEYS[3])
redis.call('SET', KEYS[4], cjson.encode({
  fingerprint = ARGV[1],
  status = 'RELEASED',
  hold = serialized,
  releasedAt = ARGV[7]
}), 'EX', ARGV[9])
local event = {
  eventId = ARGV[6],
  eventType = 'SeatStatusChangedV1',
  eventVersion = 1,
  occurredAt = ARGV[7],
  producer = 'seat-inventory-service',
  tripId = hold.tripId,
  seatIds = hold.seatIds,
  status = 'AVAILABLE',
  version = version
}
redis.call('PUBLISH', ARGV[8], cjson.encode(event))
return {'RELEASED', serialized, ARGV[7]}
`;

const CONSUME_CONFIRMED_HOLD_SCRIPT = `
local serialized = redis.call('GET', KEYS[1])
if not serialized then
  return {'NOT_ACTIVE'}
end

local hold = cjson.decode(serialized)
if hold.owner.type ~= ARGV[2] or hold.owner.id ~= ARGV[3] then
  return {'OWNER_MISMATCH'}
end

local versionKey = ARGV[4] .. ':trip:' .. hold.tripId .. ':version'
local version = redis.call('INCR', versionKey)

for _, seatId in ipairs(hold.seatIds) do
  local seatKey = ARGV[4] .. ':trip:' .. hold.tripId .. ':seat:' .. seatId
  if redis.call('GET', seatKey) == ARGV[1] then
    redis.call('DEL', seatKey)
  end
end

redis.call('DEL', KEYS[1])
redis.call('ZREM', KEYS[2], ARGV[1])
redis.call('DEL', KEYS[3])
local event = {
  eventId = ARGV[5],
  eventType = 'SeatStatusChangedV2',
  eventVersion = 2,
  occurredAt = ARGV[6],
  producer = 'seat-inventory-service',
  tripId = hold.tripId,
  seatIds = hold.seatIds,
  status = 'BOOKED',
  version = version
}
redis.call('PUBLISH', ARGV[7], cjson.encode(event))
return {'CONSUMED'}
`;

const PUBLISH_AVAILABLE_SCRIPT = `
local event = cjson.decode(ARGV[1])
event.version = redis.call('INCR', KEYS[1])
redis.call('PUBLISH', ARGV[2], cjson.encode(event))
return event.version
`;

const SWEEP_EXPIRED_SCRIPT = `
local tokens = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[2], 'LIMIT', 0, ARGV[4])
local published = 0

for _, token in ipairs(tokens) do
  local metadataKey = ARGV[1] .. ':expiry-meta:' .. token
  local serializedMetadata = redis.call('GET', metadataKey)
  if not serializedMetadata then
    redis.call('ZREM', KEYS[1], token)
  else
    local holdKey = ARGV[1] .. ':hold:' .. token
    if redis.call('EXISTS', holdKey) == 0 then
      local metadata = cjson.decode(serializedMetadata)
      local versionKey = ARGV[1] .. ':trip:' .. metadata.tripId .. ':version'
      local version = redis.call('INCR', versionKey)
      for _, seatId in ipairs(metadata.seatIds) do
        local seatKey = ARGV[1] .. ':trip:' .. metadata.tripId .. ':seat:' .. seatId
        if redis.call('GET', seatKey) == token then
          redis.call('DEL', seatKey)
        end
      end

      redis.call('ZREM', KEYS[1], token)
      redis.call('DEL', metadataKey)
      local event = {
        eventId = metadata.expiryEventId,
        eventType = 'SeatStatusChangedV1',
        eventVersion = 1,
        occurredAt = ARGV[3],
        producer = 'seat-inventory-service',
        tripId = metadata.tripId,
        seatIds = metadata.seatIds,
        status = 'AVAILABLE',
        version = version
      }
      redis.call('PUBLISH', ARGV[5], cjson.encode(event))
      published = published + 1
    end
  end
end

return {#tokens, published}
`;

@Injectable()
export class SeatHoldStore implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly client: RedisClientType;
  private readonly namespace: string;
  private readonly idempotencyTtlSeconds: number;
  private readonly expiryMetadataRetentionSeconds: number;
  private readonly eventChannel: string;
  private readonly sweepIntervalMs: number;
  private readonly sweepBatchSize: number;
  private connectPromise?: Promise<void>;
  private sweepTimer?: NodeJS.Timeout;
  private scheduledSweep?: Promise<void>;

  constructor(@Optional() @Inject('SEAT_HOLD_STORE_OPTIONS') options: SeatHoldStoreOptions = {}) {
    this.client = createClient({
      url: options.redisUrl ?? process.env.SEAT_INVENTORY_REDIS_URL ?? 'redis://localhost:6379',
      socket: { connectTimeout: 1_000, reconnectStrategy: false },
    });
    this.namespace = options.namespace ?? 'seat-inventory:hold:v1';
    this.idempotencyTtlSeconds =
      options.idempotencyTtlSeconds ??
      positiveInteger(process.env.SEAT_INVENTORY_IDEMPOTENCY_TTL_SECONDS, 86_400);
    this.expiryMetadataRetentionSeconds =
      options.expiryMetadataRetentionSeconds ??
      positiveInteger(process.env.SEAT_INVENTORY_EXPIRY_METADATA_RETENTION_SECONDS, 86_400);
    this.eventChannel =
      options.eventChannel ?? process.env.SEAT_STATUS_REDIS_CHANNEL ?? seatStatusChangedChannel;
    this.sweepIntervalMs =
      options.sweepIntervalMs ??
      positiveInteger(process.env.SEAT_INVENTORY_SWEEP_INTERVAL_MS, 1_000);
    this.sweepBatchSize =
      options.sweepBatchSize ?? positiveInteger(process.env.SEAT_INVENTORY_SWEEP_BATCH_SIZE, 100);
    this.client.on('error', () => undefined);
  }

  onApplicationBootstrap(): void {
    void this.runScheduledSweep();
    this.sweepTimer = setInterval(() => void this.runScheduledSweep(), this.sweepIntervalMs);
    this.sweepTimer.unref();
  }

  async ping(): Promise<void> {
    await this.ensureConnected();
    await this.client.ping();
  }

  async acquire(
    hold: ActiveSeatHold,
    fingerprint: string,
    ttlSeconds: number,
  ): Promise<AcquireHoldResult> {
    await this.ensureConnected();
    await this.sweepExpired();
    const idempotencyRecord = JSON.stringify({ fingerprint, hold: JSON.stringify(hold) });
    const expiryMetadata = JSON.stringify({
      token: hold.token,
      tripId: hold.tripId,
      seatIds: hold.seatIds,
      expiryEventId: randomUUID(),
    });
    const heldEvent: Omit<SeatStatusChangedV1, 'version'> = {
      eventId: randomUUID(),
      eventType: 'SeatStatusChangedV1',
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      producer: 'seat-inventory-service',
      tripId: hold.tripId,
      seatIds: hold.seatIds,
      status: 'HELD',
      expiresAt: hold.expiresAt,
    };
    const result = await this.client.eval(ACQUIRE_HOLD_SCRIPT, {
      keys: [
        this.holdKey(hold.token),
        this.idempotencyKey(hold),
        this.expiryKey(),
        this.expiryMetadataKey(hold.token),
        this.versionKey(hold.tripId),
        ...hold.seatIds.map((seatId) => this.seatKey(hold.tripId, seatId)),
      ],
      arguments: [
        fingerprint,
        hold.token,
        JSON.stringify(hold),
        String(ttlSeconds * 1_000),
        idempotencyRecord,
        String(this.idempotencyTtlSeconds),
        String(Date.parse(hold.expiresAt)),
        expiryMetadata,
        String((ttlSeconds + this.expiryMetadataRetentionSeconds) * 1_000),
        JSON.stringify(heldEvent),
        this.eventChannel,
        ...hold.seatIds,
      ],
    });
    const values = redisArray(result);
    if (values[0] === 'ACQUIRED' || values[0] === 'REPLAY') {
      return { status: values[0], hold: parseHold(requiredValue(values[1])) };
    }
    if (values[0] === 'SEAT_UNAVAILABLE') {
      return { status: 'SEAT_UNAVAILABLE', seatId: values[1] ?? 'unknown' };
    }
    return { status: 'IDEMPOTENCY_CONFLICT' };
  }

  async get(holdToken: string): Promise<ActiveSeatHold | null> {
    await this.ensureConnected();
    await this.sweepExpired();
    const serialized = await this.client.get(this.holdKey(holdToken));
    return serialized ? parseHold(serialized) : null;
  }

  async release(
    holdToken: string,
    owner: HoldOwner,
    idempotencyKey: string,
  ): Promise<ReleaseHoldResult> {
    await this.ensureConnected();
    const releasedAt = new Date().toISOString();
    const fingerprint = createHash('sha256')
      .update(`${holdToken}\0${owner.type}\0${owner.id}`)
      .digest('hex');
    const result = await this.client.eval(RELEASE_HOLD_SCRIPT, {
      keys: [
        this.holdKey(holdToken),
        this.expiryKey(),
        this.expiryMetadataKey(holdToken),
        this.releaseIdempotencyKey(owner, idempotencyKey),
      ],
      arguments: [
        fingerprint,
        holdToken,
        owner.type,
        owner.id,
        this.namespace,
        randomUUID(),
        releasedAt,
        this.eventChannel,
        String(this.idempotencyTtlSeconds),
      ],
    });
    const values = redisArray(result);
    if (values[0] === 'RELEASED' || values[0] === 'REPLAY') {
      return {
        status: values[0],
        hold: parseHold(requiredValue(values[1])),
        releasedAt: requiredValue(values[2]),
      };
    }
    if (values[0] === 'OWNER_MISMATCH' || values[0] === 'IDEMPOTENCY_CONFLICT') {
      return { status: values[0] };
    }
    return { status: 'NOT_ACTIVE' };
  }

  async consumeConfirmedHold(
    holdToken: string,
    owner: HoldOwner,
  ): Promise<{ status: 'CONSUMED' | 'NOT_ACTIVE' | 'OWNER_MISMATCH' }> {
    await this.ensureConnected();
    const result = await this.client.eval(CONSUME_CONFIRMED_HOLD_SCRIPT, {
      keys: [this.holdKey(holdToken), this.expiryKey(), this.expiryMetadataKey(holdToken)],
      arguments: [
        holdToken,
        owner.type,
        owner.id,
        this.namespace,
        randomUUID(),
        new Date().toISOString(),
        this.eventChannel,
      ],
    });
    const values = redisArray(result);
    if (values[0] === 'CONSUMED') return { status: 'CONSUMED' };
    return { status: values[0] === 'OWNER_MISMATCH' ? 'OWNER_MISMATCH' : 'NOT_ACTIVE' };
  }

  async publishAvailableSeats(
    tripId: string,
    seatIds: string[],
    occurredAt: string,
  ): Promise<void> {
    await this.ensureConnected();
    const event: Omit<SeatStatusChangedV1, 'version'> = {
      eventId: randomUUID(),
      eventType: 'SeatStatusChangedV1',
      eventVersion: 1,
      occurredAt,
      producer: 'seat-inventory-service',
      tripId,
      seatIds,
      status: 'AVAILABLE',
    };
    await this.client.eval(PUBLISH_AVAILABLE_SCRIPT, {
      keys: [this.versionKey(tripId)],
      arguments: [JSON.stringify(event), this.eventChannel],
    });
  }

  async publishBlockedSeats(tripId: string, seatIds: string[], occurredAt: string): Promise<void> {
    await this.ensureConnected();
    const event: Omit<SeatStatusChangedV2, 'version'> = {
      eventId: randomUUID(),
      eventType: 'SeatStatusChangedV2',
      eventVersion: 2,
      occurredAt,
      producer: 'seat-inventory-service',
      tripId,
      seatIds,
      status: 'BLOCKED',
    };
    await this.client.eval(PUBLISH_AVAILABLE_SCRIPT, {
      keys: [this.versionKey(tripId)],
      arguments: [JSON.stringify(event), this.eventChannel],
    });
  }

  async getSeatHolds(
    tripId: string,
    seatIds: string[],
    requestedToken?: string,
  ): Promise<Map<string, { heldByRequester: boolean }>> {
    if (seatIds.length === 0) return new Map();
    await this.ensureConnected();
    await this.sweepExpired();
    const tokens = await this.client.mGet(seatIds.map((seatId) => this.seatKey(tripId, seatId)));
    const holds = new Map<string, { heldByRequester: boolean }>();
    tokens.forEach((token, index) => {
      const seatId = seatIds[index];
      if (token && seatId) holds.set(seatId, { heldByRequester: token === requestedToken });
    });
    return holds;
  }

  async sweepExpired(): Promise<{ examined: number; published: number }> {
    await this.ensureConnected();
    const result = await this.client.eval(SWEEP_EXPIRED_SCRIPT, {
      keys: [this.expiryKey()],
      arguments: [
        this.namespace,
        String(Date.now()),
        new Date().toISOString(),
        String(this.sweepBatchSize),
        this.eventChannel,
      ],
    });
    const values = redisArray(result);
    return {
      examined: Number(values[0] ?? 0),
      published: Number(values[1] ?? 0),
    };
  }

  async onModuleDestroy(): Promise<void> {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    await this.scheduledSweep;
    if (this.client.isOpen) await this.client.quit();
  }

  private async ensureConnected(): Promise<void> {
    if (this.client.isReady) return;
    if (!this.connectPromise) {
      this.connectPromise = this.client
        .connect()
        .then(() => undefined)
        .finally(() => {
          this.connectPromise = undefined;
        });
    }
    await this.connectPromise;
  }

  private holdKey(token: string): string {
    return `${this.namespace}:hold:${token}`;
  }

  private seatKey(tripId: string, seatId: string): string {
    return `${this.namespace}:trip:${tripId}:seat:${seatId}`;
  }

  private idempotencyKey(hold: ActiveSeatHold): string {
    return `${this.namespace}:idempotency:${hold.owner.type}:${hold.owner.id}:${hold.idempotencyKey}`;
  }

  private releaseIdempotencyKey(owner: HoldOwner, idempotencyKey: string): string {
    return `${this.namespace}:release-idempotency:${owner.type}:${owner.id}:${idempotencyKey}`;
  }

  private expiryKey(): string {
    return `${this.namespace}:expiry`;
  }

  private expiryMetadataKey(token: string): string {
    return `${this.namespace}:expiry-meta:${token}`;
  }

  private versionKey(tripId: string): string {
    return `${this.namespace}:trip:${tripId}:version`;
  }

  private async runScheduledSweep(): Promise<void> {
    if (this.scheduledSweep) return this.scheduledSweep;
    this.scheduledSweep = this.sweepExpired()
      .then(({ examined, published }) => {
        if (published === 0) return;
        logEvent({
          service: 'seat-inventory-service',
          event: 'seat-hold.expiry-sweep.completed',
          message: 'Expired seat holds were released.',
          fields: { examined, published },
        });
      })
      .catch((error: unknown) => {
        logEvent({
          service: 'seat-inventory-service',
          level: 'error',
          event: 'seat-hold.expiry-sweep.failed',
          message: 'Expired seat hold sweep failed.',
          fields: { dependency: 'redis', reason: error instanceof Error ? error.name : 'unknown' },
        });
      })
      .finally(() => {
        this.scheduledSweep = undefined;
      });
    return this.scheduledSweep;
  }
}

function redisArray(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error('Redis hold script returned an invalid response.');
  return value.map((item) => String(item));
}

function requiredValue(value: string | undefined): string {
  if (!value) throw new Error('Redis hold script omitted a required payload.');
  return value;
}

function parseHold(value: string): ActiveSeatHold {
  const parsed: unknown = JSON.parse(value);
  if (!isRecord(parsed) || !Array.isArray(parsed.seatIds) || !isRecord(parsed.owner)) {
    throw new Error('Redis hold payload is invalid.');
  }
  return parsed as unknown as ActiveSeatHold;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
