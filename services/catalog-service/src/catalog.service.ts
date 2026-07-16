import { createHash, randomUUID } from 'node:crypto';

import type { SearchCacheStatus, SearchPerformedV2 } from '@bus/contracts-events';
import { currentTraceContext } from '@bus/observability';
import { Inject, Injectable } from '@nestjs/common';

import { CatalogDatabase } from './catalog.database';
import { normalizeLocationQuery } from './location-normalization';
import { LocationRepository, type LocationSuggestionRecord } from './location.repository';
import { SearchAnalyticsPublisher } from './search-analytics.publisher';
import {
  TripRepository,
  TripLifecycleIdempotencyConflictError,
  TripLifecycleTransitionError,
  TripAdminIdempotencyConflictError,
  TripCreationConfigurationError,
  type CreatedTripRecord,
  type AdminCatalogSnapshot,
  type CatalogResourceType,
  type SaveCatalogResourceRecord,
  type TripPreparationOptionsRecord,
  type TripDetailRecord,
  type TripSearchCriteria,
  type TripSort,
  type TripSummaryRecord,
} from './trip.repository';
import { TripSearchCache } from './trip-search-cache';

export interface HealthRequest {
  requestId?: string;
}

export interface HealthResponse {
  service: string;
  status: string;
  version: string;
  requestId: string;
  traceId: string;
  checkedAt: string;
}

export interface SuggestLocationsRequest {
  query?: string;
  limit?: number;
  requestId?: string;
}

export interface SuggestLocationsResponse {
  suggestions: LocationSuggestionRecord[];
  normalizedQuery: string;
  requestId: string;
}

export class LocationSuggestionValidationError extends Error {
  readonly code = 'VALIDATION_ERROR';

  constructor(message: string) {
    super(message);
    this.name = 'LocationSuggestionValidationError';
  }
}

export interface SearchTripsRequest {
  originLocationId?: string;
  destinationLocationId?: string;
  travelDate?: string;
  requestId?: string;
  departureTimeFrom?: string;
  departureTimeTo?: string;
  minPriceVnd?: number;
  maxPriceVnd?: number;
  operatorCodes?: string[];
  vehicleTypeCodes?: string[];
  minimumRemainingSeats?: number;
  sort?: number | string;
  searchSessionId?: string;
}

export interface SearchTripsResponse {
  trips: TripSummaryRecord[];
  timezone: 'Asia/Ho_Chi_Minh';
  requestId: string;
  nearestTravelDates: string[];
}

export class TripSearchValidationError extends Error {
  readonly code = 'VALIDATION_ERROR';

  constructor(message: string) {
    super(message);
    this.name = 'TripSearchValidationError';
  }
}

export interface GetTripRequest {
  tripId?: string;
  requestId?: string;
}

export interface PolicyReference {
  code: 'CANCELLATION' | 'CHECKIN';
  title: string;
  summary: string;
  resourceUri: string;
}

export interface GetTripResponse {
  trip: TripDetailRecord & { policies: PolicyReference[] };
  timezone: 'Asia/Ho_Chi_Minh';
  requestId: string;
}

export class TripDetailValidationError extends Error {
  readonly code = 'VALIDATION_ERROR';

  constructor(message: string) {
    super(message);
    this.name = 'TripDetailValidationError';
  }
}

export class TripNotFoundError extends Error {
  readonly code = 'NOT_FOUND';

  constructor() {
    super('Trip was not found.');
    this.name = 'TripNotFoundError';
  }
}

export class CatalogAuthorizationError extends Error {
  readonly code = 'FORBIDDEN';

  constructor() {
    super('Admin role is required for this operation.');
    this.name = 'CatalogAuthorizationError';
  }
}

export interface SetTripActiveRequest {
  tripId?: string;
  isActive?: boolean;
  requestId?: string;
  actorRole?: string;
  actorId?: string;
  actorTokenId?: string;
}

export interface SetTripActiveResponse {
  tripId: string;
  isActive: boolean;
  changed: boolean;
  requestId: string;
}

export interface TransitionTripStatusRequest {
  tripId?: string;
  targetStatus?: string;
  idempotencyKey?: string;
  requestId?: string;
  actorRole?: string;
  actorId?: string;
  actorTokenId?: string;
}

export interface TransitionTripStatusResponse {
  tripId: string;
  previousStatus: string;
  status: string;
  changed: boolean;
  transitionedAt: string;
  requestId: string;
}

export interface ListTripPreparationOptionsRequest {
  requestId?: string;
  actorRole?: string;
  actorId?: string;
  actorTokenId?: string;
}

export interface ListTripPreparationOptionsResponse extends TripPreparationOptionsRecord {
  requestId: string;
}

export interface CreateTripRequest {
  routeId?: string;
  vehicleId?: string;
  seatLayoutVersionId?: string;
  departureAt?: string;
  arrivalAt?: string;
  priceVnd?: number;
  idempotencyKey?: string;
  requestId?: string;
  actorRole?: string;
  actorId?: string;
  actorTokenId?: string;
}

export interface CreateTripResponse extends CreatedTripRecord {
  requestId: string;
}

type AdminRequest = {
  requestId?: string;
  actorRole?: string;
  actorId?: string;
  actorTokenId?: string;
};
export interface GetAdminCatalogResponse extends AdminCatalogSnapshot {
  requestId: string;
}
export type SaveCatalogResourceResponse = SaveCatalogResourceRecord & { requestId: string };
export interface SaveLocationRequest extends AdminRequest {
  id?: string;
  code?: string;
  name?: string;
  kind?: string;
  parentLocationId?: string;
  idempotencyKey?: string;
}
export interface SaveRouteRequest extends AdminRequest {
  id?: string;
  code?: string;
  originLocationId?: string;
  destinationLocationId?: string;
  durationMinutes?: number;
  stops?: Array<{
    id?: string;
    locationId?: string;
    stopOrder?: number;
    stopKind?: string;
    offsetMinutes?: number;
  }>;
  idempotencyKey?: string;
}
export interface SaveVehicleRequest extends AdminRequest {
  id?: string;
  code?: string;
  plate?: string;
  operatorId?: string;
  vehicleTypeId?: string;
  seatLayoutVersionId?: string;
  idempotencyKey?: string;
}
export interface SaveSeatLayoutRequest extends AdminRequest {
  id?: string;
  vehicleTypeId?: string;
  version?: number;
  name?: string;
  deckCount?: number;
  layoutJson?: string;
  idempotencyKey?: string;
}
export interface UpdateTripRequest extends AdminRequest {
  id?: string;
  routeId?: string;
  vehicleId?: string;
  seatLayoutVersionId?: string;
  departureAt?: string;
  arrivalAt?: string;
  priceVnd?: number;
  idempotencyKey?: string;
}
export interface SetCatalogResourceActiveRequest extends AdminRequest {
  resourceType?: string;
  id?: string;
  isActive?: boolean;
  idempotencyKey?: string;
}

export class TripCreationConfigurationServiceError extends Error {
  readonly code = 'INVALID_CONFIGURATION';

  constructor(message: string) {
    super(message);
    this.name = 'TripCreationConfigurationServiceError';
  }
}

export class TripInvalidStateTransitionError extends Error {
  readonly code = 'INVALID_STATE_TRANSITION';

  constructor(message: string) {
    super(message);
    this.name = 'TripInvalidStateTransitionError';
  }
}

export class CatalogIdempotencyConflictError extends Error {
  readonly code = 'IDEMPOTENCY_CONFLICT';

  constructor(message: string) {
    super(message);
    this.name = 'CatalogIdempotencyConflictError';
  }
}

const TRIP_POLICIES: PolicyReference[] = [
  {
    code: 'CANCELLATION',
    title: 'Chính sách đổi, hủy vé',
    summary:
      'Điều kiện hủy phụ thuộc thời điểm khởi hành và trạng thái vé. Chính sách chính thức được kiểm tra lại khi đặt vé.',
    resourceUri: 'bus://policy/cancellation',
  },
  {
    code: 'CHECKIN',
    title: 'Hướng dẫn check-in',
    summary:
      'Hành khách mang mã vé và giấy tờ phù hợp đến đúng điểm đón theo hướng dẫn trên vé điện tử.',
    resourceUri: 'bus://policy/checkin',
  },
];

@Injectable()
export class CatalogService {
  constructor(
    @Inject(CatalogDatabase) private readonly database: CatalogDatabase,
    @Inject(LocationRepository) private readonly locationRepository: LocationRepository,
    @Inject(TripRepository) private readonly tripRepository: TripRepository,
    @Inject(TripSearchCache) private readonly tripSearchCache: TripSearchCache,
    @Inject(SearchAnalyticsPublisher)
    private readonly searchAnalyticsPublisher: SearchAnalyticsPublisher,
  ) {}

  health(request: HealthRequest, traceId = 'unavailable'): HealthResponse {
    return {
      service: 'catalog-service',
      status: 'UP',
      version: '0.1.0',
      requestId: request.requestId ?? 'missing-request-id',
      traceId,
      checkedAt: new Date().toISOString(),
    };
  }

  async readiness(request: HealthRequest, traceId = 'unavailable'): Promise<HealthResponse> {
    await this.database.ping();
    return this.health(request, traceId);
  }

  async suggestLocations(request: SuggestLocationsRequest): Promise<SuggestLocationsResponse> {
    const normalizedQuery = normalizeLocationQuery(request.query ?? '');
    if (!normalizedQuery || normalizedQuery.length > 100) {
      throw new LocationSuggestionValidationError(
        'Query must contain between 1 and 100 characters.',
      );
    }

    const limit = request.limit ?? 8;
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
      throw new LocationSuggestionValidationError('Limit must be an integer between 1 and 20.');
    }

    return {
      suggestions: await this.locationRepository.suggest(normalizedQuery, limit),
      normalizedQuery,
      requestId: request.requestId ?? 'missing-request-id',
    };
  }

  async getTrip(request: GetTripRequest): Promise<GetTripResponse> {
    const tripId = request.tripId ?? '';
    if (!isUuid(tripId)) {
      throw new TripDetailValidationError('Trip ID must be a valid UUID.');
    }

    const trip = await this.tripRepository.findById(tripId);
    if (!trip) {
      throw new TripNotFoundError();
    }

    return {
      trip: { ...trip, policies: TRIP_POLICIES.map((policy) => ({ ...policy })) },
      timezone: 'Asia/Ho_Chi_Minh',
      requestId: request.requestId ?? 'missing-request-id',
    };
  }

  async setTripActive(request: SetTripActiveRequest): Promise<SetTripActiveResponse> {
    if (
      request.actorRole !== 'ADMIN' ||
      !isUuid(request.actorId ?? '') ||
      !isUuid(request.actorTokenId ?? '')
    ) {
      throw new CatalogAuthorizationError();
    }
    const tripId = request.tripId ?? '';
    if (!isUuid(tripId) || typeof request.isActive !== 'boolean') {
      throw new TripDetailValidationError('Trip ID and active state are required.');
    }

    const result = await this.tripRepository.setActive(tripId, request.isActive);
    if (!result) {
      throw new TripNotFoundError();
    }
    // Repeated commands also invalidate so a retry can heal a prior Redis failure
    // that happened after PostgreSQL already committed the activation change.
    await this.tripSearchCache.invalidate();

    return { ...result, requestId: request.requestId ?? 'missing-request-id' };
  }

  async transitionTripStatus(
    request: TransitionTripStatusRequest,
  ): Promise<TransitionTripStatusResponse> {
    if (
      request.actorRole !== 'ADMIN' ||
      !isUuid(request.actorId ?? '') ||
      !isUuid(request.actorTokenId ?? '')
    ) {
      throw new CatalogAuthorizationError();
    }
    const tripId = request.tripId ?? '';
    const idempotencyKey = request.idempotencyKey?.trim() ?? '';
    if (!isUuid(tripId)) throw new TripDetailValidationError('Trip ID must be a valid UUID.');
    if (request.targetStatus !== 'DEPARTED' && request.targetStatus !== 'COMPLETED') {
      throw new TripDetailValidationError('Target status must be DEPARTED or COMPLETED.');
    }
    if (!/^[A-Za-z0-9._-]{16,128}$/.test(idempotencyKey)) {
      throw new TripDetailValidationError('Idempotency key format is invalid.');
    }

    try {
      const result = await this.tripRepository.transitionStatus({
        tripId,
        targetStatus: request.targetStatus,
        idempotencyKey,
        actorId: request.actorId!,
        requestId: request.requestId ?? 'missing-request-id',
        traceId: currentTraceContext().traceId ?? 'unavailable',
      });
      if (!result) throw new TripNotFoundError();
      if (result.changed) await this.tripSearchCache.invalidate();
      return { ...result, requestId: request.requestId ?? 'missing-request-id' };
    } catch (error) {
      if (error instanceof TripLifecycleTransitionError) {
        throw new TripInvalidStateTransitionError(error.message);
      }
      if (error instanceof TripLifecycleIdempotencyConflictError) {
        throw new CatalogIdempotencyConflictError(error.message);
      }
      throw error;
    }
  }

  async listTripPreparationOptions(
    request: ListTripPreparationOptionsRequest,
  ): Promise<ListTripPreparationOptionsResponse> {
    requireAdminActor(request);
    return {
      ...(await this.tripRepository.listPreparationOptions()),
      requestId: request.requestId ?? 'missing-request-id',
    };
  }

  async createTrip(request: CreateTripRequest): Promise<CreateTripResponse> {
    requireAdminActor(request);
    const routeId = request.routeId ?? '';
    const vehicleId = request.vehicleId ?? '';
    const seatLayoutVersionId = request.seatLayoutVersionId ?? '';
    if (![routeId, vehicleId, seatLayoutVersionId].every(isUuid)) {
      throw new TripDetailValidationError('Route, vehicle, and seat-layout IDs must be UUIDs.');
    }
    const departureAt = parseUtcInstant(request.departureAt, 'Departure time');
    const arrivalAt = parseUtcInstant(request.arrivalAt, 'Arrival time');
    if (arrivalAt <= departureAt) {
      throw new TripDetailValidationError('Arrival time must be after departure time.');
    }
    const priceVnd = request.priceVnd;
    if (
      !Number.isSafeInteger(priceVnd) ||
      (priceVnd ?? 0) <= 0 ||
      (priceVnd ?? 0) > 2_000_000_000
    ) {
      throw new TripDetailValidationError('Fare must be a positive integer VND amount.');
    }
    const idempotencyKey = request.idempotencyKey?.trim() ?? '';
    if (!/^[A-Za-z0-9._-]{16,128}$/.test(idempotencyKey)) {
      throw new TripDetailValidationError('Idempotency key format is invalid.');
    }
    const requestFingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          routeId,
          vehicleId,
          seatLayoutVersionId,
          departureAt: departureAt.toISOString(),
          arrivalAt: arrivalAt.toISOString(),
          priceVnd,
        }),
      )
      .digest('hex');
    try {
      const result = await this.tripRepository.createTrip({
        routeId,
        vehicleId,
        seatLayoutVersionId,
        departureAt,
        arrivalAt,
        priceVnd: priceVnd!,
        actorId: request.actorId!,
        idempotencyKey,
        requestFingerprint,
        requestId: request.requestId ?? 'missing-request-id',
        traceId: currentTraceContext().traceId ?? 'unavailable',
      });
      await this.tripSearchCache.invalidate();
      return { ...result, requestId: request.requestId ?? 'missing-request-id' };
    } catch (error) {
      if (error instanceof TripAdminIdempotencyConflictError) {
        throw new CatalogIdempotencyConflictError(error.message);
      }
      if (error instanceof TripCreationConfigurationError) {
        throw new TripCreationConfigurationServiceError(error.message);
      }
      throw error;
    }
  }

  async getAdminCatalog(request: AdminRequest): Promise<GetAdminCatalogResponse> {
    requireAdminActor(request);
    return {
      ...(await this.tripRepository.getAdminCatalog()),
      requestId: request.requestId ?? 'missing-request-id',
    };
  }

  async saveLocation(request: SaveLocationRequest): Promise<SaveCatalogResourceResponse> {
    requireAdminActor(request);
    const id = optionalUuid(request.id, 'Location ID');
    const code = catalogCode(request.code, 'Location code');
    const name = catalogName(request.name, 'Location name');
    const kind = request.kind === 'CITY' || request.kind === 'STATION' ? request.kind : undefined;
    if (!kind) throw new TripDetailValidationError('Location kind must be CITY or STATION.');
    const parentLocationId = request.parentLocationId
      ? optionalUuid(request.parentLocationId, 'Parent location ID')
      : undefined;
    if (kind === 'STATION' && !parentLocationId)
      throw new TripDetailValidationError('A station requires a parent city.');
    return this.saveAdminResource('LOCATION', id, request, {
      code,
      name,
      normalizedName: normalizeLocationQuery(name),
      kind,
      parentLocationId,
    });
  }

  async saveRoute(request: SaveRouteRequest): Promise<SaveCatalogResourceResponse> {
    requireAdminActor(request);
    const id = optionalUuid(request.id, 'Route ID');
    const originLocationId = requiredUuid(request.originLocationId, 'Origin location ID');
    const destinationLocationId = requiredUuid(
      request.destinationLocationId,
      'Destination location ID',
    );
    if (originLocationId === destinationLocationId)
      throw new TripDetailValidationError('Route endpoints must differ.');
    const durationMinutes = positiveInteger(request.durationMinutes, 'Duration minutes', 10_000);
    const stops = (request.stops ?? []).map((stop, index) => ({
      ...(stop.id && { id: requiredUuid(stop.id, 'Route stop ID') }),
      locationId: requiredUuid(stop.locationId, 'Route stop location ID'),
      stopOrder: positiveInteger(stop.stopOrder, 'Stop order', 100),
      stopKind: validateStopKind(stop.stopKind),
      offsetMinutes: nonNegativeInteger(stop.offsetMinutes, 'Stop offset minutes', durationMinutes),
      index,
    }));
    if (stops.length < 2 || new Set(stops.map((stop) => stop.stopOrder)).size !== stops.length)
      throw new TripDetailValidationError('A route requires at least two uniquely ordered stops.');
    return this.saveAdminResource('ROUTE', id, request, {
      code: catalogCode(request.code, 'Route code'),
      originLocationId,
      destinationLocationId,
      durationMinutes,
      stops,
    });
  }

  async saveVehicle(request: SaveVehicleRequest): Promise<SaveCatalogResourceResponse> {
    requireAdminActor(request);
    return this.saveAdminResource('VEHICLE', optionalUuid(request.id, 'Vehicle ID'), request, {
      code: catalogCode(request.code, 'Vehicle code'),
      plate: catalogName(request.plate, 'Vehicle plate'),
      operatorId: requiredUuid(request.operatorId, 'Operator ID'),
      vehicleTypeId: requiredUuid(request.vehicleTypeId, 'Vehicle type ID'),
      seatLayoutVersionId: requiredUuid(request.seatLayoutVersionId, 'Seat layout ID'),
    });
  }

  async saveSeatLayout(request: SaveSeatLayoutRequest): Promise<SaveCatalogResourceResponse> {
    requireAdminActor(request);
    const id = optionalUuid(request.id, 'Seat layout ID');
    if (id)
      throw new TripCreationConfigurationServiceError(
        'Seat-layout versions are immutable; create a new version.',
      );
    const layoutJson = request.layoutJson?.trim() ?? '';
    try {
      const layout = JSON.parse(layoutJson) as { seats?: unknown[] };
      if (!layout || !Array.isArray(layout.seats) || layout.seats.length < 1) throw new Error();
    } catch {
      throw new TripDetailValidationError('Layout JSON must contain a non-empty seats array.');
    }
    return this.saveAdminResource('SEAT_LAYOUT', id, request, {
      vehicleTypeId: requiredUuid(request.vehicleTypeId, 'Vehicle type ID'),
      version: positiveInteger(request.version, 'Layout version', 10_000),
      name: catalogName(request.name, 'Layout name'),
      deckCount: positiveInteger(request.deckCount, 'Deck count', 4),
      layoutJson,
    });
  }

  async updateTrip(request: UpdateTripRequest): Promise<SaveCatalogResourceResponse> {
    requireAdminActor(request);
    const departureAt = parseUtcInstant(request.departureAt, 'Departure time');
    const arrivalAt = parseUtcInstant(request.arrivalAt, 'Arrival time');
    if (arrivalAt <= departureAt)
      throw new TripDetailValidationError('Arrival time must be after departure time.');
    return this.saveAdminResource('TRIP', requiredUuid(request.id, 'Trip ID'), request, {
      routeId: requiredUuid(request.routeId, 'Route ID'),
      vehicleId: requiredUuid(request.vehicleId, 'Vehicle ID'),
      seatLayoutVersionId: requiredUuid(request.seatLayoutVersionId, 'Seat layout ID'),
      departureAt,
      arrivalAt,
      priceVnd: positiveInteger(request.priceVnd, 'Fare VND', 2_000_000_000),
    });
  }

  async setCatalogResourceActive(
    request: SetCatalogResourceActiveRequest,
  ): Promise<SaveCatalogResourceResponse> {
    requireAdminActor(request);
    const resourceType = validateResourceType(request.resourceType);
    if (typeof request.isActive !== 'boolean')
      throw new TripDetailValidationError('Active state is required.');
    const command = adminCommand(resourceType, requiredUuid(request.id, 'Resource ID'), request, {
      isActive: request.isActive,
    });
    try {
      const result = await this.tripRepository.setCatalogResourceActive({
        ...command,
        isActive: request.isActive,
      });
      if (!result) throw new TripNotFoundError();
      await this.tripSearchCache.invalidate();
      return { ...result, requestId: request.requestId ?? 'missing-request-id' };
    } catch (error) {
      return this.mapAdminError(error);
    }
  }

  private async saveAdminResource(
    resourceType: CatalogResourceType,
    id: string | undefined,
    request: AdminRequest & { idempotencyKey?: string },
    values: Record<string, unknown>,
  ): Promise<SaveCatalogResourceResponse> {
    try {
      const result = await this.tripRepository.saveCatalogResource(
        adminCommand(resourceType, id, request, values),
      );
      await this.tripSearchCache.invalidate();
      return { ...result, requestId: request.requestId ?? 'missing-request-id' };
    } catch (error) {
      return this.mapAdminError(error);
    }
  }

  private mapAdminError(error: unknown): never {
    if (error instanceof TripAdminIdempotencyConflictError)
      throw new CatalogIdempotencyConflictError(error.message);
    if (error instanceof TripCreationConfigurationError)
      throw new TripCreationConfigurationServiceError(error.message);
    throw error;
  }

  async searchTrips(request: SearchTripsRequest): Promise<SearchTripsResponse> {
    const originLocationId = request.originLocationId ?? '';
    const destinationLocationId = request.destinationLocationId ?? '';
    const travelDate = request.travelDate ?? '';
    if (!isUuid(originLocationId) || !isUuid(destinationLocationId)) {
      throw new TripSearchValidationError('Origin and destination must be valid location IDs.');
    }
    if (!isLocalDate(travelDate)) {
      throw new TripSearchValidationError('Travel date must use the YYYY-MM-DD format.');
    }
    const searchSessionId = request.searchSessionId ?? randomUUID();
    if (!isUuid(searchSessionId)) {
      throw new TripSearchValidationError('Search session ID must be a valid UUID.');
    }

    const endpoints = await this.tripRepository.resolveEndpoints(
      originLocationId,
      destinationLocationId,
    );
    if (!endpoints) {
      throw new TripSearchValidationError('Origin or destination location was not found.');
    }
    if (endpoints.originCityId === endpoints.destinationCityId) {
      throw new TripSearchValidationError('Origin and destination must be different cities.');
    }

    const criteria = createTripSearchCriteria(request, travelDate);
    const cached = await this.tripSearchCache.get(endpoints, criteria);
    let trips: TripSummaryRecord[];
    let nearestTravelDates: string[];
    let cacheStatus: SearchCacheStatus;
    if (cached.status === 'HIT') {
      trips = cached.value.trips;
      nearestTravelDates = cached.value.nearestTravelDates;
      cacheStatus = 'HIT';
    } else {
      trips = await this.tripRepository.search(endpoints, criteria);
      nearestTravelDates =
        trips.length === 0 ? await this.tripRepository.findNearestDates(endpoints, criteria) : [];
      cacheStatus = cached.status;
      if (cached.status === 'MISS') {
        await this.tripSearchCache.set(
          endpoints,
          criteria,
          { trips, nearestTravelDates },
          cached.generation,
        );
      }
    }

    this.searchAnalyticsPublisher.publish(
      createSearchPerformedEvent({
        endpoints,
        criteria,
        trips,
        nearestTravelDates,
        cacheStatus,
        searchSessionId,
      }),
    );

    return {
      trips,
      timezone: 'Asia/Ho_Chi_Minh',
      requestId: request.requestId ?? 'missing-request-id',
      nearestTravelDates,
    };
  }
}

interface SearchEventInput {
  endpoints: { originCityId: string; destinationCityId: string };
  criteria: TripSearchCriteria;
  trips: TripSummaryRecord[];
  nearestTravelDates: string[];
  cacheStatus: SearchCacheStatus;
  searchSessionId: string;
}

function createSearchPerformedEvent(input: SearchEventInput): SearchPerformedV2 {
  const matchedRoutes = [
    ...new Map(
      input.trips.map((trip) => [
        trip.routeId,
        {
          routeId: trip.routeId,
          originName: trip.originName,
          destinationName: trip.destinationName,
        },
      ]),
    ).values(),
  ];
  return {
    eventId: randomUUID(),
    eventType: 'SearchPerformedV2',
    eventVersion: 2,
    occurredAt: new Date().toISOString(),
    traceId: currentTraceContext().traceId ?? 'unavailable',
    producer: 'catalog-service',
    searchSessionId: input.searchSessionId,
    actorCategory: 'GUEST',
    payload: {
      originLocationId: input.endpoints.originCityId,
      destinationLocationId: input.endpoints.destinationCityId,
      travelDate: input.criteria.travelDate,
      ...(input.criteria.departureTimeFrom
        ? { departureTimeFrom: input.criteria.departureTimeFrom }
        : {}),
      ...(input.criteria.departureTimeTo
        ? { departureTimeTo: input.criteria.departureTimeTo }
        : {}),
      ...(input.criteria.minPriceVnd !== undefined
        ? { minPriceVnd: input.criteria.minPriceVnd }
        : {}),
      ...(input.criteria.maxPriceVnd !== undefined
        ? { maxPriceVnd: input.criteria.maxPriceVnd }
        : {}),
      operatorCodes: input.criteria.operatorCodes,
      vehicleTypeCodes: input.criteria.vehicleTypeCodes,
      ...(input.criteria.minimumRemainingSeats !== undefined
        ? { minimumRemainingSeats: input.criteria.minimumRemainingSeats }
        : {}),
      sort: input.criteria.sort,
      resultCount: input.trips.length,
      nearestDateCount: input.nearestTravelDates.length,
      cacheStatus: input.cacheStatus,
      matchedRoutes,
    },
  };
}

function createTripSearchCriteria(
  request: SearchTripsRequest,
  travelDate: string,
): TripSearchCriteria {
  const departureTimeFrom = optionalTime(request.departureTimeFrom, 'Departure time from');
  const departureTimeTo = optionalTime(request.departureTimeTo, 'Departure time to');
  if (departureTimeFrom && departureTimeTo && departureTimeFrom > departureTimeTo) {
    throw new TripSearchValidationError('Departure time from must not be after time to.');
  }
  const minPriceVnd = optionalInteger(request.minPriceVnd, 'Minimum price', 0, 2_000_000_000);
  const maxPriceVnd = optionalInteger(request.maxPriceVnd, 'Maximum price', 0, 2_000_000_000);
  if (minPriceVnd !== undefined && maxPriceVnd !== undefined && minPriceVnd > maxPriceVnd) {
    throw new TripSearchValidationError('Minimum price must not exceed maximum price.');
  }

  return {
    travelDate,
    ...(departureTimeFrom ? { departureTimeFrom } : {}),
    ...(departureTimeTo ? { departureTimeTo } : {}),
    ...(minPriceVnd !== undefined ? { minPriceVnd } : {}),
    ...(maxPriceVnd !== undefined ? { maxPriceVnd } : {}),
    operatorCodes: normalizeCodes(request.operatorCodes, 'operator'),
    vehicleTypeCodes: normalizeCodes(request.vehicleTypeCodes, 'vehicle type'),
    ...(request.minimumRemainingSeats !== undefined
      ? {
          minimumRemainingSeats: optionalInteger(
            request.minimumRemainingSeats,
            'Minimum remaining seats',
            1,
            100,
          ),
        }
      : {}),
    sort: normalizeTripSort(request.sort),
  };
}

function optionalTime(value: string | undefined, field: string): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new TripSearchValidationError(`${field} must use the HH:MM format.`);
  }
  return value;
}

function optionalInteger(
  value: number | undefined,
  field: string,
  minimum: number,
  maximum: number,
): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new TripSearchValidationError(
      `${field} must be an integer between ${minimum} and ${maximum}.`,
    );
  }
  return value;
}

function normalizeCodes(values: string[] | undefined, field: string): string[] {
  const uniqueValues = [...new Set(values ?? [])].sort();
  if (uniqueValues.length > 20 || uniqueValues.some((value) => !/^[A-Z0-9-]{1,32}$/.test(value))) {
    throw new TripSearchValidationError(`Each ${field} code must use 1-32 uppercase characters.`);
  }
  return uniqueValues;
}

function normalizeTripSort(value: number | string | undefined): TripSort {
  if (
    value === undefined ||
    value === 0 ||
    value === 1 ||
    value === 'TRIP_SORT_UNSPECIFIED' ||
    value === 'TRIP_SORT_DEPARTURE_EARLIEST' ||
    value === 'DEPARTURE_EARLIEST'
  ) {
    return 'DEPARTURE_EARLIEST';
  }
  if (value === 2 || value === 'TRIP_SORT_PRICE_LOWEST' || value === 'PRICE_LOWEST') {
    return 'PRICE_LOWEST';
  }
  if (value === 3 || value === 'TRIP_SORT_DURATION_SHORTEST' || value === 'DURATION_SHORTEST') {
    return 'DURATION_SHORTEST';
  }
  throw new TripSearchValidationError('Trip sort value is invalid.');
}

function requireAdminActor(request: {
  actorRole?: string;
  actorId?: string;
  actorTokenId?: string;
}): void {
  if (
    request.actorRole !== 'ADMIN' ||
    !isUuid(request.actorId ?? '') ||
    !isUuid(request.actorTokenId ?? '')
  ) {
    throw new CatalogAuthorizationError();
  }
}

function parseUtcInstant(value: string | undefined, field: string): Date {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    throw new TripDetailValidationError(`${field} must be an ISO-8601 UTC timestamp.`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new TripDetailValidationError(`${field} must be a valid UTC timestamp.`);
  }
  return parsed;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function requiredUuid(value: string | undefined, field: string): string {
  const normalized = value?.trim() ?? '';
  if (!isUuid(normalized)) throw new TripDetailValidationError(`${field} must be a UUID.`);
  return normalized;
}

function optionalUuid(value: string | undefined, field: string): string | undefined {
  return value === undefined || value.trim() === '' ? undefined : requiredUuid(value, field);
}

function catalogCode(value: string | undefined, field: string): string {
  const normalized = value?.trim().toUpperCase() ?? '';
  if (!/^[A-Z0-9._-]{2,40}$/.test(normalized))
    throw new TripDetailValidationError(`${field} format is invalid.`);
  return normalized;
}

function catalogName(value: string | undefined, field: string): string {
  const normalized = value?.trim().replace(/\s+/g, ' ') ?? '';
  if (normalized.length < 2 || normalized.length > 120)
    throw new TripDetailValidationError(`${field} must contain 2-120 characters.`);
  return normalized;
}

function positiveInteger(value: number | undefined, field: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value ?? 0) < 1 || (value ?? 0) > maximum)
    throw new TripDetailValidationError(`${field} must be a positive integer.`);
  return value!;
}

function nonNegativeInteger(value: number | undefined, field: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value ?? -1) < 0 || (value ?? 0) > maximum)
    throw new TripDetailValidationError(`${field} must be a non-negative integer.`);
  return value!;
}

function validateStopKind(value: string | undefined): 'PICKUP' | 'DROPOFF' | 'BOTH' {
  if (value === 'PICKUP' || value === 'DROPOFF' || value === 'BOTH') return value;
  throw new TripDetailValidationError('Route stop kind is invalid.');
}

function validateResourceType(value: string | undefined): CatalogResourceType {
  if (
    value === 'LOCATION' ||
    value === 'ROUTE' ||
    value === 'VEHICLE' ||
    value === 'SEAT_LAYOUT' ||
    value === 'TRIP'
  )
    return value;
  throw new TripDetailValidationError('Catalog resource type is invalid.');
}

function adminCommand(
  resourceType: CatalogResourceType,
  id: string | undefined,
  request: AdminRequest & { idempotencyKey?: string },
  values: Record<string, unknown>,
) {
  const idempotencyKey = request.idempotencyKey?.trim() ?? '';
  if (!/^[A-Za-z0-9._-]{16,128}$/.test(idempotencyKey))
    throw new TripDetailValidationError('Idempotency key format is invalid.');
  return {
    resourceType,
    ...(id && { id }),
    values,
    actorId: request.actorId!,
    idempotencyKey,
    requestFingerprint: createHash('sha256')
      .update(JSON.stringify({ resourceType, id, values }))
      .digest('hex'),
    requestId: request.requestId ?? 'missing-request-id',
    traceId: currentTraceContext().traceId ?? 'unavailable',
  };
}

function isLocalDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}
