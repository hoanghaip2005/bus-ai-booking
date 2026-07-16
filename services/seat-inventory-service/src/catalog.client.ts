import { activePropagationHeaders, createRequestId, logEvent } from '@bus/observability';
import { Metadata, status } from '@grpc/grpc-js';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom, type Observable, timeout } from 'rxjs';

export interface CatalogSeatDefinition {
  id: string;
  label: string;
  deck: number;
  row: number;
  column: number;
}

export interface CatalogTripLayout {
  tripId: string;
  layoutId: string;
  layoutVersion: number;
  layoutName: string;
  deckCount: number;
  priceVnd: number;
  seats: CatalogSeatDefinition[];
}

interface CatalogHealthResponse {
  status: string;
}

interface CatalogTripResponse {
  trip?: {
    id: string;
    seatLayout?: {
      id: string;
      version: number;
      name: string;
      deckCount: number;
      seats?: CatalogSeatDefinition[];
    };
    priceVnd: number;
  };
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

  async getTripLayout(tripId: string, requestId?: string): Promise<CatalogTripLayout> {
    const correlationId = createRequestId(requestId);
    try {
      const response = await this.call(
        (client, metadata) => client.getTrip({ tripId, requestId: correlationId }, metadata),
        correlationId,
      );
      const layout = response.trip?.seatLayout;
      if (!response.trip || !layout) throw new CatalogDependencyError();
      return {
        tripId: response.trip.id,
        layoutId: layout.id,
        layoutVersion: layout.version,
        layoutName: layout.name,
        deckCount: layout.deckCount,
        priceVnd: response.trip.priceVnd,
        seats: layout.seats ?? [],
      };
    } catch (error) {
      if (isGrpcNotFound(error)) throw new CatalogTripNotFoundError();
      if (error instanceof CatalogDependencyError) throw error;
      logEvent({
        service: 'seat-inventory-service',
        level: 'error',
        event: 'catalog.trip-layout.failed',
        message: 'Catalog trip layout request failed.',
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

function isGrpcNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === status.NOT_FOUND
  );
}
