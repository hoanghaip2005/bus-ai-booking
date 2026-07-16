import {
  currentTraceContext,
  createRequestId,
  logEvent,
  withRequestContext,
} from '@bus/observability';
import type { Metadata } from '@grpc/grpc-js';
import { status } from '@grpc/grpc-js';
import { Controller, Get, Inject, Req, ServiceUnavailableException } from '@nestjs/common';
import { GrpcMethod, RpcException } from '@nestjs/microservices';

import type {
  HealthRequest,
  HealthResponse,
  GetTripRequest,
  GetTripResponse,
  SetTripActiveRequest,
  SetTripActiveResponse,
  TransitionTripStatusRequest,
  TransitionTripStatusResponse,
  ListTripPreparationOptionsRequest,
  ListTripPreparationOptionsResponse,
  CreateTripRequest,
  CreateTripResponse,
  GetAdminCatalogResponse,
  SaveLocationRequest,
  SaveRouteRequest,
  SaveVehicleRequest,
  SaveSeatLayoutRequest,
  UpdateTripRequest,
  SetCatalogResourceActiveRequest,
  SaveCatalogResourceResponse,
  SearchTripsRequest,
  SearchTripsResponse,
  SuggestLocationsRequest,
  SuggestLocationsResponse,
} from './catalog.service';
import {
  CatalogService,
  CatalogAuthorizationError,
  CatalogIdempotencyConflictError,
  LocationSuggestionValidationError,
  TripDetailValidationError,
  TripNotFoundError,
  TripInvalidStateTransitionError,
  TripCreationConfigurationServiceError,
  TripSearchValidationError,
} from './catalog.service';
import type { LocationSuggestionRecord } from './location.repository';
import type { RequestWithContext } from './request-context.middleware';

interface GrpcSuggestLocationsResponse extends Omit<SuggestLocationsResponse, 'suggestions'> {
  suggestions: Array<Omit<LocationSuggestionRecord, 'kind'> & { kind: 1 | 2 }>;
}

interface GrpcGetTripResponse extends Omit<GetTripResponse, 'trip'> {
  trip: Omit<GetTripResponse['trip'], 'stops'> & {
    stops: Array<Omit<GetTripResponse['trip']['stops'][number], 'kind'> & { kind: 1 | 2 | 3 }>;
  };
}

@Controller()
export class CatalogController {
  constructor(@Inject(CatalogService) private readonly catalogService: CatalogService) {}

  @Get('health')
  httpHealth(@Req() request: RequestWithContext): HealthResponse {
    return this.httpLiveness(request);
  }

  @Get('health/live')
  httpLiveness(@Req() request: RequestWithContext): HealthResponse {
    return this.catalogService.health(
      { requestId: request.requestId },
      currentTraceContext().traceId ?? 'unavailable',
    );
  }

  @Get('health/ready')
  async httpReadiness(@Req() request: RequestWithContext): Promise<HealthResponse> {
    try {
      return await this.catalogService.readiness(
        { requestId: request.requestId },
        currentTraceContext().traceId ?? 'unavailable',
      );
    } catch {
      logEvent({
        service: 'catalog-service',
        level: 'error',
        event: 'catalog.readiness.failed',
        message: 'Catalog PostgreSQL readiness check failed.',
        requestId: request.requestId,
        fields: { dependency: 'postgresql' },
      });
      throw new ServiceUnavailableException({
        code: 'DEPENDENCY_UNAVAILABLE',
        message: 'Catalog PostgreSQL is unavailable.',
      });
    }
  }

  @GrpcMethod('CatalogQueryService', 'Health')
  async grpcHealth(request: HealthRequest, metadata: Metadata): Promise<HealthResponse> {
    const metadataRequestId = metadata.get('x-request-id')[0];
    const requestId = createRequestId(
      typeof metadataRequestId === 'string' ? metadataRequestId : request.requestId,
    );

    return withRequestContext(requestId, async () => {
      const traceId = currentTraceContext().traceId ?? 'unavailable';
      try {
        const response = await this.catalogService.readiness({ requestId }, traceId);
        logEvent({
          service: 'catalog-service',
          event: 'grpc.catalog.health',
          message: 'Catalog readiness request handled.',
          requestId,
          fields: { rpc: 'CatalogQueryService.Health', dependency: 'postgresql' },
        });
        return response;
      } catch {
        logEvent({
          service: 'catalog-service',
          level: 'error',
          event: 'grpc.catalog.health.failed',
          message: 'Catalog PostgreSQL readiness check failed.',
          requestId,
          fields: { rpc: 'CatalogQueryService.Health', dependency: 'postgresql' },
        });
        throw new RpcException({
          code: status.UNAVAILABLE,
          message: 'Catalog database unavailable.',
        });
      }
    });
  }

  @GrpcMethod('CatalogQueryService', 'SuggestLocations')
  async grpcSuggestLocations(
    request: SuggestLocationsRequest,
    metadata: Metadata,
  ): Promise<GrpcSuggestLocationsResponse> {
    const metadataRequestId = metadata.get('x-request-id')[0];
    const requestId = createRequestId(
      typeof metadataRequestId === 'string' ? metadataRequestId : request.requestId,
    );

    return withRequestContext(requestId, async () => {
      const startedAt = performance.now();
      try {
        const response = await this.catalogService.suggestLocations({ ...request, requestId });
        logEvent({
          service: 'catalog-service',
          event: 'grpc.catalog.suggest-locations',
          message: 'Location suggestions returned.',
          requestId,
          fields: {
            rpc: 'CatalogQueryService.SuggestLocations',
            resultCount: response.suggestions.length,
            durationMs: Math.round(performance.now() - startedAt),
          },
        });
        return {
          ...response,
          suggestions: response.suggestions.map((suggestion) => ({
            ...suggestion,
            kind: suggestion.kind === 'CITY' ? 1 : 2,
          })),
        };
      } catch (error) {
        if (error instanceof LocationSuggestionValidationError) {
          throw new RpcException({ code: status.INVALID_ARGUMENT, message: error.message });
        }

        logEvent({
          service: 'catalog-service',
          level: 'error',
          event: 'grpc.catalog.suggest-locations.failed',
          message: 'Location suggestion query failed.',
          requestId,
          fields: {
            rpc: 'CatalogQueryService.SuggestLocations',
            dependency: 'postgresql',
            durationMs: Math.round(performance.now() - startedAt),
          },
        });
        throw new RpcException({
          code: status.UNAVAILABLE,
          message: 'Catalog database unavailable.',
        });
      }
    });
  }

  @GrpcMethod('CatalogQueryService', 'SearchTrips')
  async grpcSearchTrips(
    request: SearchTripsRequest,
    metadata: Metadata,
  ): Promise<SearchTripsResponse> {
    const metadataRequestId = metadata.get('x-request-id')[0];
    const requestId = createRequestId(
      typeof metadataRequestId === 'string' ? metadataRequestId : request.requestId,
    );

    return withRequestContext(requestId, async () => {
      const startedAt = performance.now();
      try {
        const response = await this.catalogService.searchTrips({ ...request, requestId });
        logEvent({
          service: 'catalog-service',
          event: 'grpc.catalog.search-trips',
          message: 'Trip search completed.',
          requestId,
          fields: {
            rpc: 'CatalogQueryService.SearchTrips',
            resultCount: response.trips.length,
            travelDate: request.travelDate,
            durationMs: Math.round(performance.now() - startedAt),
          },
        });
        return response;
      } catch (error) {
        if (error instanceof TripSearchValidationError) {
          throw new RpcException({ code: status.INVALID_ARGUMENT, message: error.message });
        }

        logEvent({
          service: 'catalog-service',
          level: 'error',
          event: 'grpc.catalog.search-trips.failed',
          message: 'Trip search failed.',
          requestId,
          fields: {
            rpc: 'CatalogQueryService.SearchTrips',
            dependency: 'postgresql',
            durationMs: Math.round(performance.now() - startedAt),
          },
        });
        throw new RpcException({
          code: status.UNAVAILABLE,
          message: 'Catalog database unavailable.',
        });
      }
    });
  }

  @GrpcMethod('CatalogQueryService', 'GetTrip')
  async grpcGetTrip(request: GetTripRequest, metadata: Metadata): Promise<GrpcGetTripResponse> {
    const metadataRequestId = metadata.get('x-request-id')[0];
    const requestId = createRequestId(
      typeof metadataRequestId === 'string' ? metadataRequestId : request.requestId,
    );

    return withRequestContext(requestId, async () => {
      const startedAt = performance.now();
      try {
        const response = await this.catalogService.getTrip({ ...request, requestId });
        logEvent({
          service: 'catalog-service',
          event: 'grpc.catalog.get-trip',
          message: 'Trip detail returned.',
          requestId,
          fields: {
            rpc: 'CatalogQueryService.GetTrip',
            tripId: request.tripId,
            durationMs: Math.round(performance.now() - startedAt),
          },
        });
        return {
          ...response,
          trip: {
            ...response.trip,
            stops: response.trip.stops.map((stop) => ({
              ...stop,
              kind: mapTripStopKind(stop.kind),
            })),
          },
        };
      } catch (error) {
        if (error instanceof TripDetailValidationError) {
          throw new RpcException({ code: status.INVALID_ARGUMENT, message: error.message });
        }
        if (error instanceof TripNotFoundError) {
          throw new RpcException({ code: status.NOT_FOUND, message: error.message });
        }

        logEvent({
          service: 'catalog-service',
          level: 'error',
          event: 'grpc.catalog.get-trip.failed',
          message: 'Trip detail query failed.',
          requestId,
          fields: {
            rpc: 'CatalogQueryService.GetTrip',
            dependency: 'postgresql',
            durationMs: Math.round(performance.now() - startedAt),
          },
        });
        throw new RpcException({
          code: status.UNAVAILABLE,
          message: 'Catalog database unavailable.',
        });
      }
    });
  }

  @GrpcMethod('CatalogAdminService', 'SetTripActive')
  async grpcSetTripActive(
    request: SetTripActiveRequest,
    metadata: Metadata,
  ): Promise<SetTripActiveResponse> {
    const metadataRequestId = metadata.get('x-request-id')[0];
    const metadataActorRole = metadata.get('x-actor-role')[0];
    const metadataActorId = metadata.get('x-actor-id')[0];
    const metadataActorTokenId = metadata.get('x-actor-token-id')[0];
    const requestId = createRequestId(
      typeof metadataRequestId === 'string' ? metadataRequestId : request.requestId,
    );

    return withRequestContext(requestId, async () => {
      const startedAt = performance.now();
      try {
        const response = await this.catalogService.setTripActive({
          ...request,
          requestId,
          actorRole: typeof metadataActorRole === 'string' ? metadataActorRole : undefined,
          actorId: typeof metadataActorId === 'string' ? metadataActorId : undefined,
          actorTokenId: typeof metadataActorTokenId === 'string' ? metadataActorTokenId : undefined,
        });
        logEvent({
          service: 'catalog-service',
          event: 'grpc.catalog.set-trip-active',
          message: 'Trip activation state updated.',
          requestId,
          fields: {
            rpc: 'CatalogAdminService.SetTripActive',
            tripId: response.tripId,
            isActive: response.isActive,
            changed: response.changed,
            durationMs: Math.round(performance.now() - startedAt),
          },
        });
        return response;
      } catch (error) {
        if (error instanceof CatalogAuthorizationError) {
          throw new RpcException({ code: status.PERMISSION_DENIED, message: error.message });
        }
        if (error instanceof TripDetailValidationError) {
          throw new RpcException({ code: status.INVALID_ARGUMENT, message: error.message });
        }
        if (error instanceof TripNotFoundError) {
          throw new RpcException({ code: status.NOT_FOUND, message: error.message });
        }

        logEvent({
          service: 'catalog-service',
          level: 'error',
          event: 'grpc.catalog.set-trip-active.failed',
          message: 'Trip activation update failed.',
          requestId,
          fields: {
            rpc: 'CatalogAdminService.SetTripActive',
            dependency: 'postgresql-or-redis',
            durationMs: Math.round(performance.now() - startedAt),
          },
        });
        throw new RpcException({
          code: status.UNAVAILABLE,
          message: 'Catalog dependency unavailable.',
        });
      }
    });
  }

  @GrpcMethod('CatalogAdminService', 'TransitionTripStatus')
  async grpcTransitionTripStatus(
    request: TransitionTripStatusRequest,
    metadata: Metadata,
  ): Promise<TransitionTripStatusResponse> {
    const requestId = createRequestId(
      typeof metadata.get('x-request-id')[0] === 'string'
        ? (metadata.get('x-request-id')[0] as string)
        : request.requestId,
    );
    return withRequestContext(requestId, async () => {
      const startedAt = performance.now();
      try {
        const response = await this.catalogService.transitionTripStatus({
          ...request,
          requestId,
          actorRole: metadataValue(metadata, 'x-actor-role'),
          actorId: metadataValue(metadata, 'x-actor-id'),
          actorTokenId: metadataValue(metadata, 'x-actor-token-id'),
        });
        logEvent({
          service: 'catalog-service',
          event: 'grpc.catalog.transition-trip-status',
          message: 'Trip lifecycle status processed.',
          requestId,
          fields: {
            rpc: 'CatalogAdminService.TransitionTripStatus',
            tripId: response.tripId,
            previousStatus: response.previousStatus,
            status: response.status,
            changed: response.changed,
            durationMs: Math.round(performance.now() - startedAt),
          },
        });
        return response;
      } catch (error) {
        if (error instanceof CatalogAuthorizationError) {
          throw new RpcException({ code: status.PERMISSION_DENIED, message: error.message });
        }
        if (error instanceof TripDetailValidationError) {
          throw new RpcException({ code: status.INVALID_ARGUMENT, message: error.message });
        }
        if (error instanceof TripNotFoundError) {
          throw new RpcException({ code: status.NOT_FOUND, message: error.message });
        }
        if (error instanceof TripInvalidStateTransitionError) {
          throw new RpcException({ code: status.FAILED_PRECONDITION, message: error.message });
        }
        if (error instanceof CatalogIdempotencyConflictError) {
          throw new RpcException({ code: status.ALREADY_EXISTS, message: error.message });
        }
        logEvent({
          service: 'catalog-service',
          level: 'error',
          event: 'grpc.catalog.transition-trip-status.failed',
          message: 'Trip lifecycle transition failed.',
          requestId,
          fields: {
            rpc: 'CatalogAdminService.TransitionTripStatus',
            dependency: 'postgresql-or-redis',
            durationMs: Math.round(performance.now() - startedAt),
          },
        });
        throw new RpcException({
          code: status.UNAVAILABLE,
          message: 'Catalog dependency unavailable.',
        });
      }
    });
  }

  @GrpcMethod('CatalogAdminService', 'ListTripPreparationOptions')
  async grpcListTripPreparationOptions(
    request: ListTripPreparationOptionsRequest,
    metadata: Metadata,
  ): Promise<ListTripPreparationOptionsResponse> {
    const requestId = createRequestId(metadataValue(metadata, 'x-request-id') ?? request.requestId);
    return withRequestContext(requestId, async () => {
      try {
        return await this.catalogService.listTripPreparationOptions({
          ...request,
          requestId,
          actorRole: metadataValue(metadata, 'x-actor-role'),
          actorId: metadataValue(metadata, 'x-actor-id'),
          actorTokenId: metadataValue(metadata, 'x-actor-token-id'),
        });
      } catch (error) {
        if (error instanceof CatalogAuthorizationError) {
          throw new RpcException({ code: status.PERMISSION_DENIED, message: error.message });
        }
        throw new RpcException({
          code: status.UNAVAILABLE,
          message: 'Catalog dependency unavailable.',
        });
      }
    });
  }

  @GrpcMethod('CatalogAdminService', 'CreateTrip')
  async grpcCreateTrip(
    request: CreateTripRequest,
    metadata: Metadata,
  ): Promise<CreateTripResponse> {
    const requestId = createRequestId(metadataValue(metadata, 'x-request-id') ?? request.requestId);
    return withRequestContext(requestId, async () => {
      const startedAt = performance.now();
      try {
        const response = await this.catalogService.createTrip({
          ...request,
          requestId,
          actorRole: metadataValue(metadata, 'x-actor-role'),
          actorId: metadataValue(metadata, 'x-actor-id'),
          actorTokenId: metadataValue(metadata, 'x-actor-token-id'),
        });
        logEvent({
          service: 'catalog-service',
          event: 'grpc.catalog.create-trip',
          message: 'Scheduled trip creation processed.',
          requestId,
          fields: {
            rpc: 'CatalogAdminService.CreateTrip',
            tripId: response.tripId,
            created: response.created,
            durationMs: Math.round(performance.now() - startedAt),
          },
        });
        return response;
      } catch (error) {
        if (error instanceof CatalogAuthorizationError) {
          throw new RpcException({ code: status.PERMISSION_DENIED, message: error.message });
        }
        if (error instanceof TripDetailValidationError) {
          throw new RpcException({ code: status.INVALID_ARGUMENT, message: error.message });
        }
        if (error instanceof TripCreationConfigurationServiceError) {
          throw new RpcException({ code: status.FAILED_PRECONDITION, message: error.message });
        }
        if (error instanceof CatalogIdempotencyConflictError) {
          throw new RpcException({ code: status.ALREADY_EXISTS, message: error.message });
        }
        logEvent({
          service: 'catalog-service',
          level: 'error',
          event: 'grpc.catalog.create-trip.failed',
          message: 'Scheduled trip creation failed.',
          requestId,
          fields: {
            rpc: 'CatalogAdminService.CreateTrip',
            dependency: 'postgresql-or-redis',
            durationMs: Math.round(performance.now() - startedAt),
          },
        });
        throw new RpcException({
          code: status.UNAVAILABLE,
          message: 'Catalog dependency unavailable.',
        });
      }
    });
  }

  @GrpcMethod('CatalogAdminService', 'GetAdminCatalog')
  async grpcGetAdminCatalog(
    request: { requestId?: string },
    metadata: Metadata,
  ): Promise<GetAdminCatalogResponse> {
    const response = await this.adminCall(request, metadata, (adminRequest) =>
      this.catalogService.getAdminCatalog(adminRequest),
    );
    return {
      ...response,
      locations: response.locations.map((location) => ({
        ...location,
        kind: location.kind === 'CITY' ? 1 : 2,
      })) as never,
      routes: response.routes.map((route) => ({
        ...route,
        stops: route.stops.map((stop) => ({ ...stop, stopKind: mapTripStopKind(stop.stopKind) })),
      })) as never,
    };
  }

  @GrpcMethod('CatalogAdminService', 'SaveLocation')
  async grpcSaveLocation(
    request: SaveLocationRequest & { kind?: number | string },
    metadata: Metadata,
  ): Promise<SaveCatalogResourceResponse> {
    return this.adminCall(request, metadata, (adminRequest) =>
      this.catalogService.saveLocation({ ...adminRequest, kind: mapLocationKind(request.kind) }),
    );
  }

  @GrpcMethod('CatalogAdminService', 'SaveRoute')
  async grpcSaveRoute(
    request: SaveRouteRequest & { stops?: Array<{ stopKind?: number | string }> },
    metadata: Metadata,
  ): Promise<SaveCatalogResourceResponse> {
    return this.adminCall(request, metadata, (adminRequest) =>
      this.catalogService.saveRoute({
        ...adminRequest,
        stops: request.stops?.map((stop) => ({
          ...stop,
          stopKind: mapAdminStopKind(stop.stopKind),
        })),
      }),
    );
  }

  @GrpcMethod('CatalogAdminService', 'SaveVehicle')
  async grpcSaveVehicle(
    request: SaveVehicleRequest,
    metadata: Metadata,
  ): Promise<SaveCatalogResourceResponse> {
    return this.adminCall(request, metadata, (adminRequest) =>
      this.catalogService.saveVehicle(adminRequest),
    );
  }

  @GrpcMethod('CatalogAdminService', 'SaveSeatLayout')
  async grpcSaveSeatLayout(
    request: SaveSeatLayoutRequest,
    metadata: Metadata,
  ): Promise<SaveCatalogResourceResponse> {
    return this.adminCall(request, metadata, (adminRequest) =>
      this.catalogService.saveSeatLayout(adminRequest),
    );
  }

  @GrpcMethod('CatalogAdminService', 'UpdateTrip')
  async grpcUpdateTrip(
    request: UpdateTripRequest,
    metadata: Metadata,
  ): Promise<SaveCatalogResourceResponse> {
    return this.adminCall(request, metadata, (adminRequest) =>
      this.catalogService.updateTrip(adminRequest),
    );
  }

  @GrpcMethod('CatalogAdminService', 'SetCatalogResourceActive')
  async grpcSetCatalogResourceActive(
    request: SetCatalogResourceActiveRequest & { resourceType?: number | string },
    metadata: Metadata,
  ): Promise<SaveCatalogResourceResponse> {
    return this.adminCall(request, metadata, (adminRequest) =>
      this.catalogService.setCatalogResourceActive({
        ...adminRequest,
        resourceType: mapResourceType(request.resourceType),
      }),
    );
  }

  private async adminCall<T extends { requestId?: string }, R>(
    request: T,
    metadata: Metadata,
    operation: (
      request: T & {
        requestId: string;
        actorRole?: string;
        actorId?: string;
        actorTokenId?: string;
      },
    ) => Promise<R>,
  ): Promise<R> {
    const requestId = createRequestId(metadataValue(metadata, 'x-request-id') ?? request.requestId);
    return withRequestContext(requestId, async () => {
      try {
        return await operation({
          ...request,
          requestId,
          actorRole: metadataValue(metadata, 'x-actor-role'),
          actorId: metadataValue(metadata, 'x-actor-id'),
          actorTokenId: metadataValue(metadata, 'x-actor-token-id'),
        });
      } catch (error) {
        if (error instanceof CatalogAuthorizationError)
          throw new RpcException({ code: status.PERMISSION_DENIED, message: error.message });
        if (error instanceof TripDetailValidationError)
          throw new RpcException({ code: status.INVALID_ARGUMENT, message: error.message });
        if (error instanceof TripNotFoundError)
          throw new RpcException({ code: status.NOT_FOUND, message: error.message });
        if (error instanceof TripCreationConfigurationServiceError)
          throw new RpcException({ code: status.FAILED_PRECONDITION, message: error.message });
        if (error instanceof CatalogIdempotencyConflictError)
          throw new RpcException({ code: status.ALREADY_EXISTS, message: error.message });
        throw new RpcException({
          code: status.UNAVAILABLE,
          message: 'Catalog dependency unavailable.',
        });
      }
    });
  }
}

function metadataValue(metadata: Metadata, key: string): string | undefined {
  const value = metadata.get(key)[0];
  return typeof value === 'string' ? value : undefined;
}

function mapTripStopKind(kind: 'PICKUP' | 'DROPOFF' | 'BOTH'): 1 | 2 | 3 {
  if (kind === 'PICKUP') return 1;
  if (kind === 'DROPOFF') return 2;
  return 3;
}

function mapLocationKind(value: number | string | undefined): 'CITY' | 'STATION' | undefined {
  if (value === 1 || value === 'LOCATION_KIND_CITY' || value === 'CITY') return 'CITY';
  if (value === 2 || value === 'LOCATION_KIND_STATION' || value === 'STATION') return 'STATION';
  return undefined;
}

function mapAdminStopKind(
  value: number | string | undefined,
): 'PICKUP' | 'DROPOFF' | 'BOTH' | undefined {
  if (value === 1 || value === 'TRIP_STOP_KIND_PICKUP' || value === 'PICKUP') return 'PICKUP';
  if (value === 2 || value === 'TRIP_STOP_KIND_DROPOFF' || value === 'DROPOFF') return 'DROPOFF';
  if (value === 3 || value === 'TRIP_STOP_KIND_BOTH' || value === 'BOTH') return 'BOTH';
  return undefined;
}

function mapResourceType(
  value: number | string | undefined,
): 'LOCATION' | 'ROUTE' | 'VEHICLE' | 'SEAT_LAYOUT' | 'TRIP' | undefined {
  const values = ['LOCATION', 'ROUTE', 'VEHICLE', 'SEAT_LAYOUT', 'TRIP'] as const;
  if (typeof value === 'number') return values[value - 1];
  const normalized = value?.replace('CATALOG_RESOURCE_TYPE_', '');
  return values.find((item) => item === normalized);
}
