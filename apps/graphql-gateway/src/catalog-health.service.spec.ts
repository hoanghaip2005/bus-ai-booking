import type { ClientGrpc } from '@nestjs/microservices';
import { of, throwError } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { CatalogHealthService } from './catalog-health.service';

describe('CatalogHealthService', () => {
  it('maps gRPC failures to a stable dependency error', async () => {
    const grpcClient = {
      getService: () => ({
        health: () => throwError(() => new Error('connection refused')),
      }),
    } as unknown as ClientGrpc;
    const service = new CatalogHealthService(grpcClient);
    service.onModuleInit();

    await expect(service.check('request-123')).rejects.toEqual(
      expect.objectContaining({
        name: 'CatalogDependencyError',
        message: 'Catalog Service is unavailable.',
        requestId: 'request-123',
      }),
    );
  });

  it('propagates request metadata for location suggestions', async () => {
    let receivedRequestId: string | undefined;
    const grpcClient = {
      getService: () => ({
        suggestLocations: (
          input: { query: string; limit: number; requestId: string },
          metadata: { get(key: string): unknown[] },
        ) => {
          receivedRequestId = String(metadata.get('x-request-id')[0]);
          return of({
            suggestions: [
              {
                id: 'location-1',
                code: 'HCM',
                name: 'TP.HCM',
                normalizedName: 'tp hcm',
                kind: 1,
              },
            ],
            normalizedQuery: 'sai gon',
            requestId: input.requestId,
          });
        },
      }),
    } as unknown as ClientGrpc;
    const service = new CatalogHealthService(grpcClient);
    service.onModuleInit();

    const response = await service.suggestLocations('Sai Gon', 8, 'request-456');

    expect(receivedRequestId).toBe('request-456');
    expect(response).toMatchObject({
      normalizedQuery: 'sai gon',
      requestId: 'request-456',
      suggestions: [{ code: 'HCM' }],
    });
  });

  it('normalizes an omitted empty protobuf repeated field', async () => {
    const grpcClient = {
      getService: () => ({
        suggestLocations: () => of({ normalizedQuery: 'missing', requestId: 'request-789' }),
      }),
    } as unknown as ClientGrpc;
    const service = new CatalogHealthService(grpcClient);
    service.onModuleInit();

    await expect(service.suggestLocations('missing', 8, 'request-789')).resolves.toMatchObject({
      suggestions: [],
      normalizedQuery: 'missing',
      requestId: 'request-789',
    });
  });

  it('propagates trip search metadata and normalizes an empty result', async () => {
    let receivedRequestId: string | undefined;
    const grpcClient = {
      getService: () => ({
        searchTrips: (input: { requestId: string }, metadata: { get(key: string): unknown[] }) => {
          receivedRequestId = String(metadata.get('x-request-id')[0]);
          return of({ timezone: 'Asia/Ho_Chi_Minh', requestId: input.requestId });
        },
      }),
    } as unknown as ClientGrpc;
    const service = new CatalogHealthService(grpcClient);
    service.onModuleInit();

    await expect(
      service.searchTrips(
        {
          originLocationId: '00000000-0000-4000-8000-000000000001',
          destinationLocationId: '00000000-0000-4000-8000-000000000002',
          travelDate: '2030-06-20',
        },
        'request-trip',
      ),
    ).resolves.toMatchObject({
      trips: [],
      nearestTravelDates: [],
      timezone: 'Asia/Ho_Chi_Minh',
    });
    expect(receivedRequestId).toBe('request-trip');
  });

  it('preserves gRPC validation failures for the GraphQL boundary', async () => {
    const grpcClient = {
      getService: () => ({
        searchTrips: () =>
          throwError(() => ({ code: 3, details: 'Origin and destination must be different.' })),
      }),
    } as unknown as ClientGrpc;
    const service = new CatalogHealthService(grpcClient);
    service.onModuleInit();

    await expect(
      service.searchTrips({
        originLocationId: '00000000-0000-4000-8000-000000000001',
        destinationLocationId: '00000000-0000-4000-8000-000000000002',
        travelDate: '2030-06-20',
      }),
    ).rejects.toMatchObject({
      name: 'CatalogValidationError',
      message: 'Origin and destination must be different.',
    });
  });

  it('returns a normalized trip detail response', async () => {
    const grpcClient = {
      getService: () => ({
        getTrip: (input: { tripId: string; requestId: string }) =>
          of({
            trip: {
              id: input.tripId,
              routeId: 'route-1',
              routeCode: 'HCM-DLI',
              operatorName: 'Phuong Trang Demo',
              vehicleTypeName: 'Sleeper 34',
              vehicleCode: 'PT-S34-01',
              vehiclePlate: '51B-120.01',
              originName: 'TP.HCM',
              destinationName: 'Da Lat',
              departureAt: '2030-06-20T00:00:00.000Z',
              arrivalAt: '2030-06-20T07:00:00.000Z',
              durationMinutes: 420,
              priceVnd: 280000,
              remainingSeats: 34,
              status: 'SCHEDULED',
              seatLayout: { id: 'layout-1', version: 1, name: 'Sleeper', deckCount: 2 },
            },
            timezone: 'Asia/Ho_Chi_Minh',
            requestId: input.requestId,
          }),
      }),
    } as unknown as ClientGrpc;
    const service = new CatalogHealthService(grpcClient);
    service.onModuleInit();

    await expect(
      service.getTrip('00000000-0000-4000-8000-000000000701', 'request-detail'),
    ).resolves.toMatchObject({
      trip: { stops: [], policies: [], seatLayout: { seats: [] } },
      timezone: 'Asia/Ho_Chi_Minh',
      requestId: 'request-detail',
    });
  });

  it('preserves gRPC not-found failures for the GraphQL boundary', async () => {
    const grpcClient = {
      getService: () => ({
        getTrip: () => throwError(() => ({ code: 5, details: 'Trip not found.' })),
      }),
    } as unknown as ClientGrpc;
    const service = new CatalogHealthService(grpcClient);
    service.onModuleInit();

    await expect(
      service.getTrip('00000000-0000-4000-8000-000000000799', 'request-missing'),
    ).rejects.toMatchObject({ name: 'CatalogNotFoundError', requestId: 'request-missing' });
  });
});
