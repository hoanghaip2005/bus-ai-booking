import { activePropagationHeaders, createRequestId, logEvent } from '@bus/observability';
import { Metadata } from '@grpc/grpc-js';
import { status } from '@grpc/grpc-js';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom, type Observable, timeout } from 'rxjs';

import { CatalogDependencyError } from './catalog-dependency.error';
import { CatalogNotFoundError } from './catalog-not-found.error';
import { CatalogValidationError } from './catalog-validation.error';
import type { GatewayActor } from './identity.service';

export class CatalogAuthorizationGatewayError extends Error {
  constructor(readonly requestId: string) {
    super('Admin role is required.');
    this.name = 'CatalogAuthorizationGatewayError';
  }
}

export class CatalogInvalidStateTransitionGatewayError extends Error {
  constructor(
    readonly requestId: string,
    message: string,
  ) {
    super(message);
    this.name = 'CatalogInvalidStateTransitionGatewayError';
  }
}

export class CatalogIdempotencyConflictGatewayError extends Error {
  constructor(readonly requestId: string) {
    super('Idempotency key conflicts with an earlier trip lifecycle command.');
    this.name = 'CatalogIdempotencyConflictGatewayError';
  }
}

export class CatalogInvalidConfigurationGatewayError extends Error {
  constructor(
    readonly requestId: string,
    message: string,
  ) {
    super(message);
    this.name = 'CatalogInvalidConfigurationGatewayError';
  }
}

export interface CatalogHealthResponse {
  service: string;
  status: string;
  version: string;
  requestId: string;
  traceId: string;
  checkedAt: string;
}

export interface CatalogLocationSuggestion {
  id: string;
  code: string;
  name: string;
  normalizedName: string;
  kind: number | string;
  parentLocationId?: string;
}

export interface CatalogLocationSuggestionsResponse {
  suggestions?: CatalogLocationSuggestion[];
  normalizedQuery: string;
  requestId: string;
}

export interface CatalogTripSummary {
  id: string;
  routeId: string;
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

export interface CatalogTripSearchResponse {
  trips?: CatalogTripSummary[];
  timezone: string;
  requestId: string;
  nearestTravelDates?: string[];
}

export interface CatalogTripStop {
  id: string;
  locationId: string;
  name: string;
  kind: number | string;
  stopOrder: number;
  offsetMinutes: number;
  scheduledAt: string;
}

export interface CatalogSeatDefinition {
  id: string;
  label: string;
  deck: number;
  row: number;
  column: number;
}

export interface CatalogSeatLayout {
  id: string;
  version: number;
  name: string;
  deckCount: number;
  seats?: CatalogSeatDefinition[];
}

export interface CatalogPolicyReference {
  code: string;
  title: string;
  summary: string;
  resourceUri: string;
}

export interface CatalogTripDetail {
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
  durationMinutes: number;
  priceVnd: number;
  remainingSeats: number;
  status: string;
  stops?: CatalogTripStop[];
  seatLayout?: CatalogSeatLayout;
  policies?: CatalogPolicyReference[];
}

export interface CatalogTripDetailResponse {
  trip?: CatalogTripDetail;
  timezone: string;
  requestId: string;
}

export interface AdminCatalogGatewayResponse {
  locations?: Array<Record<string, unknown>>;
  operators?: Array<Record<string, unknown>>;
  vehicleTypes?: Array<Record<string, unknown>>;
  seatLayouts?: Array<Record<string, unknown>>;
  vehicles?: Array<Record<string, unknown>>;
  routes?: Array<Record<string, unknown> & { stops?: Array<Record<string, unknown>> }>;
  trips?: Array<Record<string, unknown>>;
  requestId: string;
}

export interface SaveCatalogGatewayResponse {
  resourceType: number | string;
  id: string;
  created: boolean;
  changed: boolean;
  isActive: boolean;
  updatedAt: string;
  requestId: string;
}

export type TripSortInput = 'DEPARTURE_EARLIEST' | 'PRICE_LOWEST' | 'DURATION_SHORTEST';

export interface CatalogTripSearchInput {
  originLocationId: string;
  destinationLocationId: string;
  travelDate: string;
  departureTimeFrom?: string | null;
  departureTimeTo?: string | null;
  minPriceVnd?: number | null;
  maxPriceVnd?: number | null;
  operatorCodes?: string[] | null;
  vehicleTypeCodes?: string[] | null;
  minimumRemainingSeats?: number | null;
  sort?: TripSortInput | null;
}

interface CatalogQueryClient {
  health(input: { requestId: string }, metadata?: Metadata): Observable<CatalogHealthResponse>;
  suggestLocations(
    input: { query: string; limit: number; requestId: string },
    metadata?: Metadata,
  ): Observable<CatalogLocationSuggestionsResponse>;
  searchTrips(
    input: Omit<CatalogTripSearchInput, 'sort'> & {
      requestId: string;
      sort: number;
      searchSessionId?: string;
    },
    metadata?: Metadata,
  ): Observable<CatalogTripSearchResponse>;
  getTrip(
    input: { tripId: string; requestId: string },
    metadata?: Metadata,
  ): Observable<CatalogTripDetailResponse>;
}

interface CatalogAdminClient {
  setTripActive(
    input: { tripId: string; isActive: boolean; requestId: string },
    metadata?: Metadata,
  ): Observable<{ tripId: string; isActive: boolean; changed: boolean; requestId: string }>;
  transitionTripStatus(
    input: { tripId: string; targetStatus: string; idempotencyKey: string; requestId: string },
    metadata?: Metadata,
  ): Observable<{
    tripId: string;
    previousStatus: string;
    status: string;
    changed: boolean;
    transitionedAt: string;
    requestId: string;
  }>;
  listTripPreparationOptions(
    input: { requestId: string },
    metadata?: Metadata,
  ): Observable<{
    routes?: Array<{
      id: string;
      code: string;
      originName: string;
      destinationName: string;
      durationMinutes: number;
    }>;
    vehicles?: Array<{
      id: string;
      code: string;
      plate: string;
      operatorName: string;
      vehicleTypeName: string;
      seatLayoutVersionId: string;
      seatLayoutVersion: number;
      seatLayoutName: string;
    }>;
    requestId: string;
  }>;
  createTrip(
    input: {
      routeId: string;
      vehicleId: string;
      seatLayoutVersionId: string;
      departureAt: string;
      arrivalAt: string;
      priceVnd: number;
      idempotencyKey: string;
      requestId: string;
    },
    metadata?: Metadata,
  ): Observable<{
    tripId: string;
    routeId: string;
    vehicleId: string;
    seatLayoutVersionId: string;
    departureAt: string;
    arrivalAt: string;
    priceVnd: number;
    status: string;
    created: boolean;
    createdAt: string;
    requestId: string;
  }>;
  getAdminCatalog(
    input: { requestId: string },
    metadata?: Metadata,
  ): Observable<AdminCatalogGatewayResponse>;
  saveLocation(
    input: Record<string, unknown>,
    metadata?: Metadata,
  ): Observable<SaveCatalogGatewayResponse>;
  saveRoute(
    input: Record<string, unknown>,
    metadata?: Metadata,
  ): Observable<SaveCatalogGatewayResponse>;
  saveVehicle(
    input: Record<string, unknown>,
    metadata?: Metadata,
  ): Observable<SaveCatalogGatewayResponse>;
  saveSeatLayout(
    input: Record<string, unknown>,
    metadata?: Metadata,
  ): Observable<SaveCatalogGatewayResponse>;
  updateTrip(
    input: Record<string, unknown>,
    metadata?: Metadata,
  ): Observable<SaveCatalogGatewayResponse>;
  setCatalogResourceActive(
    input: Record<string, unknown>,
    metadata?: Metadata,
  ): Observable<SaveCatalogGatewayResponse>;
}

@Injectable()
export class CatalogHealthService implements OnModuleInit {
  private catalogClient?: CatalogQueryClient;
  private catalogAdminClient?: CatalogAdminClient;

  constructor(@Inject('CATALOG_GRPC') private readonly grpcClient: ClientGrpc) {}

  onModuleInit() {
    this.catalogClient = this.grpcClient.getService<CatalogQueryClient>('CatalogQueryService');
    this.catalogAdminClient = this.grpcClient.getService<CatalogAdminClient>('CatalogAdminService');
  }

  async check(inboundRequestId?: string): Promise<CatalogHealthResponse> {
    const requestId = createRequestId(inboundRequestId);
    if (!this.catalogClient) {
      throw new CatalogDependencyError(requestId);
    }

    const metadata = new Metadata();
    metadata.set('x-request-id', requestId);
    for (const [key, value] of Object.entries(activePropagationHeaders())) {
      metadata.set(key, value);
    }

    try {
      return await firstValueFrom(
        this.catalogClient.health({ requestId }, metadata).pipe(timeout(2_000)),
      );
    } catch (error) {
      logEvent({
        service: 'graphql-gateway',
        level: 'error',
        event: 'catalog.health.failed',
        message: 'Catalog health check failed.',
        requestId,
        fields: { dependency: 'catalog-service' },
      });
      throw new CatalogDependencyError(requestId, { cause: error });
    }
  }

  async suggestLocations(
    query: string,
    limit: number,
    inboundRequestId?: string,
  ): Promise<CatalogLocationSuggestionsResponse> {
    const requestId = createRequestId(inboundRequestId);
    if (!this.catalogClient) {
      throw new CatalogDependencyError(requestId);
    }

    const metadata = new Metadata();
    metadata.set('x-request-id', requestId);
    for (const [key, value] of Object.entries(activePropagationHeaders())) {
      metadata.set(key, value);
    }

    try {
      const response = await firstValueFrom(
        this.catalogClient
          .suggestLocations({ query, limit, requestId }, metadata)
          .pipe(timeout(2_000)),
      );
      return {
        ...response,
        // proto-loader omits an empty repeated field unless defaults are enabled.
        suggestions: response.suggestions ?? [],
      };
    } catch (error) {
      logEvent({
        service: 'graphql-gateway',
        level: 'error',
        event: 'catalog.location-suggestions.failed',
        message: 'Catalog location suggestions failed.',
        requestId,
        fields: { dependency: 'catalog-service' },
      });
      throw new CatalogDependencyError(requestId, { cause: error });
    }
  }

  async searchTrips(
    input: CatalogTripSearchInput,
    inboundRequestId?: string,
    searchSessionId?: string,
  ): Promise<CatalogTripSearchResponse> {
    const requestId = createRequestId(inboundRequestId);
    if (!this.catalogClient) {
      throw new CatalogDependencyError(requestId);
    }

    const metadata = new Metadata();
    metadata.set('x-request-id', requestId);
    for (const [key, value] of Object.entries(activePropagationHeaders())) {
      metadata.set(key, value);
    }

    try {
      const response = await firstValueFrom(
        this.catalogClient
          .searchTrips(
            {
              originLocationId: input.originLocationId,
              destinationLocationId: input.destinationLocationId,
              travelDate: input.travelDate,
              requestId,
              ...(searchSessionId ? { searchSessionId } : {}),
              ...(input.departureTimeFrom ? { departureTimeFrom: input.departureTimeFrom } : {}),
              ...(input.departureTimeTo ? { departureTimeTo: input.departureTimeTo } : {}),
              ...(input.minPriceVnd !== null && input.minPriceVnd !== undefined
                ? { minPriceVnd: input.minPriceVnd }
                : {}),
              ...(input.maxPriceVnd !== null && input.maxPriceVnd !== undefined
                ? { maxPriceVnd: input.maxPriceVnd }
                : {}),
              operatorCodes: input.operatorCodes ?? [],
              vehicleTypeCodes: input.vehicleTypeCodes ?? [],
              ...(input.minimumRemainingSeats !== null && input.minimumRemainingSeats !== undefined
                ? { minimumRemainingSeats: input.minimumRemainingSeats }
                : {}),
              sort: mapTripSort(input.sort),
            },
            metadata,
          )
          .pipe(timeout(2_000)),
      );
      return {
        ...response,
        trips: response.trips ?? [],
        nearestTravelDates: response.nearestTravelDates ?? [],
      };
    } catch (error) {
      if (isGrpcInvalidArgument(error)) {
        throw new CatalogValidationError(
          requestId,
          error.details || error.message || 'Trip search input is invalid.',
          { cause: error },
        );
      }
      logEvent({
        service: 'graphql-gateway',
        level: 'error',
        event: 'catalog.trip-search.failed',
        message: 'Catalog trip search failed.',
        requestId,
        fields: { dependency: 'catalog-service' },
      });
      throw new CatalogDependencyError(requestId, { cause: error });
    }
  }

  async getTrip(tripId: string, inboundRequestId?: string): Promise<CatalogTripDetailResponse> {
    const requestId = createRequestId(inboundRequestId);
    if (!this.catalogClient) throw new CatalogDependencyError(requestId);

    const metadata = new Metadata();
    metadata.set('x-request-id', requestId);
    for (const [key, value] of Object.entries(activePropagationHeaders())) {
      metadata.set(key, value);
    }

    try {
      const response = await firstValueFrom(
        this.catalogClient.getTrip({ tripId, requestId }, metadata).pipe(timeout(2_000)),
      );
      if (!response.trip?.seatLayout) {
        throw new CatalogDependencyError(requestId, {
          cause: new Error('Catalog GetTrip response omitted required trip detail fields.'),
        });
      }
      return {
        ...response,
        trip: {
          ...response.trip,
          stops: response.trip.stops ?? [],
          policies: response.trip.policies ?? [],
          seatLayout: {
            ...response.trip.seatLayout,
            seats: response.trip.seatLayout.seats ?? [],
          },
        },
      };
    } catch (error) {
      if (error instanceof CatalogDependencyError) throw error;
      if (isGrpcNotFound(error)) {
        throw new CatalogNotFoundError(requestId, error.details || 'Trip was not found.', {
          cause: error,
        });
      }
      if (isGrpcInvalidArgument(error)) {
        throw new CatalogValidationError(requestId, error.details || 'Trip ID is invalid.', {
          cause: error,
        });
      }
      logEvent({
        service: 'graphql-gateway',
        level: 'error',
        event: 'catalog.trip-detail.failed',
        message: 'Catalog trip detail failed.',
        requestId,
        fields: { dependency: 'catalog-service' },
      });
      throw new CatalogDependencyError(requestId, { cause: error });
    }
  }

  async setTripActive(
    tripId: string,
    isActive: boolean,
    actor: GatewayActor,
    inboundRequestId?: string,
  ): Promise<{ tripId: string; isActive: boolean; changed: boolean; requestId: string }> {
    const requestId = createRequestId(inboundRequestId);
    if (!this.catalogAdminClient) throw new CatalogDependencyError(requestId);
    const metadata = new Metadata();
    metadata.set('x-request-id', requestId);
    metadata.set('x-actor-id', actor.id);
    metadata.set('x-actor-role', actor.role);
    metadata.set('x-actor-token-id', actor.tokenId);
    for (const [key, value] of Object.entries(activePropagationHeaders())) metadata.set(key, value);
    try {
      return await firstValueFrom(
        this.catalogAdminClient
          .setTripActive({ tripId, isActive, requestId }, metadata)
          .pipe(timeout(3_000)),
      );
    } catch (error) {
      if (grpcStatus(error) === status.PERMISSION_DENIED) {
        throw new CatalogAuthorizationGatewayError(requestId);
      }
      if (isGrpcNotFound(error)) {
        throw new CatalogNotFoundError(requestId, 'Trip was not found.', { cause: error });
      }
      if (isGrpcInvalidArgument(error)) {
        throw new CatalogValidationError(requestId, 'Trip activation input is invalid.', {
          cause: error,
        });
      }
      throw new CatalogDependencyError(requestId, { cause: error });
    }
  }

  async transitionTripStatus(
    tripId: string,
    targetStatus: 'DEPARTED' | 'COMPLETED',
    idempotencyKey: string,
    actor: GatewayActor,
    inboundRequestId?: string,
  ) {
    const requestId = createRequestId(inboundRequestId);
    if (!this.catalogAdminClient) throw new CatalogDependencyError(requestId);
    const metadata = new Metadata();
    metadata.set('x-request-id', requestId);
    metadata.set('x-actor-id', actor.id);
    metadata.set('x-actor-role', actor.role);
    metadata.set('x-actor-token-id', actor.tokenId);
    for (const [key, value] of Object.entries(activePropagationHeaders())) metadata.set(key, value);
    try {
      return await firstValueFrom(
        this.catalogAdminClient
          .transitionTripStatus({ tripId, targetStatus, idempotencyKey, requestId }, metadata)
          .pipe(timeout(3_000)),
      );
    } catch (error) {
      const code = grpcStatus(error);
      if (code === status.PERMISSION_DENIED) throw new CatalogAuthorizationGatewayError(requestId);
      if (code === status.NOT_FOUND) {
        throw new CatalogNotFoundError(requestId, 'Trip was not found.', { cause: error });
      }
      if (code === status.INVALID_ARGUMENT) {
        throw new CatalogValidationError(requestId, 'Trip lifecycle input is invalid.', {
          cause: error,
        });
      }
      if (code === status.FAILED_PRECONDITION) {
        const details = grpcDetails(error) ?? 'Trip lifecycle transition is invalid.';
        throw new CatalogInvalidStateTransitionGatewayError(requestId, details);
      }
      if (code === status.ALREADY_EXISTS) {
        throw new CatalogIdempotencyConflictGatewayError(requestId);
      }
      throw new CatalogDependencyError(requestId, { cause: error });
    }
  }

  async listTripPreparationOptions(actor: GatewayActor, inboundRequestId?: string) {
    const requestId = createRequestId(inboundRequestId);
    if (!this.catalogAdminClient) throw new CatalogDependencyError(requestId);
    const metadata = adminMetadata(actor, requestId);
    try {
      const response = await firstValueFrom(
        this.catalogAdminClient
          .listTripPreparationOptions({ requestId }, metadata)
          .pipe(timeout(3_000)),
      );
      return { routes: response.routes ?? [], vehicles: response.vehicles ?? [] };
    } catch (error) {
      if (grpcStatus(error) === status.PERMISSION_DENIED) {
        throw new CatalogAuthorizationGatewayError(requestId);
      }
      throw new CatalogDependencyError(requestId, { cause: error });
    }
  }

  async createTrip(
    input: {
      routeId: string;
      vehicleId: string;
      seatLayoutVersionId: string;
      departureAt: string;
      arrivalAt: string;
      priceVnd: number;
      idempotencyKey: string;
    },
    actor: GatewayActor,
    inboundRequestId?: string,
  ) {
    const requestId = createRequestId(inboundRequestId);
    if (!this.catalogAdminClient) throw new CatalogDependencyError(requestId);
    try {
      return await firstValueFrom(
        this.catalogAdminClient
          .createTrip({ ...input, requestId }, adminMetadata(actor, requestId))
          .pipe(timeout(3_000)),
      );
    } catch (error) {
      const code = grpcStatus(error);
      if (code === status.PERMISSION_DENIED) throw new CatalogAuthorizationGatewayError(requestId);
      if (code === status.INVALID_ARGUMENT) {
        throw new CatalogValidationError(
          requestId,
          grpcDetails(error) ?? 'Trip input is invalid.',
          {
            cause: error,
          },
        );
      }
      if (code === status.FAILED_PRECONDITION) {
        throw new CatalogInvalidConfigurationGatewayError(
          requestId,
          grpcDetails(error) ?? 'Trip configuration is invalid.',
        );
      }
      if (code === status.ALREADY_EXISTS) {
        throw new CatalogIdempotencyConflictGatewayError(requestId);
      }
      throw new CatalogDependencyError(requestId, { cause: error });
    }
  }

  async getAdminCatalog(actor: GatewayActor, inboundRequestId?: string) {
    const requestId = createRequestId(inboundRequestId);
    if (!this.catalogAdminClient) throw new CatalogDependencyError(requestId);
    try {
      const response = await firstValueFrom(
        this.catalogAdminClient
          .getAdminCatalog({ requestId }, adminMetadata(actor, requestId))
          .pipe(timeout(10_000)),
      );
      return {
        locations: (response.locations ?? []).map((location) => ({
          ...location,
          kind: normalizeLocationKind(location.kind),
        })),
        operators: response.operators ?? [],
        vehicleTypes: response.vehicleTypes ?? [],
        seatLayouts: response.seatLayouts ?? [],
        vehicles: response.vehicles ?? [],
        routes: (response.routes ?? []).map((route) => ({
          ...route,
          stops: (route.stops ?? []).map((stop) => ({
            ...stop,
            stopKind: normalizeStopKind(stop.stopKind),
          })),
        })),
        trips: response.trips ?? [],
      };
    } catch (error) {
      return this.mapAdminMutationError(error, requestId);
    }
  }

  saveLocation(input: Record<string, unknown>, actor: GatewayActor, requestId?: string) {
    return this.adminMutation(
      'saveLocation',
      { ...input, kind: input.kind === 'CITY' ? 1 : 2 },
      actor,
      requestId,
    );
  }
  saveRoute(input: Record<string, unknown>, actor: GatewayActor, requestId?: string) {
    const stops = Array.isArray(input.stops)
      ? input.stops.map((stop) => ({
          ...(stop as Record<string, unknown>),
          stopKind: mapStopKind(String((stop as Record<string, unknown>).stopKind)),
        }))
      : [];
    return this.adminMutation('saveRoute', { ...input, stops }, actor, requestId);
  }
  saveVehicle(input: Record<string, unknown>, actor: GatewayActor, requestId?: string) {
    return this.adminMutation('saveVehicle', input, actor, requestId);
  }
  saveSeatLayout(input: Record<string, unknown>, actor: GatewayActor, requestId?: string) {
    return this.adminMutation('saveSeatLayout', input, actor, requestId);
  }
  updateTrip(input: Record<string, unknown>, actor: GatewayActor, requestId?: string) {
    return this.adminMutation('updateTrip', input, actor, requestId);
  }
  setCatalogResourceActive(
    input: Record<string, unknown>,
    actor: GatewayActor,
    requestId?: string,
  ) {
    return this.adminMutation(
      'setCatalogResourceActive',
      { ...input, resourceType: mapResourceType(String(input.resourceType)) },
      actor,
      requestId,
    );
  }

  private async adminMutation(
    method:
      | 'saveLocation'
      | 'saveRoute'
      | 'saveVehicle'
      | 'saveSeatLayout'
      | 'updateTrip'
      | 'setCatalogResourceActive',
    input: Record<string, unknown>,
    actor: GatewayActor,
    inboundRequestId?: string,
  ): Promise<SaveCatalogGatewayResponse> {
    const requestId = createRequestId(inboundRequestId);
    if (!this.catalogAdminClient) throw new CatalogDependencyError(requestId);
    try {
      return await firstValueFrom(
        this.catalogAdminClient[method](
          { ...input, requestId },
          adminMetadata(actor, requestId),
        ).pipe(timeout(3_000)),
      );
    } catch (error) {
      return this.mapAdminMutationError(error, requestId);
    }
  }

  private mapAdminMutationError(error: unknown, requestId: string): never {
    const code = grpcStatus(error);
    if (code === status.PERMISSION_DENIED) throw new CatalogAuthorizationGatewayError(requestId);
    if (code === status.INVALID_ARGUMENT)
      throw new CatalogValidationError(
        requestId,
        grpcDetails(error) ?? 'Catalog input is invalid.',
        { cause: error },
      );
    if (code === status.NOT_FOUND)
      throw new CatalogNotFoundError(requestId, 'Catalog resource was not found.', {
        cause: error,
      });
    if (code === status.FAILED_PRECONDITION)
      throw new CatalogInvalidConfigurationGatewayError(
        requestId,
        grpcDetails(error) ?? 'Catalog configuration is invalid.',
      );
    if (code === status.ALREADY_EXISTS) throw new CatalogIdempotencyConflictGatewayError(requestId);
    throw new CatalogDependencyError(requestId, { cause: error });
  }
}

function adminMetadata(actor: GatewayActor, requestId: string): Metadata {
  const metadata = new Metadata();
  metadata.set('x-request-id', requestId);
  metadata.set('x-actor-id', actor.id);
  metadata.set('x-actor-role', actor.role);
  metadata.set('x-actor-token-id', actor.tokenId);
  for (const [key, value] of Object.entries(activePropagationHeaders())) metadata.set(key, value);
  return metadata;
}

function grpcDetails(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('details' in error)) return undefined;
  return typeof error.details === 'string' ? error.details : undefined;
}

function mapTripSort(value: TripSortInput | null | undefined): number {
  if (value === 'PRICE_LOWEST') return 2;
  if (value === 'DURATION_SHORTEST') return 3;
  return 1;
}

function mapStopKind(value: string): number {
  if (value === 'PICKUP') return 1;
  if (value === 'DROPOFF') return 2;
  return 3;
}

function mapResourceType(value: string): number {
  return ['LOCATION', 'ROUTE', 'VEHICLE', 'SEAT_LAYOUT', 'TRIP'].indexOf(value) + 1;
}

function normalizeLocationKind(value: unknown): string {
  if (value === 1 || value === 'LOCATION_KIND_CITY') return 'CITY';
  if (value === 2 || value === 'LOCATION_KIND_STATION') return 'STATION';
  return String(value);
}

function normalizeStopKind(value: unknown): string {
  if (value === 1 || value === 'TRIP_STOP_KIND_PICKUP') return 'PICKUP';
  if (value === 2 || value === 'TRIP_STOP_KIND_DROPOFF') return 'DROPOFF';
  if (value === 3 || value === 'TRIP_STOP_KIND_BOTH') return 'BOTH';
  return String(value);
}

function isGrpcInvalidArgument(
  error: unknown,
): error is { code: number; details?: string; message?: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === status.INVALID_ARGUMENT
  );
}

function isGrpcNotFound(error: unknown): error is { code: number; details?: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === status.NOT_FOUND
  );
}

function grpcStatus(error: unknown): number | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? Number((error as { code?: unknown }).code)
    : undefined;
}
