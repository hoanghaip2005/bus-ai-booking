import { activePropagationHeaders, createRequestId, logEvent } from '@bus/observability';
import {
  CatalogQueryServiceClient,
  type GetTripResponse,
  type HealthResponse,
  type SearchTripsResponse as ProtoSearchTripsResponse,
  type SuggestLocationsResponse,
} from '@bus/contracts-proto/generated/catalog';
import { credentials, Metadata, status, type CallOptions, type ServiceError } from '@grpc/grpc-js';

export class McpCatalogError extends Error {
  constructor(
    readonly code: 'INVALID_INPUT' | 'NOT_FOUND' | 'DEPENDENCY_UNAVAILABLE',
    options?: ErrorOptions,
  ) {
    super('Catalog request could not be completed.', options);
    this.name = 'McpCatalogError';
  }
}

export interface CatalogClient {
  readiness(requestId?: string): Promise<void>;
  suggestLocations(
    query: string,
    limit: number,
    requestId?: string,
  ): Promise<readonly LocationSuggestion[]>;
  searchTrips(input: SearchTripsInput, requestId?: string): Promise<CatalogTripSearch>;
  getTrip(tripId: string, requestId?: string): Promise<TripDetail>;
}

export interface LocationSuggestion {
  id: string;
  code: string;
  name: string;
  kind: string;
}

export interface SearchTripsInput {
  originLocationId: string;
  destinationLocationId: string;
  travelDate: string;
  departureTimeFrom?: string;
  departureTimeTo?: string;
  minPriceVnd?: number;
  maxPriceVnd?: number;
  operatorCodes?: string[];
  vehicleTypeCodes?: string[];
  minimumRemainingSeats?: number;
  sort: 'DEPARTURE_EARLIEST' | 'PRICE_LOWEST' | 'DURATION_SHORTEST';
}

export interface CatalogTripSearch {
  timezone: string;
  trips: readonly TripSummary[];
  nearestTravelDates: readonly string[];
}

export interface TripSummary {
  id: string;
  operatorName: string;
  vehicleTypeName: string;
  vehicleCode: string;
  originName: string;
  destinationName: string;
  pickupName: string;
  dropoffName: string;
  departureAt: string;
  arrivalAt: string;
  durationMinutes: number;
  priceVnd: number;
  remainingSeats: number;
}

export interface TripDetail extends TripSummary {
  routeId: string;
  routeCode: string;
  vehiclePlate: string;
  status: string;
  stops: readonly {
    id: string;
    name: string;
    kind: string;
    stopOrder: number;
    scheduledAt: string;
  }[];
  policies: readonly { code: string; title: string; summary: string; resourceUri: string }[];
}

export class GrpcCatalogClient implements CatalogClient {
  private readonly client: InstanceType<typeof CatalogQueryServiceClient>;

  constructor(
    address = process.env.CATALOG_GRPC_URL ?? '127.0.0.1:50051',
    private readonly timeoutMs = 2_000,
  ) {
    this.client = new CatalogQueryServiceClient(address, credentials.createInsecure());
  }

  async readiness(requestId?: string): Promise<void> {
    const correlationId = createRequestId(requestId);
    try {
      const response = await this.call<HealthResponse>(
        (metadata, options, callback) =>
          this.client.health({ requestId: correlationId }, metadata, options, callback),
        correlationId,
      );
      if (response.status !== 'UP') throw new McpCatalogError('DEPENDENCY_UNAVAILABLE');
    } catch (error) {
      this.normalizeError(error, correlationId, 'health');
    }
  }

  suggestLocations(
    query: string,
    limit: number,
    requestId?: string,
  ): Promise<readonly LocationSuggestion[]> {
    const correlationId = createRequestId(requestId);
    return this.call<SuggestLocationsResponse>(
      (metadata, options, callback) =>
        this.client.suggestLocations(
          { query, limit, requestId: correlationId },
          metadata,
          options,
          callback,
        ),
      correlationId,
    ).then((response) =>
      (response.suggestions ?? []).map((suggestion) => ({
        id: suggestion.id,
        code: suggestion.code,
        name: suggestion.name,
        kind: locationKindName(suggestion.kind),
      })),
    );
  }

  searchTrips(input: SearchTripsInput, requestId?: string): Promise<CatalogTripSearch> {
    const correlationId = createRequestId(requestId);
    return this.call<ProtoSearchTripsResponse>(
      (metadata, options, callback) =>
        this.client.searchTrips(
          {
            ...input,
            requestId: correlationId,
            operatorCodes: input.operatorCodes ?? [],
            vehicleTypeCodes: input.vehicleTypeCodes ?? [],
            sort: sortValue(input.sort),
          },
          metadata,
          options,
          callback,
        ),
      correlationId,
    )
      .then((response) => ({
        timezone: response.timezone,
        trips: response.trips ?? [],
        nearestTravelDates: response.nearestTravelDates ?? [],
      }))
      .catch((error) => this.normalizeError(error, correlationId, 'searchTrips'));
  }

  getTrip(tripId: string, requestId?: string): Promise<TripDetail> {
    const correlationId = createRequestId(requestId);
    return this.call<GetTripResponse>(
      (metadata, options, callback) =>
        this.client.getTrip({ tripId, requestId: correlationId }, metadata, options, callback),
      correlationId,
    )
      .then((response) => {
        const trip = response.trip;
        if (!trip) throw new McpCatalogError('NOT_FOUND');
        return {
          id: trip.id,
          routeId: trip.routeId,
          routeCode: trip.routeCode,
          operatorName: trip.operatorName,
          vehicleTypeName: trip.vehicleTypeName,
          vehicleCode: trip.vehicleCode,
          vehiclePlate: trip.vehiclePlate,
          originName: trip.originName,
          destinationName: trip.destinationName,
          pickupName: trip.stops?.find((stop) => stop.kind === 1 || stop.kind === 3)?.name ?? '',
          dropoffName:
            [...(trip.stops ?? [])].reverse().find((stop) => stop.kind === 2 || stop.kind === 3)
              ?.name ?? '',
          departureAt: trip.departureAt,
          arrivalAt: trip.arrivalAt,
          durationMinutes: trip.durationMinutes,
          priceVnd: trip.priceVnd,
          remainingSeats: trip.remainingSeats,
          status: trip.status,
          stops: (trip.stops ?? []).map((stop) => ({
            id: stop.id,
            name: stop.name,
            kind: stopKindName(stop.kind),
            stopOrder: stop.stopOrder,
            scheduledAt: stop.scheduledAt,
          })),
          policies: trip.policies ?? [],
        };
      })
      .catch((error) => this.normalizeError(error, correlationId, 'getTrip'));
  }

  private call<T>(
    operation: (
      metadata: Metadata,
      options: Partial<CallOptions>,
      callback: (error: ServiceError | null, response: T) => void,
    ) => void,
    requestId: string,
  ): Promise<T> {
    const metadata = new Metadata();
    metadata.set('x-request-id', requestId);
    for (const [key, value] of Object.entries(activePropagationHeaders())) metadata.set(key, value);
    return new Promise((resolve, reject) => {
      const deadline = new Date(Date.now() + this.timeoutMs);
      operation(metadata, { deadline }, (error, response) =>
        error ? reject(error) : resolve(response),
      );
    });
  }

  private normalizeError(error: unknown, requestId: string, operation: string): never {
    if (error instanceof McpCatalogError) throw error;
    const grpcCode =
      typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
    const code =
      grpcCode === status.NOT_FOUND
        ? 'NOT_FOUND'
        : grpcCode === status.INVALID_ARGUMENT
          ? 'INVALID_INPUT'
          : 'DEPENDENCY_UNAVAILABLE';
    logEvent({
      service: 'mcp-server',
      level: 'error',
      event: `catalog.${operation}.failed`,
      message: 'MCP Catalog request failed.',
      requestId,
      fields: { code },
    });
    throw new McpCatalogError(code, { cause: error });
  }
}

function sortValue(sort: SearchTripsInput['sort']): number {
  return { DEPARTURE_EARLIEST: 1, PRICE_LOWEST: 2, DURATION_SHORTEST: 3 }[sort];
}

function locationKindName(kind: number): string {
  return kind === 1 ? 'CITY' : kind === 2 ? 'STATION' : 'UNSPECIFIED';
}

function stopKindName(kind: number): string {
  return kind === 1 ? 'PICKUP' : kind === 2 ? 'DROPOFF' : kind === 3 ? 'BOTH' : 'UNSPECIFIED';
}
