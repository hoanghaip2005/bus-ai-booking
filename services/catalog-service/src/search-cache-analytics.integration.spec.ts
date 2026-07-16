import { randomUUID } from 'node:crypto';

import type { SearchPerformedEvent, SearchPerformedV2 } from '@bus/contracts-events';
import { Kafka, logLevel } from 'kafkajs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { CatalogService } from './catalog.service';
import { SearchAnalyticsPublisher } from './search-analytics.publisher';
import type { TripSummaryRecord } from './trip.repository';
import { TripSearchCache } from './trip-search-cache';

const kafka = new Kafka({
  clientId: 'catalog-search-integration-test',
  brokers: (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(','),
  logLevel: logLevel.NOTHING,
});
const admin = kafka.admin();

beforeAll(async () => {
  await admin.connect();
  await admin.createTopics({
    waitForLeaders: true,
    topics: [{ topic: 'search-events', numPartitions: 1, replicationFactor: 1 }],
  });
});

afterAll(async () => admin.disconnect());

describe('trip search Redis cache and Kafka analytics', () => {
  it('uses Redis on a repeated request and publishes a fact for miss and hit', async () => {
    const cache = createIsolatedCache();
    const publisher = new SearchAnalyticsPublisher();
    const search = vi.fn(async () => [trip]);
    const service = createService(cache, publisher, search);
    const searchSessionId = randomUUID();
    const consumer = kafka.consumer({ groupId: `search-cache-${randomUUID()}` });
    const events: SearchPerformedV2[] = [];

    await cache.invalidate();
    await consumer.connect();
    await consumer.subscribe({ topic: 'search-events', fromBeginning: false });
    const joined = new Promise<void>((resolve) => {
      consumer.on(consumer.events.GROUP_JOIN, () => resolve());
    });
    await consumer.run({
      eachMessage: async ({ message }) => {
        if (!message.value) return;
        const event = JSON.parse(message.value.toString()) as SearchPerformedEvent;
        if (event.eventType === 'SearchPerformedV2' && event.searchSessionId === searchSessionId) {
          events.push(event);
        }
      },
    });
    await Promise.race([
      joined,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Kafka consumer did not join its group.')), 10_000),
      ),
    ]);

    try {
      await expect(
        service.searchTrips(searchRequest(searchSessionId, ['TB-DEMO', 'KUMHO-DEMO'])),
      ).resolves.toMatchObject({ trips: [trip] });
      await expect(
        service.searchTrips(searchRequest(searchSessionId, ['KUMHO-DEMO', 'TB-DEMO'])),
      ).resolves.toMatchObject({ trips: [trip] });

      await waitFor(() => events.length === 2);
      expect(search).toHaveBeenCalledOnce();
      expect(events.map((event) => event.payload.cacheStatus)).toEqual(['MISS', 'HIT']);
      expect(events[0]?.payload.operatorCodes).toEqual(['KUMHO-DEMO', 'TB-DEMO']);
      expect(events.every((event) => event.payload.resultCount === 1)).toBe(true);
      expect(events.every((event) => event.payload.matchedRoutes.length === 1)).toBe(true);
      expect(events.every((event) => event.traceId.length > 0)).toBe(true);
    } finally {
      await publisher.onModuleDestroy();
      await cache.invalidate();
      await cache.onModuleDestroy();
      await consumer.stop();
      await consumer.disconnect();
    }
  });

  it('does not expose a stale result after the cache generation is invalidated', async () => {
    const cache = createIsolatedCache();
    const publisher = { publish: vi.fn() };
    let currentTrips = [trip];
    const search = vi.fn(async () => currentTrips);
    const service = createService(cache, publisher, search);

    await cache.invalidate();
    try {
      const request = searchRequest(randomUUID());
      await expect(service.searchTrips(request)).resolves.toMatchObject({ trips: [trip] });

      currentTrips = [];
      await cache.invalidate();

      await expect(service.searchTrips(request)).resolves.toMatchObject({ trips: [] });
      expect(search).toHaveBeenCalledTimes(2);
    } finally {
      await cache.invalidate();
      await cache.onModuleDestroy();
    }
  });

  it('invalidates a populated search after the admin deactivates a trip', async () => {
    const cache = createIsolatedCache();
    let currentTrips = [trip];
    const search = vi.fn(async () => currentTrips);
    const setActive = vi.fn(async (_tripId: string, isActive: boolean) => {
      currentTrips = isActive ? [trip] : [];
      return { tripId: trip.id, isActive, changed: true };
    });
    const service = new CatalogService(
      { ping: async () => undefined } as never,
      { suggest: async () => [] } as never,
      {
        resolveEndpoints: async () => ({
          originCityId: '00000000-0000-4000-8000-000000000001',
          destinationCityId: '00000000-0000-4000-8000-000000000002',
        }),
        search,
        findNearestDates: async () => [],
        setActive,
      } as never,
      cache,
      { publish: vi.fn() } as never,
    );
    const request = searchRequest(randomUUID());

    await cache.invalidate();
    try {
      await expect(service.searchTrips(request)).resolves.toMatchObject({ trips: [trip] });
      await expect(
        service.setTripActive({
          tripId: trip.id,
          isActive: false,
          actorRole: 'ADMIN',
          actorId: '00000000-0000-4000-8000-000000001403',
          actorTokenId: '00000000-0000-4000-8000-000000001404',
        }),
      ).resolves.toMatchObject({ changed: true, isActive: false });
      await expect(service.searchTrips(request)).resolves.toMatchObject({ trips: [] });
      expect(search).toHaveBeenCalledTimes(2);
    } finally {
      await cache.invalidate();
      await cache.onModuleDestroy();
    }
  });
});

function createIsolatedCache(): TripSearchCache {
  return new TripSearchCache({ namespace: `test:catalog:trip-search:${randomUUID()}` });
}

function createService(
  cache: TripSearchCache,
  publisher: SearchAnalyticsPublisher | { publish: (event: SearchPerformedEvent) => void },
  search: () => Promise<TripSummaryRecord[]>,
): CatalogService {
  return new CatalogService(
    { ping: async () => undefined } as never,
    { suggest: async () => [] } as never,
    {
      resolveEndpoints: async () => ({
        originCityId: '00000000-0000-4000-8000-000000000001',
        destinationCityId: '00000000-0000-4000-8000-000000000002',
      }),
      search,
      findNearestDates: async () => [],
    } as never,
    cache,
    publisher as never,
  );
}

function searchRequest(searchSessionId: string, operatorCodes: string[] = []) {
  return {
    originLocationId: '00000000-0000-4000-8000-000000000001',
    destinationLocationId: '00000000-0000-4000-8000-000000000002',
    travelDate: '2030-06-20',
    requestId: randomUUID(),
    searchSessionId,
    operatorCodes,
  };
}

async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for Kafka search events.');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

const trip: TripSummaryRecord = {
  id: '00000000-0000-4000-8000-000000000301',
  routeId: '00000000-0000-4000-8000-000000000201',
  operatorName: 'Phuong Trang Demo',
  vehicleTypeName: 'Sleeper 34',
  vehicleCode: 'BUS-001',
  originName: 'TP.HCM',
  destinationName: 'Da Lat',
  pickupName: 'Mien Dong',
  dropoffName: 'Da Lat Intercity',
  departureAt: '2030-06-20T00:00:00.000Z',
  arrivalAt: '2030-06-20T06:00:00.000Z',
  durationMinutes: 360,
  priceVnd: 280_000,
  remainingSeats: 34,
};
