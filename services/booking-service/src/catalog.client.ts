import { activePropagationHeaders, createRequestId, logEvent } from '@bus/observability';
import { Metadata, status } from '@grpc/grpc-js';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom, type Observable, timeout } from 'rxjs';

import type { BookingTripSnapshot } from './booking.types';

interface CatalogHealthResponse {
  status: string;
}

interface CatalogTripStop {
  name: string;
  kind: number | string;
}

interface CatalogTripResponse {
  trip?: {
    id: string;
    routeId: string;
    routeCode: string;
    operatorName: string;
    vehicleTypeName: string;
    vehicleCode: string;
    vehiclePlate: string;
    originName: string;
    destinationName: string;
    departureAt: string;
    arrivalAt: string;
    priceVnd: number;
    stops?: CatalogTripStop[];
  };
  timezone: string;
}

interface CatalogQueryClient {
  health(input: { requestId: string }, metadata?: Metadata): Observable<CatalogHealthResponse>;
  getTrip(
    input: { tripId: string; requestId: string },
    metadata?: Metadata,
  ): Observable<CatalogTripResponse>;
}

export class CatalogTripNotFoundError extends Error {
  constructor() {
    super('Trip was not found.');
    this.name = 'CatalogTripNotFoundError';
  }
}

export class CatalogDependencyError extends Error {
  constructor(options?: ErrorOptions) {
    super('Catalog Service is unavailable.', options);
    this.name = 'CatalogDependencyError';
  }
}

export interface CatalogBookingSnapshot extends BookingTripSnapshot {
  catalogPriceVnd: number;
}

@Injectable()
export class CatalogClient implements OnModuleInit {
  private client?: CatalogQueryClient;

  constructor(@Inject('CATALOG_GRPC') private readonly grpcClient: ClientGrpc) {}

  onModuleInit(): void {
    this.client = this.grpcClient.getService<CatalogQueryClient>('CatalogQueryService');
  }

  async readiness(requestId?: string): Promise<void> {
    const correlationId = createRequestId(requestId);
    const response = await this.call(
      (client, metadata) => client.health({ requestId: correlationId }, metadata),
      correlationId,
    );
    if (response.status !== 'UP') throw new CatalogDependencyError();
  }

  async getBookingSnapshot(tripId: string, requestId?: string): Promise<CatalogBookingSnapshot> {
    const correlationId = createRequestId(requestId);
    try {
      const response = await this.call(
        (client, metadata) => client.getTrip({ tripId, requestId: correlationId }, metadata),
        correlationId,
      );
      const trip = response.trip;
      if (!trip) throw new CatalogDependencyError();
      const stops = trip.stops ?? [];
      const pickup = stops.find((stop) => isPickup(stop.kind));
      let dropoff: CatalogTripStop | undefined;
      for (let index = stops.length - 1; index >= 0; index -= 1) {
        const stop = stops[index];
        if (stop && isDropoff(stop.kind)) {
          dropoff = stop;
          break;
        }
      }
      if (!pickup || !dropoff) throw new CatalogDependencyError();
      return {
        tripId: trip.id,
        routeId: trip.routeId,
        routeCode: trip.routeCode,
        operatorName: trip.operatorName,
        vehicleTypeName: trip.vehicleTypeName,
        vehicleCode: trip.vehicleCode,
        vehiclePlate: trip.vehiclePlate,
        originName: trip.originName,
        destinationName: trip.destinationName,
        pickupName: pickup.name,
        dropoffName: dropoff.name,
        departureAt: trip.departureAt,
        arrivalAt: trip.arrivalAt,
        timezone: response.timezone,
        unitPriceVnd: trip.priceVnd,
        catalogPriceVnd: trip.priceVnd,
      };
    } catch (error) {
      if (isGrpcCode(error, status.NOT_FOUND)) throw new CatalogTripNotFoundError();
      if (error instanceof CatalogDependencyError) throw error;
      logEvent({
        service: 'booking-service',
        level: 'error',
        event: 'catalog.booking-snapshot.failed',
        message: 'Catalog trip snapshot request failed.',
        requestId: correlationId,
        fields: { dependency: 'catalog-service', tripId },
      });
      throw new CatalogDependencyError({ cause: error });
    }
  }

  private async call<T>(
    operation: (client: CatalogQueryClient, metadata: Metadata) => Observable<T>,
    requestId: string,
  ): Promise<T> {
    if (!this.client) throw new CatalogDependencyError();
    const metadata = new Metadata();
    metadata.set('x-request-id', requestId);
    for (const [key, value] of Object.entries(activePropagationHeaders())) metadata.set(key, value);
    return firstValueFrom(operation(this.client, metadata).pipe(timeout(2_000)));
  }
}

function isPickup(kind: number | string): boolean {
  return (
    kind === 1 || kind === 3 || kind === 'TRIP_STOP_KIND_PICKUP' || kind === 'TRIP_STOP_KIND_BOTH'
  );
}

function isDropoff(kind: number | string): boolean {
  return (
    kind === 2 || kind === 3 || kind === 'TRIP_STOP_KIND_DROPOFF' || kind === 'TRIP_STOP_KIND_BOTH'
  );
}

function isGrpcCode(error: unknown, code: number): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}
