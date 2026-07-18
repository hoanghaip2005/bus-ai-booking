import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';

import { CatalogDatabase } from './catalog.database';
import { TripRepository } from './trip.repository';
import type { TripSearchCriteria } from './trip.repository';

const database = new CatalogDatabase();
const repository = new TripRepository(database);
const endpoints = {
  originCityId: '00000000-0000-4000-8000-000000000001',
  destinationCityId: '00000000-0000-4000-8000-000000000002',
};

function criteria(overrides: Partial<TripSearchCriteria> = {}): TripSearchCriteria {
  return {
    travelDate: '2030-06-20',
    operatorCodes: [],
    vehicleTypeCodes: [],
    sort: 'DEPARTURE_EARLIEST',
    ...overrides,
  };
}

describe('TripRepository', () => {
  afterAll(async () => database.onModuleDestroy());

  it('loads an active trip with ordered stops and its versioned seat layout', async () => {
    const trip = await repository.findById('00000000-0000-4000-8000-000000000701');

    expect(trip).toMatchObject({
      routeCode: 'HCM-DLI',
      vehicleCode: 'PT-S34-01',
      vehiclePlate: '51B-120.01',
      status: 'SCHEDULED',
      priceVnd: 280000,
      seatLayout: { version: 1, deckCount: 2 },
    });
    expect(trip?.stops.map((stop) => stop.kind)).toEqual(['PICKUP', 'DROPOFF']);
    expect(trip?.stops.map((stop) => stop.scheduledAt)).toEqual([
      '2030-06-20T00:00:00.000Z',
      '2030-06-20T07:00:00.000Z',
    ]);
    expect(trip?.seatLayout.seats).toHaveLength(34);
  });

  it('does not expose inactive trips through trip detail', async () => {
    await expect(repository.findById('00000000-0000-4000-8000-000000000799')).resolves.toBeNull();
  });

  it('updates trip activation idempotently for the admin command', async () => {
    const tripId = '00000000-0000-4000-8000-000000000799';
    try {
      await expect(repository.setActive(tripId, true)).resolves.toEqual({
        tripId,
        isActive: true,
        changed: true,
      });
      await expect(repository.findById(tripId)).resolves.toMatchObject({ id: tripId });
      await expect(repository.setActive(tripId, true)).resolves.toEqual({
        tripId,
        isActive: true,
        changed: false,
      });
    } finally {
      await repository.setActive(tripId, false);
    }
  });

  it('enforces and audits the idempotent trip lifecycle', async () => {
    const tripId = '00000000-0000-4000-8000-000000000704';
    const actorId = '00000000-0000-4000-8000-000000001403';
    const departedKey = 'trip-lifecycle-integration-departed';
    const completedKey = 'trip-lifecycle-integration-completed';
    try {
      await database.query('DELETE FROM catalog.trip_lifecycle_audit WHERE actor_id = $1', [
        actorId,
      ]);
      await database.query("UPDATE catalog.trips SET status = 'SCHEDULED' WHERE id = $1", [tripId]);

      await expect(
        repository.transitionStatus({
          tripId,
          targetStatus: 'COMPLETED',
          idempotencyKey: 'trip-lifecycle-invalid-skip',
          actorId,
          requestId: 'request-invalid-skip',
          traceId: 'trace-invalid-skip',
        }),
      ).rejects.toMatchObject({ name: 'TripLifecycleTransitionError' });

      const departedCommand = {
        tripId,
        targetStatus: 'DEPARTED',
        idempotencyKey: departedKey,
        actorId,
        requestId: 'request-departed',
        traceId: 'trace-departed',
      } as const;
      const [departed, departedRetry] = await Promise.all([
        repository.transitionStatus(departedCommand),
        repository.transitionStatus(departedCommand),
      ]);
      expect(departed).toMatchObject({ previousStatus: 'SCHEDULED', status: 'DEPARTED' });
      expect(departedRetry).toEqual(departed);

      await expect(
        repository.transitionStatus({
          tripId,
          targetStatus: 'COMPLETED',
          idempotencyKey: completedKey,
          actorId,
          requestId: 'request-completed',
          traceId: 'trace-completed',
        }),
      ).resolves.toMatchObject({ previousStatus: 'DEPARTED', status: 'COMPLETED' });

      const audit = await database.query<{ request_id: string; trace_id: string }>(
        `SELECT request_id, trace_id FROM catalog.trip_lifecycle_audit
          WHERE actor_id = $1 ORDER BY occurred_at`,
        [actorId],
      );
      expect(audit.rows).toEqual([
        { request_id: 'request-departed', trace_id: 'trace-departed' },
        { request_id: 'request-completed', trace_id: 'trace-completed' },
      ]);
    } finally {
      await database.query('DELETE FROM catalog.trip_lifecycle_audit WHERE actor_id = $1', [
        actorId,
      ]);
      await database.query("UPDATE catalog.trips SET status = 'SCHEDULED' WHERE id = $1", [tripId]);
    }
  });

  it('creates trip and fare atomically with idempotent admin audit', async () => {
    const actorId = '00000000-0000-4000-8000-000000001404';
    const idempotencyKey = 'trip-create-integration-0001';
    const command = {
      routeId: '00000000-0000-4000-8000-000000000501',
      vehicleId: '00000000-0000-4000-8000-000000000401',
      seatLayoutVersionId: '00000000-0000-4000-8000-000000000902',
      departureAt: new Date('2030-07-01T00:00:00.000Z'),
      arrivalAt: new Date('2030-07-01T07:00:00.000Z'),
      priceVnd: 285000,
      actorId,
      idempotencyKey,
      requestFingerprint: 'fingerprint-create-trip-1',
      requestId: 'request-create-trip',
      traceId: 'trace-create-trip',
    };
    try {
      await database.query('DELETE FROM catalog.admin_audit WHERE actor_id = $1', [actorId]);
      const [created, replay] = await Promise.all([
        repository.createTrip(command),
        repository.createTrip(command),
      ]);
      expect(created.tripId).toBe(replay.tripId);
      expect([created.created, replay.created].sort()).toEqual([false, true]);
      await expect(
        repository.createTrip({ ...command, priceVnd: 300000, requestFingerprint: 'different' }),
      ).rejects.toMatchObject({ name: 'TripAdminIdempotencyConflictError' });

      const persisted = await database.query<{ price_vnd: number; action: string }>(
        `SELECT fare.price_vnd, audit.action
           FROM catalog.trips AS trip
           JOIN catalog.fares AS fare ON fare.trip_id = trip.id
           JOIN catalog.admin_audit AS audit ON audit.target_id = trip.id
          WHERE trip.id = $1`,
        [created.tripId],
      );
      expect(persisted.rows).toEqual([{ price_vnd: 285000, action: 'TRIP_CREATED' }]);
    } finally {
      await database.query(
        `WITH deleted_audit AS (
           DELETE FROM catalog.admin_audit WHERE actor_id = $1 RETURNING target_id
         )
         DELETE FROM catalog.trips WHERE id IN (SELECT target_id FROM deleted_audit)`,
        [actorId],
      );
    }
  });

  it('lists only active route, vehicle, and assigned layout preparation options', async () => {
    const options = await repository.listPreparationOptions();
    expect(options.routes).toContainEqual(
      expect.objectContaining({ code: 'HCM-DLI', durationMinutes: 420 }),
    );
    expect(options.vehicles).toContainEqual(
      expect.objectContaining({
        code: 'PT-S34-01',
        seatLayoutVersionId: '00000000-0000-4000-8000-000000000902',
        seatLayoutVersion: 1,
      }),
    );
  });

  it('manages every general Catalog resource family with audit and soft deactivation', async () => {
    const actorId = randomUUID();
    const ids: Record<'location' | 'layout' | 'vehicle' | 'route', string> = {
      location: randomUUID(),
      layout: randomUUID(),
      vehicle: randomUUID(),
      route: randomUUID(),
    };
    let tripId: string | undefined;
    const base = {
      actorId,
      requestId: 'request-catalog-crud',
      traceId: 'trace-catalog-crud',
    };
    const save = (
      resourceType: 'LOCATION' | 'ROUTE' | 'VEHICLE' | 'SEAT_LAYOUT' | 'TRIP',
      id: string | undefined,
      values: Record<string, unknown>,
      suffix: string,
    ) =>
      repository.saveCatalogResource({
        ...base,
        resourceType,
        ...(id && { id }),
        values,
        idempotencyKey: `catalog-crud-${suffix}`,
        requestFingerprint: `fingerprint-${suffix}`,
      });

    try {
      await save(
        'LOCATION',
        ids.location,
        {
          code: `E2E-${ids.location.slice(0, 8)}`,
          name: 'Bến thử nghiệm Catalog',
          normalizedName: 'ben thu nghiem catalog',
          kind: 'STATION',
          parentLocationId: endpoints.originCityId,
        },
        'location',
      );
      await save(
        'SEAT_LAYOUT',
        undefined,
        {
          vehicleTypeId: '00000000-0000-4000-8000-000000000301',
          version: 77,
          name: 'Layout integration 77',
          deckCount: 1,
          layoutJson: JSON.stringify({
            seats: [{ id: 'A01', label: 'A01', deck: 1, row: 1, column: 1 }],
          }),
        },
        'layout',
      ).then((result) => {
        ids.layout = result.id;
      });
      await save(
        'VEHICLE',
        ids.vehicle,
        {
          code: `E2E-VEH-${ids.vehicle.slice(0, 8)}`,
          plate: `E2E-${ids.vehicle.slice(0, 7)}`,
          operatorId: '00000000-0000-4000-8000-000000000203',
          vehicleTypeId: '00000000-0000-4000-8000-000000000301',
          seatLayoutVersionId: ids.layout,
        },
        'vehicle',
      );
      await save(
        'ROUTE',
        ids.route,
        {
          code: `E2E-ROUTE-${ids.route.slice(0, 8)}`,
          originLocationId: endpoints.originCityId,
          destinationLocationId: endpoints.destinationCityId,
          durationMinutes: 430,
          stops: [
            {
              locationId: '00000000-0000-4000-8000-000000000101',
              stopOrder: 1,
              stopKind: 'PICKUP',
              offsetMinutes: 0,
            },
            {
              locationId: '00000000-0000-4000-8000-000000000103',
              stopOrder: 2,
              stopKind: 'DROPOFF',
              offsetMinutes: 430,
            },
          ],
        },
        'route',
      );
      const createdTrip = await repository.createTrip({
        routeId: ids.route,
        vehicleId: ids.vehicle,
        seatLayoutVersionId: ids.layout,
        departureAt: new Date('2030-08-01T00:00:00.000Z'),
        arrivalAt: new Date('2030-08-01T07:10:00.000Z'),
        priceVnd: 310000,
        ...base,
        idempotencyKey: 'catalog-crud-trip-create',
        requestFingerprint: 'fingerprint-trip-create',
      });
      tripId = createdTrip.tripId;
      await save(
        'TRIP',
        tripId,
        {
          routeId: ids.route,
          vehicleId: ids.vehicle,
          seatLayoutVersionId: ids.layout,
          departureAt: new Date('2030-08-02T00:00:00.000Z'),
          arrivalAt: new Date('2030-08-02T07:10:00.000Z'),
          priceVnd: 320000,
        },
        'trip-update',
      );

      for (const [resourceType, id] of [
        ['LOCATION', ids.location],
        ['ROUTE', ids.route],
        ['VEHICLE', ids.vehicle],
        ['SEAT_LAYOUT', ids.layout],
        ['TRIP', tripId],
      ] as const) {
        await repository.setCatalogResourceActive({
          ...base,
          resourceType,
          id,
          isActive: false,
          values: {},
          idempotencyKey: `catalog-crud-deactivate-${resourceType}`,
          requestFingerprint: `fingerprint-deactivate-${resourceType}`,
        });
      }

      const snapshot = await repository.getAdminCatalog();
      expect(snapshot.locations.find((item) => item.id === ids.location)?.isActive).toBe(false);
      expect(snapshot.routes.find((item) => item.id === ids.route)?.stops).toHaveLength(2);
      expect(snapshot.vehicles.find((item) => item.id === ids.vehicle)?.isActive).toBe(false);
      expect(snapshot.seatLayouts.find((item) => item.id === ids.layout)?.isActive).toBe(false);
      expect(snapshot.trips.find((item) => item.id === tripId)).toMatchObject({
        isActive: false,
        priceVnd: 320000,
      });
    } finally {
      await database.query('DELETE FROM catalog.admin_audit WHERE actor_id = $1', [actorId]);
      if (tripId) await database.query('DELETE FROM catalog.trips WHERE id = $1', [tripId]);
      await database.query('DELETE FROM catalog.routes WHERE id = $1', [ids.route]);
      await database.query('DELETE FROM catalog.vehicles WHERE id = $1', [ids.vehicle]);
      await database.query('DELETE FROM catalog.seat_layout_versions WHERE id = $1', [ids.layout]);
      await database.query('DELETE FROM catalog.locations WHERE id = $1', [ids.location]);
    }
  });

  it('searches the local Vietnam travel date and sorts by departure time', async () => {
    const endpoints = await repository.resolveEndpoints(
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
    );
    expect(endpoints).not.toBeNull();

    const trips = await repository.search(endpoints!, criteria());

    expect(trips).toHaveLength(3);
    expect(trips.map((trip) => trip.operatorName)).toEqual([
      'Phương Trang Demo',
      'Thành Bưởi Demo',
      'Kumho Demo',
    ]);
    expect(trips[0]).toMatchObject({
      pickupName: 'Bến xe Miền Đông',
      dropoffName: 'Bến xe Liên tỉnh Đà Lạt',
      departureAt: '2030-06-20T00:00:00.000Z',
      priceVnd: 280000,
      remainingSeats: 34,
    });
  });

  it('resolves a station selection to its parent city', async () => {
    await expect(
      repository.resolveEndpoints(
        '00000000-0000-4000-8000-000000000101',
        '00000000-0000-4000-8000-000000000103',
      ),
    ).resolves.toEqual({
      originCityId: '00000000-0000-4000-8000-000000000001',
      destinationCityId: '00000000-0000-4000-8000-000000000002',
    });
  });

  it('returns an empty list when the local date has no active trip', async () => {
    await expect(
      repository.search(endpoints, criteria({ travelDate: '2030-06-19' })),
    ).resolves.toEqual([]);
  });

  it('filters by departure time range', async () => {
    const trips = await repository.search(
      endpoints,
      criteria({ departureTimeFrom: '15:00', departureTimeTo: '21:00' }),
    );
    expect(trips.map((trip) => trip.operatorName)).toEqual(['Thành Bưởi Demo']);
  });

  it('filters by price, operator, vehicle type and minimum seats', async () => {
    await expect(repository.search(endpoints, criteria({ maxPriceVnd: 250000 }))).resolves.toEqual([
      expect.objectContaining({ operatorName: 'Kumho Demo' }),
    ]);
    await expect(repository.search(endpoints, criteria({ minPriceVnd: 300000 }))).resolves.toEqual([
      expect.objectContaining({ operatorName: 'Thành Bưởi Demo' }),
    ]);
    await expect(
      repository.search(endpoints, criteria({ operatorCodes: ['TB-DEMO'] })),
    ).resolves.toEqual([expect.objectContaining({ operatorName: 'Thành Bưởi Demo' })]);
    await expect(
      repository.search(endpoints, criteria({ vehicleTypeCodes: ['SLEEPER-34'] })),
    ).resolves.toEqual([expect.objectContaining({ operatorName: 'Phương Trang Demo' })]);
    await expect(
      repository.search(endpoints, criteria({ minimumRemainingSeats: 30 })),
    ).resolves.toEqual([expect.objectContaining({ remainingSeats: 34 })]);
  });

  it.each([
    ['PRICE_LOWEST', ['Kumho Demo', 'Phương Trang Demo', 'Thành Bưởi Demo']],
    ['DURATION_SHORTEST', ['Thành Bưởi Demo', 'Phương Trang Demo', 'Kumho Demo']],
  ] as const)('sorts by %s', async (sort, expectedOperators) => {
    const trips = await repository.search(endpoints, criteria({ sort }));
    expect(trips.map((trip) => trip.operatorName)).toEqual(expectedOperators);
  });

  it('returns nearest dates that still satisfy filters', async () => {
    const nearest = await repository.findNearestDates(
      endpoints,
      criteria({ travelDate: '2030-06-19' }),
    );
    expect(nearest.slice(0, 2)).toEqual(['2030-06-20', '2030-06-21']);
    expect(nearest.length).toBeLessThanOrEqual(3);
    const filteredNearest = await repository.findNearestDates(
      endpoints,
      criteria({ travelDate: '2030-06-19', operatorCodes: ['TB-DEMO'] }),
    );
    expect(filteredNearest[0]).toBe('2030-06-20');
    expect(filteredNearest.length).toBeLessThanOrEqual(3);
  });
});
