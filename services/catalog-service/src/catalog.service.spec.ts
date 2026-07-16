import { describe, expect, it, vi } from 'vitest';

import { CatalogService } from './catalog.service';

const database = { ping: async () => undefined };
const locationRepository = { suggest: async () => [] };
const tripRepository = {
  resolveEndpoints: async () => null,
  search: async () => [],
  findNearestDates: async () => [],
  findById: async () => null,
};
const tripSearchCache = {
  get: async () => ({ status: 'MISS' as const, generation: '0' }),
  set: async () => undefined,
};
const searchAnalyticsPublisher = { publish: () => undefined };

describe('CatalogService', () => {
  it('creates a scheduled trip from an ADMIN-owned catalog command', async () => {
    const createTrip = vi.fn(async () => ({
      tripId: '00000000-0000-4000-8000-000000000777',
      routeId: '00000000-0000-4000-8000-000000000501',
      vehicleId: '00000000-0000-4000-8000-000000000401',
      seatLayoutVersionId: '00000000-0000-4000-8000-000000000902',
      departureAt: '2030-07-01T00:00:00.000Z',
      arrivalAt: '2030-07-01T07:00:00.000Z',
      priceVnd: 280000,
      status: 'SCHEDULED' as const,
      created: true,
      createdAt: '2026-07-15T00:00:00.000Z',
    }));
    const invalidate = vi.fn(async () => undefined);
    const service = new CatalogService(
      database as never,
      locationRepository as never,
      { ...tripRepository, createTrip } as never,
      { ...tripSearchCache, invalidate } as never,
      searchAnalyticsPublisher as never,
    );

    await expect(
      service.createTrip({
        routeId: '00000000-0000-4000-8000-000000000501',
        vehicleId: '00000000-0000-4000-8000-000000000401',
        seatLayoutVersionId: '00000000-0000-4000-8000-000000000902',
        departureAt: '2030-07-01T00:00:00Z',
        arrivalAt: '2030-07-01T07:00:00Z',
        priceVnd: 280000,
        idempotencyKey: 'create-trip-test-0001',
        actorRole: 'ADMIN',
        actorId: '00000000-0000-4000-8000-000000000011',
        actorTokenId: '00000000-0000-4000-8000-000000000012',
        requestId: 'req-create-trip',
      }),
    ).resolves.toMatchObject({ status: 'SCHEDULED', created: true });
    expect(createTrip).toHaveBeenCalledOnce();
    expect(invalidate).toHaveBeenCalledOnce();
  });

  it('rejects trip creation without an ADMIN actor before accessing PostgreSQL', async () => {
    const createTrip = vi.fn();
    const service = new CatalogService(
      database as never,
      locationRepository as never,
      { ...tripRepository, createTrip } as never,
      tripSearchCache as never,
      searchAnalyticsPublisher as never,
    );

    await expect(
      service.createTrip({
        routeId: '00000000-0000-4000-8000-000000000501',
        vehicleId: '00000000-0000-4000-8000-000000000401',
        seatLayoutVersionId: '00000000-0000-4000-8000-000000000902',
        departureAt: '2030-07-01T00:00:00Z',
        arrivalAt: '2030-07-01T07:00:00Z',
        priceVnd: 280000,
        idempotencyKey: 'create-trip-test-0002',
        actorRole: 'STAFF',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(createTrip).not.toHaveBeenCalled();
  });

  it('validates and forwards general Catalog CRUD only for ADMIN', async () => {
    const saveCatalogResource = vi.fn(async () => ({
      resourceType: 'LOCATION' as const,
      id: '00000000-0000-4000-8000-000000000199',
      created: true,
      changed: true,
      isActive: true,
      updatedAt: '2026-07-15T00:00:00.000Z',
    }));
    const invalidate = vi.fn(async () => undefined);
    const service = new CatalogService(
      database as never,
      locationRepository as never,
      { ...tripRepository, saveCatalogResource } as never,
      { ...tripSearchCache, invalidate } as never,
      searchAnalyticsPublisher as never,
    );
    const input = {
      code: 'DEMO-STOP',
      name: 'Điểm demo',
      kind: 'STATION',
      parentLocationId: '00000000-0000-4000-8000-000000000001',
      idempotencyKey: 'catalog-location-unit-001',
      actorRole: 'ADMIN',
      actorId: '00000000-0000-4000-8000-000000000011',
      actorTokenId: '00000000-0000-4000-8000-000000000012',
    };

    await expect(service.saveLocation(input)).resolves.toMatchObject({ created: true });
    expect(saveCatalogResource).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: 'LOCATION',
        values: expect.objectContaining({ normalizedName: 'diem demo' }),
      }),
    );
    expect(invalidate).toHaveBeenCalledOnce();
    await expect(service.saveLocation({ ...input, actorRole: 'STAFF' })).rejects.toMatchObject({
      name: 'CatalogAuthorizationError',
    });
  });

  it('preserves the correlation request id in health responses', () => {
    const result = new CatalogService(
      database as never,
      locationRepository as never,
      tripRepository as never,
      tripSearchCache as never,
      searchAnalyticsPublisher as never,
    ).health({ requestId: 'req-123' });

    expect(result).toMatchObject({
      service: 'catalog-service',
      status: 'UP',
      requestId: 'req-123',
      traceId: 'unavailable',
    });
  });

  it('normalizes location queries before using the repository', async () => {
    const suggest = vi.fn(async () => []);
    const service = new CatalogService(
      database as never,
      { suggest } as never,
      tripRepository as never,
      tripSearchCache as never,
      searchAnalyticsPublisher as never,
    );

    const result = await service.suggestLocations({
      query: 'Đà Lạt',
      limit: 5,
      requestId: 'req-1',
    });

    expect(suggest).toHaveBeenCalledWith('da lat', 5);
    expect(result).toMatchObject({ normalizedQuery: 'da lat', requestId: 'req-1' });
  });

  it('checks PostgreSQL before reporting readiness', async () => {
    const ping = vi.fn(async () => undefined);
    const service = new CatalogService(
      { ping } as never,
      locationRepository as never,
      tripRepository as never,
      tripSearchCache as never,
      searchAnalyticsPublisher as never,
    );

    await expect(service.readiness({ requestId: 'req-ready' })).resolves.toMatchObject({
      status: 'UP',
      requestId: 'req-ready',
    });
    expect(ping).toHaveBeenCalledOnce();
  });

  it('returns trip detail with stable policy references', async () => {
    const findById = vi.fn(async () => ({ id: '00000000-0000-4000-8000-000000000701' }));
    const service = new CatalogService(
      database as never,
      locationRepository as never,
      { ...tripRepository, findById } as never,
      tripSearchCache as never,
      searchAnalyticsPublisher as never,
    );

    await expect(
      service.getTrip({
        tripId: '00000000-0000-4000-8000-000000000701',
        requestId: 'req-detail',
      }),
    ).resolves.toMatchObject({
      trip: {
        id: '00000000-0000-4000-8000-000000000701',
        policies: [
          { code: 'CANCELLATION', resourceUri: 'bus://policy/cancellation' },
          { code: 'CHECKIN', resourceUri: 'bus://policy/checkin' },
        ],
      },
      timezone: 'Asia/Ho_Chi_Minh',
      requestId: 'req-detail',
    });
    expect(findById).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000701');
  });

  it('returns NOT_FOUND semantics for an inactive or unknown trip', async () => {
    const service = new CatalogService(
      database as never,
      locationRepository as never,
      tripRepository as never,
      tripSearchCache as never,
      searchAnalyticsPublisher as never,
    );

    await expect(
      service.getTrip({ tripId: '00000000-0000-4000-8000-000000000799' }),
    ).rejects.toMatchObject({ name: 'TripNotFoundError', code: 'NOT_FOUND' });
  });

  it('invalidates search cache only when an admin changes trip activation', async () => {
    const setActive = vi.fn(async () => ({
      tripId: '00000000-0000-4000-8000-000000000799',
      isActive: true,
      changed: true,
    }));
    const invalidate = vi.fn(async () => undefined);
    const service = new CatalogService(
      database as never,
      locationRepository as never,
      { ...tripRepository, setActive } as never,
      { ...tripSearchCache, invalidate } as never,
      searchAnalyticsPublisher as never,
    );

    await expect(
      service.setTripActive({
        tripId: '00000000-0000-4000-8000-000000000799',
        isActive: true,
        actorRole: 'ADMIN',
        actorId: '00000000-0000-4000-8000-000000001403',
        actorTokenId: '00000000-0000-4000-8000-000000001404',
        requestId: 'req-activate',
      }),
    ).resolves.toEqual({
      tripId: '00000000-0000-4000-8000-000000000799',
      isActive: true,
      changed: true,
      requestId: 'req-activate',
    });
    expect(invalidate).toHaveBeenCalledOnce();
  });

  it('lets an idempotent retry heal a prior cache invalidation failure', async () => {
    const invalidate = vi.fn();
    const service = new CatalogService(
      database as never,
      locationRepository as never,
      {
        ...tripRepository,
        setActive: async () => ({
          tripId: '00000000-0000-4000-8000-000000000799',
          isActive: false,
          changed: false,
        }),
      } as never,
      { ...tripSearchCache, invalidate } as never,
      searchAnalyticsPublisher as never,
    );

    await service.setTripActive({
      tripId: '00000000-0000-4000-8000-000000000799',
      isActive: false,
      actorRole: 'ADMIN',
      actorId: '00000000-0000-4000-8000-000000001403',
      actorTokenId: '00000000-0000-4000-8000-000000001404',
    });
    expect(invalidate).toHaveBeenCalledOnce();
  });

  it('authorizes activation in Catalog before accessing trip state', async () => {
    const setActive = vi.fn();
    const service = new CatalogService(
      database as never,
      locationRepository as never,
      { ...tripRepository, setActive } as never,
      tripSearchCache as never,
      searchAnalyticsPublisher as never,
    );

    await expect(
      service.setTripActive({
        tripId: '00000000-0000-4000-8000-000000000799',
        isActive: true,
        actorRole: 'STAFF',
      }),
    ).rejects.toMatchObject({ name: 'CatalogAuthorizationError', code: 'FORBIDDEN' });
    expect(setActive).not.toHaveBeenCalled();
  });

  it('enforces ADMIN metadata before transitioning a trip lifecycle', async () => {
    const transitionStatus = vi.fn();
    const service = new CatalogService(
      database as never,
      locationRepository as never,
      { ...tripRepository, transitionStatus } as never,
      tripSearchCache as never,
      searchAnalyticsPublisher as never,
    );

    await expect(
      service.transitionTripStatus({
        tripId: '00000000-0000-4000-8000-000000000704',
        targetStatus: 'DEPARTED',
        idempotencyKey: 'trip-lifecycle-unit-001',
        actorRole: 'STAFF',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(transitionStatus).not.toHaveBeenCalled();
  });

  it('transitions a trip and invalidates search results after the durable change', async () => {
    const transitionStatus = vi.fn(async () => ({
      tripId: '00000000-0000-4000-8000-000000000704',
      previousStatus: 'SCHEDULED',
      status: 'DEPARTED',
      changed: true,
      transitionedAt: '2030-06-21T01:00:00.000Z',
    }));
    const invalidate = vi.fn(async () => undefined);
    const service = new CatalogService(
      database as never,
      locationRepository as never,
      { ...tripRepository, transitionStatus } as never,
      { ...tripSearchCache, invalidate } as never,
      searchAnalyticsPublisher as never,
    );

    await expect(
      service.transitionTripStatus({
        tripId: '00000000-0000-4000-8000-000000000704',
        targetStatus: 'DEPARTED',
        idempotencyKey: 'trip-lifecycle-unit-002',
        actorRole: 'ADMIN',
        actorId: '00000000-0000-4000-8000-000000001403',
        actorTokenId: '00000000-0000-4000-8000-000000009003',
        requestId: 'request-lifecycle',
      }),
    ).resolves.toMatchObject({ status: 'DEPARTED', changed: true });
    expect(invalidate).toHaveBeenCalledOnce();
  });

  it('resolves station selections to cities before searching trips', async () => {
    const resolveEndpoints = vi.fn(async () => ({
      originCityId: '00000000-0000-4000-8000-000000000001',
      destinationCityId: '00000000-0000-4000-8000-000000000002',
    }));
    const search = vi.fn(async () => []);
    const findNearestDates = vi.fn(async () => ['2030-06-21']);
    const service = new CatalogService(
      database as never,
      locationRepository as never,
      {
        resolveEndpoints,
        search,
        findNearestDates,
      } as never,
      tripSearchCache as never,
      searchAnalyticsPublisher as never,
    );

    const result = await service.searchTrips({
      originLocationId: '00000000-0000-4000-8000-000000000101',
      destinationLocationId: '00000000-0000-4000-8000-000000000103',
      travelDate: '2030-06-20',
      requestId: 'req-trip',
    });

    expect(search).toHaveBeenCalledWith(
      {
        originCityId: '00000000-0000-4000-8000-000000000001',
        destinationCityId: '00000000-0000-4000-8000-000000000002',
      },
      {
        travelDate: '2030-06-20',
        operatorCodes: [],
        vehicleTypeCodes: [],
        sort: 'DEPARTURE_EARLIEST',
      },
    );
    expect(result).toMatchObject({
      timezone: 'Asia/Ho_Chi_Minh',
      requestId: 'req-trip',
      nearestTravelDates: ['2030-06-21'],
    });
    expect(findNearestDates).toHaveBeenCalledOnce();
  });

  it('validates filter ranges before querying trips', async () => {
    const service = new CatalogService(
      database as never,
      locationRepository as never,
      {
        resolveEndpoints: async () => ({
          originCityId: '00000000-0000-4000-8000-000000000001',
          destinationCityId: '00000000-0000-4000-8000-000000000002',
        }),
        search: vi.fn(),
        findNearestDates: vi.fn(),
      } as never,
      tripSearchCache as never,
      searchAnalyticsPublisher as never,
    );

    await expect(
      service.searchTrips({
        originLocationId: '00000000-0000-4000-8000-000000000001',
        destinationLocationId: '00000000-0000-4000-8000-000000000002',
        travelDate: '2030-06-20',
        departureTimeFrom: '20:00',
        departureTimeTo: '08:00',
      }),
    ).rejects.toMatchObject({ name: 'TripSearchValidationError' });
  });

  it('returns a cached result without querying trips and publishes a hit fact', async () => {
    const search = vi.fn();
    const publish = vi.fn();
    const service = new CatalogService(
      database as never,
      locationRepository as never,
      {
        resolveEndpoints: async () => ({
          originCityId: '00000000-0000-4000-8000-000000000001',
          destinationCityId: '00000000-0000-4000-8000-000000000002',
        }),
        search,
        findNearestDates: vi.fn(),
      } as never,
      {
        get: async () => ({
          status: 'HIT',
          value: {
            trips: [{ id: 'trip-cached', priceVnd: 280000 }],
            nearestTravelDates: [],
          },
        }),
        set: vi.fn(),
      } as never,
      { publish } as never,
    );

    await expect(
      service.searchTrips({
        originLocationId: '00000000-0000-4000-8000-000000000001',
        destinationLocationId: '00000000-0000-4000-8000-000000000002',
        travelDate: '2030-06-20',
        searchSessionId: '00000000-0000-4000-8000-000000000901',
      }),
    ).resolves.toMatchObject({ trips: [{ id: 'trip-cached' }] });

    expect(search).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'SearchPerformedV2',
        searchSessionId: '00000000-0000-4000-8000-000000000901',
        payload: expect.objectContaining({
          cacheStatus: 'HIT',
          resultCount: 1,
          matchedRoutes: expect.any(Array),
        }),
      }),
    );
  });

  it('writes a miss using the generation observed before the database query', async () => {
    const set = vi.fn(async () => undefined);
    const publish = vi.fn();
    const service = new CatalogService(
      database as never,
      locationRepository as never,
      {
        resolveEndpoints: async () => ({
          originCityId: '00000000-0000-4000-8000-000000000001',
          destinationCityId: '00000000-0000-4000-8000-000000000002',
        }),
        search: async () => [],
        findNearestDates: async () => ['2030-06-21'],
      } as never,
      {
        get: async () => ({ status: 'MISS', generation: '42' }),
        set,
      } as never,
      { publish } as never,
    );

    await service.searchTrips({
      originLocationId: '00000000-0000-4000-8000-000000000001',
      destinationLocationId: '00000000-0000-4000-8000-000000000002',
      travelDate: '2030-06-20',
    });

    expect(set).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { trips: [], nearestTravelDates: ['2030-06-21'] },
      '42',
    );
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ cacheStatus: 'MISS' }) }),
    );
  });

  it('falls back to PostgreSQL when Redis is unavailable without writing a cache entry', async () => {
    const search = vi.fn(async () => []);
    const set = vi.fn();
    const publish = vi.fn();
    const service = new CatalogService(
      database as never,
      locationRepository as never,
      {
        resolveEndpoints: async () => ({
          originCityId: '00000000-0000-4000-8000-000000000001',
          destinationCityId: '00000000-0000-4000-8000-000000000002',
        }),
        search,
        findNearestDates: async () => [],
      } as never,
      { get: async () => ({ status: 'BYPASS' }), set } as never,
      { publish } as never,
    );

    await service.searchTrips({
      originLocationId: '00000000-0000-4000-8000-000000000001',
      destinationLocationId: '00000000-0000-4000-8000-000000000002',
      travelDate: '2030-06-20',
    });

    expect(search).toHaveBeenCalledOnce();
    expect(set).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ cacheStatus: 'BYPASS' }) }),
    );
  });
});
