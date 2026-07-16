import { activePropagationHeaders, createRequestId, logEvent } from '@bus/observability';
import { Metadata, status } from '@grpc/grpc-js';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom, type Observable, timeout } from 'rxjs';

import type { BookingGatewayActor, BookingOperationsActor } from './booking.service';

export interface SeatMapResponse {
  seatMap?: {
    tripId: string;
    layoutId: string;
    layoutVersion: number;
    layoutName: string;
    deckCount: number;
    seats?: Array<{
      id: string;
      label: string;
      deck: number;
      row: number;
      column: number;
      status: number | string;
      heldByRequester?: boolean;
    }>;
    generatedAt: string;
  };
  requestId: string;
}

export interface HoldOwnerInput {
  type: 'GUEST_SESSION' | 'CUSTOMER';
  id: string;
}

export interface HoldSeatsGatewayInput {
  tripId: string;
  seatIds: string[];
  owner: HoldOwnerInput;
  idempotencyKey: string;
  requestedTtlSeconds: number;
  actor?: BookingGatewayActor;
}

export interface SeatHoldResponse {
  hold?: {
    token: string;
    tripId: string;
    seatIds?: string[];
    expiresAt: string;
    remainingTtlSeconds: number;
    unitPriceVnd: number;
    totalPriceVnd: number;
    status: number | string;
  };
  requestId: string;
}

export interface ReleaseHoldGatewayResponse {
  released: boolean;
  tripId?: string;
  seatIds?: string[];
  releasedAt?: string;
  requestId: string;
}

export interface SetSeatBlockedGatewayResponse {
  tripId: string;
  seatIds?: string[];
  blocked: boolean;
  changed: boolean;
  updatedAt: string;
  requestId: string;
}

interface SeatInventoryHealthResponse {
  service: string;
  status: string;
  version: string;
  requestId: string;
  traceId: string;
  checkedAt: string;
}

interface SeatInventoryClient {
  health(
    input: { requestId: string },
    metadata?: Metadata,
  ): Observable<SeatInventoryHealthResponse>;
  getSeatMap(
    input: { tripId: string; requestId: string; holdToken?: string },
    metadata?: Metadata,
  ): Observable<SeatMapResponse>;
  holdSeats(
    input: {
      tripId: string;
      seatIds: string[];
      owner: { type: 1 | 2; id: string };
      idempotencyKey: string;
      requestedTtlSeconds: number;
      requestId: string;
    },
    metadata?: Metadata,
  ): Observable<SeatHoldResponse>;
  getHold(
    input: { holdToken: string; owner: { type: 1 | 2; id: string }; requestId: string },
    metadata?: Metadata,
  ): Observable<SeatHoldResponse>;
  releaseHold(
    input: {
      holdToken: string;
      owner: { type: 1 | 2; id: string };
      idempotencyKey: string;
      requestId: string;
    },
    metadata?: Metadata,
  ): Observable<ReleaseHoldGatewayResponse>;
  setSeatBlocked(
    input: {
      tripId: string;
      seatIds: string[];
      blocked: boolean;
      reason: string;
      idempotencyKey: string;
      requestId: string;
    },
    metadata?: Metadata,
  ): Observable<SetSeatBlockedGatewayResponse>;
}

export class SeatInventoryDependencyError extends Error {
  constructor(
    readonly requestId: string,
    options?: ErrorOptions,
  ) {
    super('Seat Inventory Service is unavailable.', options);
    this.name = 'SeatInventoryDependencyError';
  }
}

export class SeatMapNotFoundError extends Error {
  constructor(
    readonly requestId: string,
    options?: ErrorOptions,
  ) {
    super('Trip was not found.', options);
    this.name = 'SeatMapNotFoundError';
  }
}

export class SeatMapValidationError extends Error {
  constructor(
    readonly requestId: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'SeatMapValidationError';
  }
}

export class SeatUnavailableGatewayError extends Error {
  constructor(
    readonly requestId: string,
    options?: ErrorOptions,
  ) {
    super('One or more seats are unavailable.', options);
    this.name = 'SeatUnavailableGatewayError';
  }
}

export class IdempotencyConflictGatewayError extends Error {
  constructor(
    readonly requestId: string,
    options?: ErrorOptions,
  ) {
    super('Idempotency key conflicts with an earlier request.', options);
    this.name = 'IdempotencyConflictGatewayError';
  }
}

export class HoldExpiredGatewayError extends Error {
  constructor(
    readonly requestId: string,
    options?: ErrorOptions,
  ) {
    super('Seat hold is no longer active.', options);
    this.name = 'HoldExpiredGatewayError';
  }
}

export class HoldForbiddenGatewayError extends Error {
  constructor(
    readonly requestId: string,
    options?: ErrorOptions,
  ) {
    super('Seat hold does not belong to the requester.', options);
    this.name = 'HoldForbiddenGatewayError';
  }
}

@Injectable()
export class SeatInventoryGatewayService implements OnModuleInit {
  private client?: SeatInventoryClient;

  constructor(@Inject('SEAT_INVENTORY_GRPC') private readonly grpcClient: ClientGrpc) {}

  onModuleInit(): void {
    this.client = this.grpcClient.getService<SeatInventoryClient>('SeatInventoryService');
  }

  async check(inboundRequestId?: string): Promise<SeatInventoryHealthResponse> {
    const requestId = createRequestId(inboundRequestId);
    try {
      return await this.call(
        (client, metadata) => client.health({ requestId }, metadata),
        requestId,
      );
    } catch (error) {
      throw new SeatInventoryDependencyError(requestId, { cause: error });
    }
  }

  async getSeatMap(
    tripId: string,
    holdToken?: string | null,
    inboundRequestId?: string,
  ): Promise<SeatMapResponse> {
    const requestId = createRequestId(inboundRequestId);
    try {
      const response = await this.call(
        (client, metadata) =>
          client.getSeatMap({ tripId, requestId, ...(holdToken ? { holdToken } : {}) }, metadata),
        requestId,
      );
      if (!response.seatMap) throw new SeatInventoryDependencyError(requestId);
      return {
        ...response,
        seatMap: { ...response.seatMap, seats: response.seatMap.seats ?? [] },
      };
    } catch (error) {
      if (error instanceof SeatInventoryDependencyError) throw error;
      if (isGrpcCode(error, status.NOT_FOUND)) {
        throw new SeatMapNotFoundError(requestId, { cause: error });
      }
      if (isGrpcCode(error, status.INVALID_ARGUMENT)) {
        throw new SeatMapValidationError(requestId, grpcDetails(error), { cause: error });
      }
      logEvent({
        service: 'graphql-gateway',
        level: 'error',
        event: 'seat-inventory.seat-map.failed',
        message: 'Seat map query failed.',
        requestId,
        fields: { dependency: 'seat-inventory-service', tripId },
      });
      throw new SeatInventoryDependencyError(requestId, { cause: error });
    }
  }

  async holdSeats(
    input: HoldSeatsGatewayInput,
    inboundRequestId?: string,
  ): Promise<SeatHoldResponse> {
    const requestId = createRequestId(inboundRequestId);
    try {
      const response = await this.call(
        (client, metadata) =>
          client.holdSeats(
            {
              ...input,
              owner: { type: mapOwnerType(input.owner.type), id: input.owner.id },
              requestId,
            },
            metadata,
          ),
        requestId,
        input.actor,
      );
      if (!response.hold) throw new SeatInventoryDependencyError(requestId);
      return {
        ...response,
        hold: { ...response.hold, seatIds: response.hold.seatIds ?? [] },
      };
    } catch (error) {
      if (error instanceof SeatInventoryDependencyError) throw error;
      if (isGrpcCode(error, status.ALREADY_EXISTS)) {
        throw new SeatUnavailableGatewayError(requestId, { cause: error });
      }
      if (isGrpcCode(error, status.ABORTED)) {
        throw new IdempotencyConflictGatewayError(requestId, { cause: error });
      }
      if (isGrpcCode(error, status.INVALID_ARGUMENT)) {
        throw new SeatMapValidationError(requestId, grpcDetails(error), { cause: error });
      }
      if (isGrpcCode(error, status.NOT_FOUND)) {
        throw new SeatMapNotFoundError(requestId, { cause: error });
      }
      logEvent({
        service: 'graphql-gateway',
        level: 'error',
        event: 'seat-inventory.hold-seats.failed',
        message: 'Seat hold command failed.',
        requestId,
        fields: {
          dependency: 'seat-inventory-service',
          tripId: input.tripId,
          seatCount: input.seatIds.length,
          ownerType: input.owner.type,
        },
      });
      throw new SeatInventoryDependencyError(requestId, { cause: error });
    }
  }

  async setSeatBlocked(
    input: {
      tripId: string;
      seatIds: string[];
      blocked: boolean;
      reason: string;
      idempotencyKey: string;
    },
    actor: BookingOperationsActor,
    inboundRequestId?: string,
  ): Promise<SetSeatBlockedGatewayResponse> {
    const requestId = createRequestId(inboundRequestId);
    try {
      const response = await this.call(
        (client, metadata) => client.setSeatBlocked({ ...input, requestId }, metadata),
        requestId,
        actor,
      );
      return { ...response, seatIds: response.seatIds ?? [] };
    } catch (error) {
      if (isGrpcCode(error, status.INVALID_ARGUMENT)) {
        throw new SeatMapValidationError(requestId, grpcDetails(error), { cause: error });
      }
      if (isGrpcCode(error, status.PERMISSION_DENIED)) {
        throw new HoldForbiddenGatewayError(requestId, { cause: error });
      }
      if (isGrpcCode(error, status.ALREADY_EXISTS)) {
        throw new SeatUnavailableGatewayError(requestId, { cause: error });
      }
      if (isGrpcCode(error, status.ABORTED)) {
        throw new IdempotencyConflictGatewayError(requestId, { cause: error });
      }
      if (isGrpcCode(error, status.NOT_FOUND)) {
        throw new SeatMapNotFoundError(requestId, { cause: error });
      }
      throw new SeatInventoryDependencyError(requestId, { cause: error });
    }
  }

  async getHold(
    holdToken: string,
    owner: HoldOwnerInput,
    inboundRequestId?: string,
    actor?: BookingGatewayActor | BookingOperationsActor,
  ): Promise<SeatHoldResponse> {
    const requestId = createRequestId(inboundRequestId);
    try {
      const response = await this.call(
        (client, metadata) =>
          client.getHold(
            {
              holdToken,
              owner: { type: mapOwnerType(owner.type), id: owner.id },
              requestId,
            },
            metadata,
          ),
        requestId,
        actor,
      );
      if (!response.hold) throw new SeatInventoryDependencyError(requestId);
      return { ...response, hold: { ...response.hold, seatIds: response.hold.seatIds ?? [] } };
    } catch (error) {
      if (error instanceof SeatInventoryDependencyError) throw error;
      if (isGrpcCode(error, status.FAILED_PRECONDITION)) {
        throw new HoldExpiredGatewayError(requestId, { cause: error });
      }
      if (isGrpcCode(error, status.PERMISSION_DENIED)) {
        throw new HoldForbiddenGatewayError(requestId, { cause: error });
      }
      if (isGrpcCode(error, status.INVALID_ARGUMENT)) {
        throw new SeatMapValidationError(requestId, grpcDetails(error), { cause: error });
      }
      throw new SeatInventoryDependencyError(requestId, { cause: error });
    }
  }

  async releaseHold(
    holdToken: string,
    owner: HoldOwnerInput,
    idempotencyKey: string,
    inboundRequestId?: string,
    actor?: BookingGatewayActor,
  ): Promise<ReleaseHoldGatewayResponse> {
    const requestId = createRequestId(inboundRequestId);
    try {
      const response = await this.call(
        (client, metadata) =>
          client.releaseHold(
            {
              holdToken,
              owner: { type: mapOwnerType(owner.type), id: owner.id },
              idempotencyKey,
              requestId,
            },
            metadata,
          ),
        requestId,
        actor,
      );
      return { ...response, seatIds: response.seatIds ?? [] };
    } catch (error) {
      if (isGrpcCode(error, status.INVALID_ARGUMENT)) {
        throw new SeatMapValidationError(requestId, grpcDetails(error), { cause: error });
      }
      throw new SeatInventoryDependencyError(requestId, { cause: error });
    }
  }

  private async call<T>(
    operation: (client: SeatInventoryClient, metadata: Metadata) => Observable<T>,
    requestId: string,
    actor?: BookingGatewayActor | BookingOperationsActor,
  ): Promise<T> {
    if (!this.client) throw new SeatInventoryDependencyError(requestId);
    const metadata = new Metadata();
    metadata.set('x-request-id', requestId);
    if (actor) {
      metadata.set('x-actor-id', actor.id);
      metadata.set('x-actor-role', actor.role);
      metadata.set('x-actor-token-id', actor.tokenId);
    }
    for (const [key, value] of Object.entries(activePropagationHeaders())) metadata.set(key, value);
    return firstValueFrom(operation(this.client, metadata).pipe(timeout(2_000)));
  }
}

function mapOwnerType(value: HoldOwnerInput['type']): 1 | 2 {
  return value === 'GUEST_SESSION' ? 1 : 2;
}

function isGrpcCode(error: unknown, code: number): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

function grpcDetails(error: unknown): string {
  return typeof error === 'object' && error !== null && 'details' in error
    ? String(error.details)
    : 'Seat map input is invalid.';
}
