import { activePropagationHeaders, createRequestId, logEvent } from '@bus/observability';
import { Metadata, status } from '@grpc/grpc-js';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom, type Observable, timeout } from 'rxjs';

import type { CheckoutOwner } from './booking.types';

export interface ActiveBookingHold {
  token: string;
  tripId: string;
  seatIds: string[];
  expiresAt: string;
  unitPriceVnd: number;
  totalPriceVnd: number;
}

interface SeatInventoryHealthResponse {
  status: string;
}

interface SeatHoldResponse {
  hold?: {
    token: string;
    tripId: string;
    seatIds?: string[];
    expiresAt: string;
    unitPriceVnd: number;
    totalPriceVnd: number;
    status: number | string;
  };
}

interface SeatInventoryClientContract {
  health(
    input: { requestId: string },
    metadata?: Metadata,
  ): Observable<SeatInventoryHealthResponse>;
  getHold(
    input: {
      holdToken: string;
      owner: { type: 1 | 2; id: string };
      requestId: string;
    },
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
  ): Observable<{ released: boolean }>;
  confirmSeats(
    input: {
      holdToken: string;
      owner: { type: 1 | 2; id: string };
      tripId: string;
      seatIds: string[];
      bookingId: string;
      idempotencyKey: string;
      requestId: string;
    },
    metadata?: Metadata,
  ): Observable<{ confirmed: boolean; confirmedAt: string }>;
  releaseBookedSeats(
    input: {
      bookingId: string;
      tripId: string;
      seatIds: string[];
      idempotencyKey: string;
      requestId: string;
    },
    metadata?: Metadata,
  ): Observable<{ released: boolean; releasedAt: string }>;
}

export class BookingHoldExpiredError extends Error {
  constructor() {
    super('Seat hold is no longer active.');
    this.name = 'BookingHoldExpiredError';
  }
}

export class BookingHoldForbiddenError extends Error {
  constructor() {
    super('Seat hold is unavailable.');
    this.name = 'BookingHoldForbiddenError';
  }
}

export class SeatInventoryDependencyError extends Error {
  constructor(options?: ErrorOptions) {
    super('Seat Inventory Service is unavailable.', options);
    this.name = 'SeatInventoryDependencyError';
  }
}

export class BookingSeatUnavailableError extends Error {
  constructor() {
    super('One or more seats are unavailable for this booking.');
    this.name = 'BookingSeatUnavailableError';
  }
}

export class BookingSeatIdempotencyError extends Error {
  constructor() {
    super('Seat confirmation idempotency key conflicts with an earlier request.');
    this.name = 'BookingSeatIdempotencyError';
  }
}

@Injectable()
export class SeatInventoryClient implements OnModuleInit {
  private client?: SeatInventoryClientContract;

  constructor(@Inject('SEAT_INVENTORY_GRPC') private readonly grpcClient: ClientGrpc) {}

  onModuleInit(): void {
    this.client = this.grpcClient.getService<SeatInventoryClientContract>('SeatInventoryService');
  }

  async readiness(requestId?: string): Promise<void> {
    const correlationId = createRequestId(requestId);
    const response = await this.call(
      (client, metadata) => client.health({ requestId: correlationId }, metadata),
      correlationId,
    );
    if (response.status !== 'UP') throw new SeatInventoryDependencyError();
  }

  async getActiveHold(
    holdToken: string,
    owner: CheckoutOwner,
    requestId?: string,
  ): Promise<ActiveBookingHold> {
    const correlationId = createRequestId(requestId);
    try {
      const response = await this.call(
        (client, metadata) =>
          client.getHold(
            {
              holdToken,
              owner: { type: owner.type === 'GUEST_SESSION' ? 1 : 2, id: owner.id },
              requestId: correlationId,
            },
            metadata,
          ),
        correlationId,
      );
      const hold = response.hold;
      if (!hold || !isActiveStatus(hold.status)) throw new SeatInventoryDependencyError();
      return {
        token: hold.token,
        tripId: hold.tripId,
        seatIds: hold.seatIds ?? [],
        expiresAt: hold.expiresAt,
        unitPriceVnd: hold.unitPriceVnd,
        totalPriceVnd: hold.totalPriceVnd,
      };
    } catch (error) {
      if (isGrpcCode(error, status.FAILED_PRECONDITION)) throw new BookingHoldExpiredError();
      if (isGrpcCode(error, status.PERMISSION_DENIED)) throw new BookingHoldForbiddenError();
      if (
        error instanceof BookingHoldExpiredError ||
        error instanceof BookingHoldForbiddenError ||
        error instanceof SeatInventoryDependencyError
      ) {
        throw error;
      }
      logEvent({
        service: 'booking-service',
        level: 'error',
        event: 'seat-inventory.get-hold.failed',
        message: 'Seat hold validation failed.',
        requestId: correlationId,
        fields: { dependency: 'seat-inventory-service', ownerType: owner.type },
      });
      throw new SeatInventoryDependencyError({ cause: error });
    }
  }

  async releaseHold(
    holdToken: string,
    owner: CheckoutOwner,
    idempotencyKey: string,
    requestId?: string,
  ): Promise<void> {
    const correlationId = createRequestId(requestId);
    try {
      await this.call(
        (client, metadata) =>
          client.releaseHold(
            {
              holdToken,
              owner: { type: owner.type === 'GUEST_SESSION' ? 1 : 2, id: owner.id },
              idempotencyKey,
              requestId: correlationId,
            },
            metadata,
          ),
        correlationId,
      );
    } catch (error) {
      if (isGrpcCode(error, status.PERMISSION_DENIED)) throw new BookingHoldForbiddenError();
      throw new SeatInventoryDependencyError({ cause: error });
    }
  }

  async confirmSeats(input: {
    holdToken: string;
    owner: CheckoutOwner;
    tripId: string;
    seatIds: string[];
    bookingId: string;
    idempotencyKey: string;
    requestId?: string;
  }): Promise<string> {
    const correlationId = createRequestId(input.requestId);
    try {
      const response = await this.call(
        (client, metadata) =>
          client.confirmSeats(
            {
              holdToken: input.holdToken,
              owner: {
                type: input.owner.type === 'GUEST_SESSION' ? 1 : 2,
                id: input.owner.id,
              },
              tripId: input.tripId,
              seatIds: input.seatIds,
              bookingId: input.bookingId,
              idempotencyKey: input.idempotencyKey,
              requestId: correlationId,
            },
            metadata,
          ),
        correlationId,
      );
      if (!response.confirmed || !response.confirmedAt) throw new SeatInventoryDependencyError();
      return response.confirmedAt;
    } catch (error) {
      if (isGrpcCode(error, status.FAILED_PRECONDITION)) throw new BookingHoldExpiredError();
      if (isGrpcCode(error, status.PERMISSION_DENIED)) throw new BookingHoldForbiddenError();
      if (isGrpcCode(error, status.ALREADY_EXISTS)) throw new BookingSeatUnavailableError();
      if (isGrpcCode(error, status.ABORTED)) throw new BookingSeatIdempotencyError();
      if (
        error instanceof BookingHoldExpiredError ||
        error instanceof BookingHoldForbiddenError ||
        error instanceof BookingSeatUnavailableError ||
        error instanceof BookingSeatIdempotencyError ||
        error instanceof SeatInventoryDependencyError
      ) {
        throw error;
      }
      throw new SeatInventoryDependencyError({ cause: error });
    }
  }

  async releaseBookedSeats(input: {
    bookingId: string;
    tripId: string;
    seatIds: string[];
    idempotencyKey: string;
    requestId?: string;
  }): Promise<string> {
    const correlationId = createRequestId(input.requestId);
    try {
      const response = await this.call((client, metadata) => {
        metadata.set('x-actor-category', 'SYSTEM');
        metadata.set('x-actor-id', '00000000-0000-4000-8000-000000000001');
        return client.releaseBookedSeats(
          {
            bookingId: input.bookingId,
            tripId: input.tripId,
            seatIds: input.seatIds,
            idempotencyKey: input.idempotencyKey,
            requestId: correlationId,
          },
          metadata,
        );
      }, correlationId);
      if (!response.released || !response.releasedAt) throw new SeatInventoryDependencyError();
      return response.releasedAt;
    } catch (error) {
      if (isGrpcCode(error, status.ALREADY_EXISTS)) throw new BookingSeatUnavailableError();
      if (isGrpcCode(error, status.ABORTED)) throw new BookingSeatIdempotencyError();
      if (
        error instanceof BookingSeatUnavailableError ||
        error instanceof BookingSeatIdempotencyError ||
        error instanceof SeatInventoryDependencyError
      ) {
        throw error;
      }
      throw new SeatInventoryDependencyError({ cause: error });
    }
  }

  private async call<T>(
    operation: (client: SeatInventoryClientContract, metadata: Metadata) => Observable<T>,
    requestId: string,
  ): Promise<T> {
    if (!this.client) throw new SeatInventoryDependencyError();
    const metadata = new Metadata();
    metadata.set('x-request-id', requestId);
    for (const [key, value] of Object.entries(activePropagationHeaders())) metadata.set(key, value);
    return firstValueFrom(operation(this.client, metadata).pipe(timeout(2_000)));
  }
}

function isActiveStatus(value: number | string): boolean {
  return value === 1 || value === 'HOLD_STATUS_ACTIVE' || value === 'ACTIVE';
}

function isGrpcCode(error: unknown, code: number): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}
