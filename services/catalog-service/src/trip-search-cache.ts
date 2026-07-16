import { createHash } from 'node:crypto';

import { logEvent } from '@bus/observability';
import { Inject, Injectable, Optional, type OnModuleDestroy } from '@nestjs/common';
import { createClient, type RedisClientType } from 'redis';

import type { TripSearchCriteria, TripSearchEndpoints, TripSummaryRecord } from './trip.repository';

const CACHE_NAMESPACE = 'catalog:trip-search:v1';
const DEFAULT_TTL_SECONDS = 60;
const TRIP_SEARCH_CACHE_OPTIONS = 'TRIP_SEARCH_CACHE_OPTIONS';

interface TripSearchCacheOptions {
  namespace?: string;
  redisUrl?: string;
  ttlSeconds?: number;
}

export interface CachedTripSearchResult {
  trips: TripSummaryRecord[];
  nearestTravelDates: string[];
}

export type TripSearchCacheRead =
  | { status: 'HIT'; value: CachedTripSearchResult }
  | { status: 'MISS'; generation: string }
  | { status: 'BYPASS' };

@Injectable()
export class TripSearchCache implements OnModuleDestroy {
  private readonly client: RedisClientType;
  private readonly namespace: string;
  private readonly ttlSeconds: number;
  private connectPromise?: Promise<void>;

  constructor(@Optional() @Inject(TRIP_SEARCH_CACHE_OPTIONS) options: TripSearchCacheOptions = {}) {
    this.client = createClient({
      url: options.redisUrl ?? process.env.CATALOG_REDIS_URL ?? 'redis://localhost:6379',
      socket: { connectTimeout: 1_000, reconnectStrategy: false },
    });
    this.namespace = options.namespace ?? CACHE_NAMESPACE;
    this.ttlSeconds =
      options.ttlSeconds ??
      positiveInteger(process.env.CATALOG_SEARCH_CACHE_TTL_SECONDS, DEFAULT_TTL_SECONDS);
    this.client.on('error', () => undefined);
  }

  async get(
    endpoints: TripSearchEndpoints,
    criteria: TripSearchCriteria,
  ): Promise<TripSearchCacheRead> {
    const keyHash = createCacheKeyHash(endpoints, criteria);
    try {
      await this.ensureConnected();
      const generation = (await this.client.get(`${this.namespace}:generation`)) ?? '0';
      const serialized = await this.client.get(`${this.namespace}:g:${generation}:${keyHash}`);
      if (!serialized) {
        this.logCacheResult('MISS', keyHash);
        return { status: 'MISS', generation };
      }

      const value = parseCachedResult(serialized);
      if (!value) {
        this.logCacheResult('BYPASS', keyHash, 'invalid-payload');
        return { status: 'BYPASS' };
      }

      this.logCacheResult('HIT', keyHash);
      return { status: 'HIT', value };
    } catch {
      this.logCacheResult('BYPASS', keyHash, 'redis-unavailable');
      return { status: 'BYPASS' };
    }
  }

  async set(
    endpoints: TripSearchEndpoints,
    criteria: TripSearchCriteria,
    value: CachedTripSearchResult,
    generation: string,
  ): Promise<void> {
    const keyHash = createCacheKeyHash(endpoints, criteria);
    try {
      await this.ensureConnected();
      await this.client.set(`${this.namespace}:g:${generation}:${keyHash}`, JSON.stringify(value), {
        EX: this.ttlSeconds,
      });
      logEvent({
        service: 'catalog-service',
        event: 'catalog.trip-search-cache.write',
        message: 'Trip search result cached.',
        fields: { cacheKeyHash: keyHash, ttlSeconds: this.ttlSeconds },
      });
    } catch {
      this.logCacheResult('BYPASS', keyHash, 'redis-write-failed');
    }
  }

  async invalidate(): Promise<void> {
    await this.ensureConnected();
    const generation = await this.client.incr(`${this.namespace}:generation`);
    logEvent({
      service: 'catalog-service',
      event: 'catalog.trip-search-cache.invalidated',
      message: 'Trip search cache generation advanced.',
      fields: { generation },
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client.isOpen) {
      await this.client.quit();
    }
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

  private logCacheResult(
    status: TripSearchCacheRead['status'],
    keyHash: string,
    reason?: string,
  ): void {
    logEvent({
      service: 'catalog-service',
      level: status === 'BYPASS' ? 'warn' : 'info',
      event: `catalog.trip-search-cache.${status.toLowerCase()}`,
      message: `Trip search cache ${status.toLowerCase()}.`,
      fields: { cacheKeyHash: keyHash, ...(reason ? { reason } : {}) },
    });
  }
}

function createCacheKeyHash(endpoints: TripSearchEndpoints, criteria: TripSearchCriteria): string {
  const normalized = JSON.stringify({
    originCityId: endpoints.originCityId,
    destinationCityId: endpoints.destinationCityId,
    travelDate: criteria.travelDate,
    departureTimeFrom: criteria.departureTimeFrom ?? null,
    departureTimeTo: criteria.departureTimeTo ?? null,
    minPriceVnd: criteria.minPriceVnd ?? null,
    maxPriceVnd: criteria.maxPriceVnd ?? null,
    operatorCodes: criteria.operatorCodes,
    vehicleTypeCodes: criteria.vehicleTypeCodes,
    minimumRemainingSeats: criteria.minimumRemainingSeats ?? null,
    sort: criteria.sort,
  });
  return createHash('sha256').update(normalized).digest('hex');
}

function parseCachedResult(serialized: string): CachedTripSearchResult | null {
  try {
    const value: unknown = JSON.parse(serialized);
    if (
      !isRecord(value) ||
      !Array.isArray(value.trips) ||
      !Array.isArray(value.nearestTravelDates)
    ) {
      return null;
    }
    if (!value.trips.every(isTripSummaryRecord)) return null;
    if (!value.nearestTravelDates.every((date) => typeof date === 'string')) return null;
    return { trips: value.trips, nearestTravelDates: value.nearestTravelDates };
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isTripSummaryRecord(value: unknown): value is TripSummaryRecord {
  if (!isRecord(value)) return false;
  return (
    stringFields.every((field) => typeof value[field] === 'string') &&
    numberFields.every((field) => Number.isInteger(value[field]))
  );
}

const stringFields = [
  'id',
  'routeId',
  'operatorName',
  'vehicleTypeName',
  'vehicleCode',
  'originName',
  'destinationName',
  'pickupName',
  'dropoffName',
  'departureAt',
  'arrivalAt',
] as const;

const numberFields = ['durationMinutes', 'priceVnd', 'remainingSeats'] as const;

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
