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

import { CatalogDependencyError, CatalogTripNotFoundError } from './catalog.client';
import type { RequestWithContext } from './request-context.middleware';
import type {
  GetHoldRequest,
  GetHoldResponse,
  GetSeatMapRequest,
  GetSeatMapResponse,
  ConfirmSeatsRequest,
  ConfirmSeatsResponse,
  HealthRequest,
  HealthResponse,
  HoldSeatsRequest,
  HoldSeatsResponse,
  ReleaseHoldRequest,
  ReleaseHoldResponse,
  ReleaseBookedSeatsRequest,
  ReleaseBookedSeatsResponse,
  SetSeatBlockedRequest,
  SetSeatBlockedResponse,
  SeatHoldView,
  SeatStatus,
} from './seat-inventory.service';
import {
  HoldExpiredError,
  HoldOwnershipError,
  IdempotencyConflictError,
  SeatConfirmationIdempotencyConflictError,
  SeatReleaseIdempotencyConflictError,
  SeatAdminForbiddenError,
  SeatBlockIdempotencyConflictError,
  SeatInventoryService,
  SeatMapValidationError,
  SeatUnavailableError,
} from './seat-inventory.service';
import type { HoldOwner } from './seat-hold.store';

type GrpcGetSeatMapResponse = Omit<GetSeatMapResponse, 'seatMap'> & {
  seatMap: Omit<GetSeatMapResponse['seatMap'], 'seats'> & {
    seats: Array<
      Omit<GetSeatMapResponse['seatMap']['seats'][number], 'status'> & { status: 1 | 2 | 3 | 4 }
    >;
  };
};

type GrpcHoldOwner = { type?: number | string; id?: string };
type GrpcHoldSeatsRequest = Omit<HoldSeatsRequest, 'owner'> & { owner?: GrpcHoldOwner };
type GrpcGetHoldRequest = Omit<GetHoldRequest, 'owner'> & { owner?: GrpcHoldOwner };
type GrpcReleaseHoldRequest = Omit<ReleaseHoldRequest, 'owner'> & { owner?: GrpcHoldOwner };
type GrpcConfirmSeatsRequest = Omit<ConfirmSeatsRequest, 'owner'> & { owner?: GrpcHoldOwner };
type GrpcSeatHold = Omit<SeatHoldView, 'owner' | 'status'> & {
  owner: { type: 1 | 2; id: string };
  status: 1 | 2 | 3;
};
type GrpcHoldSeatsResponse = Omit<HoldSeatsResponse, 'hold'> & { hold: GrpcSeatHold };
type GrpcGetHoldResponse = Omit<GetHoldResponse, 'hold'> & { hold: GrpcSeatHold };

@Controller()
export class SeatInventoryController {
  constructor(
    @Inject(SeatInventoryService) private readonly seatInventoryService: SeatInventoryService,
  ) {}

  @Get('health')
  httpHealth(@Req() request: RequestWithContext): HealthResponse {
    return this.httpLiveness(request);
  }

  @Get('health/live')
  httpLiveness(@Req() request: RequestWithContext): HealthResponse {
    return this.seatInventoryService.health(
      { requestId: request.requestId },
      currentTraceContext().traceId ?? 'unavailable',
    );
  }

  @Get('health/ready')
  async httpReadiness(@Req() request: RequestWithContext): Promise<HealthResponse> {
    try {
      return await this.seatInventoryService.readiness(
        { requestId: request.requestId },
        currentTraceContext().traceId ?? 'unavailable',
      );
    } catch {
      logEvent({
        service: 'seat-inventory-service',
        level: 'error',
        event: 'seat-inventory.readiness.failed',
        message: 'Seat Inventory readiness check failed.',
        requestId: request.requestId,
        fields: { dependencies: ['postgresql', 'redis', 'catalog-service'] },
      });
      throw new ServiceUnavailableException({
        code: 'DEPENDENCY_UNAVAILABLE',
        message: 'Seat Inventory dependencies are unavailable.',
      });
    }
  }

  @GrpcMethod('SeatInventoryService', 'Health')
  async grpcHealth(request: HealthRequest, metadata: Metadata): Promise<HealthResponse> {
    const requestId = grpcRequestId(request.requestId, metadata);
    return withRequestContext(requestId, async () => {
      try {
        return await this.seatInventoryService.readiness(
          { requestId },
          currentTraceContext().traceId ?? 'unavailable',
        );
      } catch {
        throw new RpcException({
          code: status.UNAVAILABLE,
          message: 'Seat Inventory unavailable.',
        });
      }
    });
  }

  @GrpcMethod('SeatInventoryService', 'GetSeatMap')
  async grpcGetSeatMap(
    request: GetSeatMapRequest,
    metadata: Metadata,
  ): Promise<GrpcGetSeatMapResponse> {
    const requestId = grpcRequestId(request.requestId, metadata);
    return withRequestContext(requestId, async () => {
      const startedAt = performance.now();
      try {
        const response = await this.seatInventoryService.getSeatMap({ ...request, requestId });
        const counts = countStatuses(response.seatMap.seats.map((seat) => seat.status));
        logEvent({
          service: 'seat-inventory-service',
          event: 'grpc.seat-inventory.get-seat-map',
          message: 'Seat map returned.',
          requestId,
          fields: {
            rpc: 'SeatInventoryService.GetSeatMap',
            tripId: request.tripId,
            ...counts,
            durationMs: Math.round(performance.now() - startedAt),
          },
        });
        return {
          ...response,
          seatMap: {
            ...response.seatMap,
            seats: response.seatMap.seats.map((seat) => ({
              ...seat,
              status: mapSeatStatus(seat.status),
            })),
          },
        };
      } catch (error) {
        if (error instanceof SeatMapValidationError) {
          throw new RpcException({ code: status.INVALID_ARGUMENT, message: error.message });
        }
        if (error instanceof CatalogTripNotFoundError) {
          throw new RpcException({ code: status.NOT_FOUND, message: 'Trip was not found.' });
        }
        if (error instanceof CatalogDependencyError) {
          throw new RpcException({ code: status.UNAVAILABLE, message: error.message });
        }
        logEvent({
          service: 'seat-inventory-service',
          level: 'error',
          event: 'grpc.seat-inventory.get-seat-map.failed',
          message: 'Seat map query failed.',
          requestId,
          fields: {
            rpc: 'SeatInventoryService.GetSeatMap',
            tripId: request.tripId,
            dependency: 'postgresql',
            durationMs: Math.round(performance.now() - startedAt),
          },
        });
        throw new RpcException({
          code: status.UNAVAILABLE,
          message: 'Seat inventory unavailable.',
        });
      }
    });
  }

  @GrpcMethod('SeatInventoryService', 'HoldSeats')
  async grpcHoldSeats(
    request: GrpcHoldSeatsRequest,
    metadata: Metadata,
  ): Promise<GrpcHoldSeatsResponse> {
    const requestId = grpcRequestId(request.requestId, metadata);
    return withRequestContext(requestId, async () => {
      const startedAt = performance.now();
      try {
        assertCustomerOwner(metadata, request.owner);
        const response = await this.seatInventoryService.holdSeats({
          ...request,
          owner: mapHoldOwner(request.owner),
          requestId,
        });
        logEvent({
          service: 'seat-inventory-service',
          event: 'grpc.seat-inventory.hold-seats',
          message: 'Seats held.',
          requestId,
          fields: {
            rpc: 'SeatInventoryService.HoldSeats',
            tripId: request.tripId,
            seatCount: response.hold.seatIds.length,
            ownerType: response.hold.owner.type,
            durationMs: Math.round(performance.now() - startedAt),
          },
        });
        return { ...response, hold: mapSeatHold(response.hold) };
      } catch (error) {
        logHoldRejection('hold-seats', requestId, request.tripId, error, startedAt);
        throwSeatError(error);
      }
    });
  }

  @GrpcMethod('SeatInventoryService', 'GetHold')
  async grpcGetHold(request: GrpcGetHoldRequest, metadata: Metadata): Promise<GrpcGetHoldResponse> {
    const requestId = grpcRequestId(request.requestId, metadata);
    return withRequestContext(requestId, async () => {
      try {
        const response = await this.seatInventoryService.getHold({
          ...request,
          owner: mapHoldOwner(request.owner),
          requestId,
        });
        return { ...response, hold: mapSeatHold(response.hold) };
      } catch (error) {
        throwSeatError(error);
      }
    });
  }

  @GrpcMethod('SeatInventoryService', 'ReleaseHold')
  async grpcReleaseHold(
    request: GrpcReleaseHoldRequest,
    metadata: Metadata,
  ): Promise<ReleaseHoldResponse> {
    const requestId = grpcRequestId(request.requestId, metadata);
    return withRequestContext(requestId, async () => {
      try {
        assertCustomerOwner(metadata, request.owner);
        const response = await this.seatInventoryService.releaseHold({
          ...request,
          owner: mapHoldOwner(request.owner),
          requestId,
        });
        logEvent({
          service: 'seat-inventory-service',
          event: 'grpc.seat-inventory.release-hold',
          message: response.released ? 'Seat hold released.' : 'Seat hold release had no effect.',
          requestId,
          fields: {
            rpc: 'SeatInventoryService.ReleaseHold',
            released: response.released,
            seatCount: response.seatIds.length,
          },
        });
        return response;
      } catch (error) {
        throwSeatError(error);
      }
    });
  }

  @GrpcMethod('SeatInventoryService', 'ConfirmSeats')
  async grpcConfirmSeats(
    request: GrpcConfirmSeatsRequest,
    metadata: Metadata,
  ): Promise<ConfirmSeatsResponse> {
    const requestId = grpcRequestId(request.requestId, metadata);
    return withRequestContext(requestId, async () => {
      const startedAt = performance.now();
      try {
        const response = await this.seatInventoryService.confirmSeats({
          ...request,
          owner: mapHoldOwner(request.owner),
          requestId,
        });
        logEvent({
          service: 'seat-inventory-service',
          event: 'grpc.seat-inventory.confirm-seats',
          message: 'Seats confirmed durably for a booking.',
          requestId,
          fields: {
            rpc: 'SeatInventoryService.ConfirmSeats',
            tripId: response.tripId,
            bookingId: response.bookingId,
            seatCount: response.seatIds.length,
            durationMs: Math.round(performance.now() - startedAt),
          },
        });
        return response;
      } catch (error) {
        logHoldRejection('confirm-seats', requestId, request.tripId, error, startedAt);
        throwSeatError(error);
      }
    });
  }

  @GrpcMethod('SeatInventoryService', 'ReleaseBookedSeats')
  async grpcReleaseBookedSeats(
    request: ReleaseBookedSeatsRequest,
    metadata: Metadata,
  ): Promise<ReleaseBookedSeatsResponse> {
    assertSystemActor(metadata);
    const requestId = grpcRequestId(request.requestId, metadata);
    return withRequestContext(requestId, async () => {
      const startedAt = performance.now();
      try {
        const response = await this.seatInventoryService.releaseBookedSeats({
          ...request,
          requestId,
        });
        logEvent({
          service: 'seat-inventory-service',
          event: 'grpc.seat-inventory.release-booked-seats',
          message: 'Booked seats released for a cancelled booking.',
          requestId,
          fields: {
            rpc: 'SeatInventoryService.ReleaseBookedSeats',
            bookingId: response.bookingId,
            tripId: response.tripId,
            seatCount: response.seatIds.length,
            durationMs: Math.round(performance.now() - startedAt),
          },
        });
        return response;
      } catch (error) {
        logHoldRejection('release-booked-seats', requestId, request.tripId, error, startedAt);
        throwSeatError(error);
      }
    });
  }

  @GrpcMethod('SeatInventoryService', 'SetSeatBlocked')
  async grpcSetSeatBlocked(
    request: Omit<SetSeatBlockedRequest, 'actor' | 'traceId'>,
    metadata: Metadata,
  ): Promise<SetSeatBlockedResponse> {
    const actor = requireAdminActor(metadata);
    const requestId = grpcRequestId(request.requestId, metadata);
    return withRequestContext(requestId, async () => {
      try {
        const response = await this.seatInventoryService.setSeatBlocked({
          ...request,
          actor,
          requestId,
          traceId: currentTraceContext().traceId ?? 'unavailable',
        });
        logEvent({
          service: 'seat-inventory-service',
          event: 'grpc.seat-inventory.set-seat-blocked',
          message: 'Admin seat block command processed.',
          requestId,
          fields: {
            rpc: 'SeatInventoryService.SetSeatBlocked',
            actorId: actor.id,
            tripId: response.tripId,
            seatCount: response.seatIds.length,
            blocked: response.blocked,
            changed: response.changed,
          },
        });
        return response;
      } catch (error) {
        throwSeatError(error);
      }
    });
  }
}

const SYSTEM_ACTOR_ID = '00000000-0000-4000-8000-000000000001';

function assertSystemActor(metadata: Metadata): void {
  if (
    metadata.get('x-actor-category')[0] !== 'SYSTEM' ||
    metadata.get('x-actor-id')[0] !== SYSTEM_ACTOR_ID
  ) {
    throw new RpcException({ code: status.PERMISSION_DENIED, message: 'System actor required.' });
  }
}

function requireAdminActor(metadata: Metadata): { id: string; role: 'ADMIN' } {
  const actorId = metadata.get('x-actor-id')[0];
  const actorRole = metadata.get('x-actor-role')[0];
  const tokenId = metadata.get('x-actor-token-id')[0];
  if (
    actorRole !== 'ADMIN' ||
    typeof actorId !== 'string' ||
    !isUuid(actorId) ||
    typeof tokenId !== 'string' ||
    !isUuid(tokenId)
  ) {
    throw new RpcException({ code: status.PERMISSION_DENIED, message: 'Admin actor required.' });
  }
  return { id: actorId, role: 'ADMIN' };
}

function grpcRequestId(requestId: string | undefined, metadata: Metadata): string {
  const metadataRequestId = metadata.get('x-request-id')[0];
  return createRequestId(typeof metadataRequestId === 'string' ? metadataRequestId : requestId);
}

function mapSeatStatus(value: SeatStatus): 1 | 2 | 3 | 4 {
  if (value === 'AVAILABLE') return 1;
  if (value === 'HELD') return 2;
  if (value === 'BOOKED') return 3;
  return 4;
}

function mapHoldOwner(owner: GrpcHoldOwner | undefined): HoldOwner | undefined {
  if (!owner) return undefined;
  const type = owner.type;
  if (type === 1 || type === 'HOLD_OWNER_TYPE_GUEST_SESSION' || type === 'GUEST_SESSION') {
    return { type: 'GUEST_SESSION', id: owner.id ?? '' };
  }
  if (type === 2 || type === 'HOLD_OWNER_TYPE_CUSTOMER' || type === 'CUSTOMER') {
    return { type: 'CUSTOMER', id: owner.id ?? '' };
  }
  return undefined;
}

function assertCustomerOwner(metadata: Metadata, owner: GrpcHoldOwner | undefined): void {
  const mapped = mapHoldOwner(owner);
  if (mapped?.type !== 'CUSTOMER') return;
  const actorId = metadata.get('x-actor-id')[0];
  const actorRole = metadata.get('x-actor-role')[0];
  const tokenId = metadata.get('x-actor-token-id')[0];
  if (
    actorRole !== 'CUSTOMER' ||
    actorId !== mapped.id ||
    typeof actorId !== 'string' ||
    !isUuid(actorId) ||
    typeof tokenId !== 'string' ||
    !isUuid(tokenId)
  ) {
    throw new RpcException({ code: status.PERMISSION_DENIED, message: 'Customer actor required.' });
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function mapSeatHold(hold: SeatHoldView): GrpcSeatHold {
  return {
    ...hold,
    owner: { type: hold.owner.type === 'GUEST_SESSION' ? 1 : 2, id: hold.owner.id },
    status: hold.status === 'ACTIVE' ? 1 : hold.status === 'EXPIRED' ? 2 : 3,
  };
}

function throwSeatError(error: unknown): never {
  if (error instanceof SeatMapValidationError) {
    throw new RpcException({ code: status.INVALID_ARGUMENT, message: error.message });
  }
  if (error instanceof CatalogTripNotFoundError) {
    throw new RpcException({ code: status.NOT_FOUND, message: 'Trip was not found.' });
  }
  if (error instanceof SeatUnavailableError) {
    throw new RpcException({ code: status.ALREADY_EXISTS, message: 'Seats are unavailable.' });
  }
  if (error instanceof HoldExpiredError) {
    throw new RpcException({ code: status.FAILED_PRECONDITION, message: error.message });
  }
  if (error instanceof HoldOwnershipError) {
    throw new RpcException({ code: status.PERMISSION_DENIED, message: error.message });
  }
  if (error instanceof IdempotencyConflictError) {
    throw new RpcException({ code: status.ABORTED, message: error.message });
  }
  if (error instanceof SeatConfirmationIdempotencyConflictError) {
    throw new RpcException({ code: status.ABORTED, message: error.message });
  }
  if (error instanceof SeatReleaseIdempotencyConflictError) {
    throw new RpcException({ code: status.ABORTED, message: error.message });
  }
  if (error instanceof SeatAdminForbiddenError) {
    throw new RpcException({ code: status.PERMISSION_DENIED, message: error.message });
  }
  if (error instanceof SeatBlockIdempotencyConflictError) {
    throw new RpcException({ code: status.ABORTED, message: error.message });
  }
  if (error instanceof CatalogDependencyError) {
    throw new RpcException({ code: status.UNAVAILABLE, message: error.message });
  }
  throw new RpcException({ code: status.UNAVAILABLE, message: 'Seat inventory unavailable.' });
}

function logHoldRejection(
  operation: string,
  requestId: string,
  tripId: string | undefined,
  error: unknown,
  startedAt: number,
): void {
  logEvent({
    service: 'seat-inventory-service',
    level: error instanceof SeatUnavailableError ? 'warn' : 'error',
    event: `grpc.seat-inventory.${operation}.rejected`,
    message: 'Seat hold request rejected.',
    requestId,
    fields: {
      tripId,
      reason: error instanceof Error ? error.name : 'UnknownError',
      durationMs: Math.round(performance.now() - startedAt),
    },
  });
}

function countStatuses(statuses: SeatStatus[]) {
  return {
    availableCount: statuses.filter((value) => value === 'AVAILABLE').length,
    heldCount: statuses.filter((value) => value === 'HELD').length,
    bookedCount: statuses.filter((value) => value === 'BOOKED').length,
    blockedCount: statuses.filter((value) => value === 'BLOCKED').length,
  };
}
