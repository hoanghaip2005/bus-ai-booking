import { logEvent } from '@bus/observability';
import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';

import {
  CatalogClient,
  type CatalogSeatDefinition,
  type CatalogTripLayout,
} from './catalog.client';
import { SeatInventoryDatabase } from './seat-inventory.database';
import { SeatHoldStore, type ActiveSeatHold, type HoldOwner } from './seat-hold.store';
import {
  SeatConfirmationUnavailablePersistenceError,
  SeatBlockBookedPersistenceError,
  SeatReleaseMismatchPersistenceError,
  SeatStateRepository,
  type DurableSeatState,
} from './seat-state.repository';

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

export interface GetSeatMapRequest {
  tripId?: string;
  requestId?: string;
  holdToken?: string;
}

export type SeatStatus = 'AVAILABLE' | 'HELD' | 'BOOKED' | 'BLOCKED';

export interface GetSeatMapResponse {
  seatMap: {
    tripId: string;
    layoutId: string;
    layoutVersion: number;
    layoutName: string;
    deckCount: number;
    seats: Array<CatalogSeatDefinition & { status: SeatStatus; heldByRequester: boolean }>;
    generatedAt: string;
  };
  requestId: string;
}

export interface HoldSeatsRequest {
  tripId?: string;
  seatIds?: string[];
  owner?: HoldOwner;
  idempotencyKey?: string;
  requestedTtlSeconds?: number;
  requestId?: string;
}

export interface GetHoldRequest {
  holdToken?: string;
  owner?: HoldOwner;
  requestId?: string;
}

export interface ReleaseHoldRequest {
  holdToken?: string;
  owner?: HoldOwner;
  idempotencyKey?: string;
  requestId?: string;
}

export interface ConfirmSeatsRequest {
  holdToken?: string;
  owner?: HoldOwner;
  tripId?: string;
  seatIds?: string[];
  bookingId?: string;
  idempotencyKey?: string;
  requestId?: string;
}

export interface ReleaseBookedSeatsRequest {
  bookingId?: string;
  tripId?: string;
  seatIds?: string[];
  idempotencyKey?: string;
  requestId?: string;
}

export interface SeatHoldView extends ActiveSeatHold {
  remainingTtlSeconds: number;
  status: 'ACTIVE' | 'EXPIRED' | 'RELEASED';
}

export interface HoldSeatsResponse {
  hold: SeatHoldView;
  requestId: string;
}

export interface GetHoldResponse {
  hold: SeatHoldView;
  requestId: string;
}

export interface ReleaseHoldResponse {
  released: boolean;
  tripId?: string;
  seatIds: string[];
  releasedAt?: string;
  requestId: string;
}

export interface ConfirmSeatsResponse {
  confirmed: boolean;
  tripId: string;
  seatIds: string[];
  bookingId: string;
  confirmedAt: string;
  requestId: string;
}

export interface ReleaseBookedSeatsResponse {
  released: boolean;
  bookingId: string;
  tripId: string;
  seatIds: string[];
  releasedAt: string;
  requestId: string;
}

export interface SeatAdminActor {
  id: string;
  role: 'ADMIN';
}

export interface SetSeatBlockedRequest {
  tripId?: string;
  seatIds?: string[];
  blocked?: boolean;
  reason?: string;
  idempotencyKey?: string;
  actor?: SeatAdminActor;
  requestId?: string;
  traceId?: string;
}

export interface SetSeatBlockedResponse {
  tripId: string;
  seatIds: string[];
  blocked: boolean;
  changed: boolean;
  updatedAt: string;
  requestId: string;
}

export class SeatMapValidationError extends Error {
  readonly code = 'VALIDATION_ERROR';

  constructor(message: string) {
    super(message);
    this.name = 'SeatMapValidationError';
  }
}

export class SeatUnavailableError extends Error {
  constructor(readonly seatIds: string[]) {
    super('One or more seats are unavailable.');
    this.name = 'SeatUnavailableError';
  }
}

export class HoldExpiredError extends Error {
  constructor() {
    super('Seat hold is no longer active.');
    this.name = 'HoldExpiredError';
  }
}

export class HoldOwnershipError extends Error {
  constructor() {
    super('Seat hold does not belong to the requester.');
    this.name = 'HoldOwnershipError';
  }
}

export class IdempotencyConflictError extends Error {
  constructor() {
    super('Idempotency key was already used for a different hold request.');
    this.name = 'IdempotencyConflictError';
  }
}

export class SeatConfirmationIdempotencyConflictError extends Error {
  constructor() {
    super('Idempotency key was already used for a different seat confirmation.');
    this.name = 'SeatConfirmationIdempotencyConflictError';
  }
}

export class SeatReleaseIdempotencyConflictError extends Error {
  constructor() {
    super('Seat release idempotency key conflicts with an earlier request.');
    this.name = 'SeatReleaseIdempotencyConflictError';
  }
}

export class SeatAdminForbiddenError extends Error {
  constructor() {
    super('Admin actor is required.');
    this.name = 'SeatAdminForbiddenError';
  }
}

export class SeatBlockIdempotencyConflictError extends Error {
  constructor() {
    super('Idempotency key was already used for a different seat block command.');
    this.name = 'SeatBlockIdempotencyConflictError';
  }
}

@Injectable()
export class SeatInventoryService {
  constructor(
    @Inject(SeatInventoryDatabase) private readonly database: SeatInventoryDatabase,
    @Inject(CatalogClient) private readonly catalogClient: CatalogClient,
    @Inject(SeatStateRepository) private readonly seatStateRepository: SeatStateRepository,
    @Inject(SeatHoldStore) private readonly seatHoldStore: SeatHoldStore,
  ) {}

  health(request: HealthRequest, traceId = 'unavailable'): HealthResponse {
    return {
      service: 'seat-inventory-service',
      status: 'UP',
      version: '0.1.0',
      requestId: request.requestId ?? 'missing-request-id',
      traceId,
      checkedAt: new Date().toISOString(),
    };
  }

  async readiness(request: HealthRequest, traceId = 'unavailable'): Promise<HealthResponse> {
    await Promise.all([
      this.database.ping(),
      this.catalogClient.readiness(request.requestId),
      this.seatHoldStore.ping(),
    ]);
    return this.health(request, traceId);
  }

  async getSeatMap(request: GetSeatMapRequest): Promise<GetSeatMapResponse> {
    const tripId = request.tripId ?? '';
    if (!isUuid(tripId)) throw new SeatMapValidationError('Trip ID must be a valid UUID.');
    if (request.holdToken && !/^[A-Za-z0-9._-]{16,256}$/.test(request.holdToken)) {
      throw new SeatMapValidationError('Hold token format is invalid.');
    }

    const layout = await this.catalogClient.getTripLayout(tripId, request.requestId);
    const [durableStates, activeHolds] = await Promise.all([
      this.seatStateRepository.listByTrip(tripId),
      this.seatHoldStore.getSeatHolds(
        tripId,
        layout.seats.map((seat) => seat.id),
        request.holdToken,
      ),
    ]);
    return {
      seatMap: composeSeatMap(layout, durableStates, activeHolds),
      requestId: request.requestId ?? 'missing-request-id',
    };
  }

  async holdSeats(request: HoldSeatsRequest): Promise<HoldSeatsResponse> {
    const validated = validateHoldRequest(request);
    const [layout, durableStates] = await Promise.all([
      this.catalogClient.getTripLayout(validated.tripId, request.requestId),
      this.seatStateRepository.listByTrip(validated.tripId),
    ]);
    const layoutSeatIds = new Set(layout.seats.map((seat) => seat.id));
    if (validated.seatIds.some((seatId) => !layoutSeatIds.has(seatId))) {
      throw new SeatMapValidationError('Every requested seat must exist in the trip layout.');
    }
    const durableBySeat = new Map(durableStates.map((state) => [state.seatId, state.status]));
    const unavailable = validated.seatIds.filter((seatId) => durableBySeat.has(seatId));
    if (unavailable.length > 0) throw new SeatUnavailableError(unavailable);

    const expiresAt = new Date(Date.now() + validated.ttlSeconds * 1_000).toISOString();
    const hold: ActiveSeatHold = {
      token: randomUUID(),
      tripId: validated.tripId,
      seatIds: validated.seatIds,
      owner: validated.owner,
      idempotencyKey: validated.idempotencyKey,
      expiresAt,
      unitPriceVnd: layout.priceVnd,
      totalPriceVnd: layout.priceVnd * validated.seatIds.length,
    };
    const result = await this.seatHoldStore.acquire(
      hold,
      holdFingerprint(hold),
      validated.ttlSeconds,
    );
    if (result.status === 'SEAT_UNAVAILABLE') {
      throw new SeatUnavailableError([result.seatId]);
    }
    if (result.status === 'IDEMPOTENCY_CONFLICT') throw new IdempotencyConflictError();
    return {
      hold: toHoldView(result.hold),
      requestId: request.requestId ?? 'missing-request-id',
    };
  }

  async getHold(request: GetHoldRequest): Promise<GetHoldResponse> {
    const holdToken = request.holdToken ?? '';
    validateHoldToken(holdToken);
    const owner = validateOwner(request.owner);
    const hold = await this.seatHoldStore.get(holdToken);
    if (!hold) throw new HoldExpiredError();
    if (hold.owner.type !== owner.type || hold.owner.id !== owner.id) {
      throw new HoldOwnershipError();
    }
    return {
      hold: toHoldView(hold),
      requestId: request.requestId ?? 'missing-request-id',
    };
  }

  async releaseHold(request: ReleaseHoldRequest): Promise<ReleaseHoldResponse> {
    const holdToken = request.holdToken ?? '';
    validateHoldToken(holdToken);
    const owner = validateOwner(request.owner);
    validateIdempotencyKey(request.idempotencyKey);
    const result = await this.seatHoldStore.release(holdToken, owner);
    if (result.status !== 'RELEASED') {
      return {
        released: false,
        seatIds: [],
        requestId: request.requestId ?? 'missing-request-id',
      };
    }
    return {
      released: true,
      tripId: result.hold.tripId,
      seatIds: result.hold.seatIds,
      releasedAt: new Date().toISOString(),
      requestId: request.requestId ?? 'missing-request-id',
    };
  }

  async confirmSeats(request: ConfirmSeatsRequest): Promise<ConfirmSeatsResponse> {
    const validated = validateConfirmRequest(request);
    const fingerprint = confirmationFingerprint(validated);
    const replay = await this.seatStateRepository.findConfirmation(
      validated.bookingId,
      validated.idempotencyKey,
    );
    if (replay) {
      if (replay.requestFingerprint !== fingerprint) {
        throw new SeatConfirmationIdempotencyConflictError();
      }
      return confirmationResponse(validated, replay.confirmedAt, request.requestId);
    }

    const hold = await this.seatHoldStore.get(validated.holdToken);
    if (!hold) throw new HoldExpiredError();
    if (hold.owner.type !== validated.owner.type || hold.owner.id !== validated.owner.id) {
      throw new HoldOwnershipError();
    }
    if (hold.tripId !== validated.tripId || !sameSeatSet(hold.seatIds, validated.seatIds)) {
      throw new SeatMapValidationError('Seat confirmation must exactly match the active hold.');
    }

    const confirmedAt = new Date().toISOString();
    let persisted;
    try {
      persisted = await this.seatStateRepository.confirmSeats({
        bookingId: validated.bookingId,
        tripId: validated.tripId,
        seatIds: validated.seatIds,
        idempotencyKey: validated.idempotencyKey,
        requestFingerprint: fingerprint,
        holdTokenHash: createHash('sha256').update(validated.holdToken).digest('hex'),
        confirmedAt,
      });
    } catch (error) {
      if (error instanceof SeatConfirmationUnavailablePersistenceError) {
        throw new SeatUnavailableError(validated.seatIds);
      }
      throw error;
    }
    if (persisted.requestFingerprint !== fingerprint) {
      throw new SeatConfirmationIdempotencyConflictError();
    }

    try {
      const consumed = await this.seatHoldStore.consumeConfirmedHold(
        validated.holdToken,
        validated.owner,
      );
      if (consumed.status === 'OWNER_MISMATCH') throw new HoldOwnershipError();
    } catch (error) {
      logEvent({
        service: 'seat-inventory-service',
        level: 'error',
        event: 'seat-confirmation.redis-cleanup.failed',
        message: 'Durable seats were confirmed but Redis hold cleanup failed.',
        requestId: request.requestId,
        fields: {
          tripId: validated.tripId,
          bookingId: validated.bookingId,
          seatCount: validated.seatIds.length,
          reason: error instanceof Error ? error.name : 'UnknownError',
        },
      });
    }

    return confirmationResponse(validated, persisted.confirmedAt, request.requestId);
  }

  async releaseBookedSeats(
    request: ReleaseBookedSeatsRequest,
  ): Promise<ReleaseBookedSeatsResponse> {
    const validated = validateReleaseBookedSeatsRequest(request);
    const fingerprint = releaseFingerprint(validated);
    let persisted;
    try {
      persisted = await this.seatStateRepository.releaseBookedSeats({
        ...validated,
        requestFingerprint: fingerprint,
        releasedAt: new Date().toISOString(),
      });
    } catch (error) {
      if (error instanceof SeatReleaseMismatchPersistenceError) {
        throw new SeatUnavailableError(validated.seatIds);
      }
      throw error;
    }
    if (
      persisted.requestFingerprint !== fingerprint ||
      persisted.idempotencyKey !== validated.idempotencyKey
    ) {
      throw new SeatReleaseIdempotencyConflictError();
    }
    try {
      await this.seatHoldStore.publishAvailableSeats(
        validated.tripId,
        validated.seatIds,
        persisted.releasedAt,
      );
    } catch (error) {
      logEvent({
        service: 'seat-inventory-service',
        level: 'error',
        event: 'seat-release.redis-notification.failed',
        message: 'Booked seats were released but realtime notification failed.',
        requestId: request.requestId,
        fields: {
          bookingId: validated.bookingId,
          tripId: validated.tripId,
          seatCount: validated.seatIds.length,
          reason: error instanceof Error ? error.name : 'UnknownError',
        },
      });
    }
    return {
      released: true,
      bookingId: validated.bookingId,
      tripId: validated.tripId,
      seatIds: validated.seatIds,
      releasedAt: persisted.releasedAt,
      requestId: request.requestId ?? 'missing-request-id',
    };
  }

  async setSeatBlocked(request: SetSeatBlockedRequest): Promise<SetSeatBlockedResponse> {
    const validated = validateSeatBlockRequest(request);
    const layout = await this.catalogClient.getTripLayout(validated.tripId, request.requestId);
    const layoutSeatIds = new Set(layout.seats.map((seat) => seat.id));
    if (validated.seatIds.some((seatId) => !layoutSeatIds.has(seatId))) {
      throw new SeatMapValidationError('Every requested seat must exist in the trip layout.');
    }
    const requestFingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          tripId: validated.tripId,
          seatIds: validated.seatIds,
          blocked: validated.blocked,
          reason: validated.reason,
        }),
      )
      .digest('hex');
    let record;
    try {
      record = await this.seatStateRepository.setSeatBlocked({
        ...validated,
        requestFingerprint,
        requestId: request.requestId ?? 'missing-request-id',
        traceId: request.traceId ?? 'unavailable',
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      if (error instanceof SeatBlockBookedPersistenceError) {
        throw new SeatUnavailableError(validated.seatIds);
      }
      throw error;
    }
    if (record.requestFingerprint !== requestFingerprint) {
      throw new SeatBlockIdempotencyConflictError();
    }
    if (record.changed) {
      try {
        if (record.blocked) {
          await this.seatHoldStore.publishBlockedSeats(
            record.tripId,
            record.seatIds,
            record.updatedAt,
          );
        } else {
          await this.seatHoldStore.publishAvailableSeats(
            record.tripId,
            record.seatIds,
            record.updatedAt,
          );
        }
      } catch {
        logEvent({
          service: 'seat-inventory-service',
          level: 'error',
          event: 'seat-block.redis-notification.failed',
          message: 'Seat block state committed but realtime notification failed.',
          requestId: request.requestId,
          fields: { tripId: record.tripId, seatCount: record.seatIds.length },
        });
      }
    }
    return { ...record, requestId: request.requestId ?? 'missing-request-id' };
  }
}

function validateSeatBlockRequest(request: SetSeatBlockedRequest) {
  if (!request.actor || request.actor.role !== 'ADMIN' || !isUuid(request.actor.id)) {
    throw new SeatAdminForbiddenError();
  }
  const tripId = request.tripId ?? '';
  if (!isUuid(tripId)) throw new SeatMapValidationError('Trip ID must be a valid UUID.');
  const seatIds = [...new Set(request.seatIds ?? [])].sort();
  if (
    seatIds.length < 1 ||
    seatIds.length > 100 ||
    seatIds.length !== (request.seatIds ?? []).length ||
    seatIds.some((seatId) => !/^[A-Za-z0-9._-]{1,64}$/.test(seatId))
  ) {
    throw new SeatMapValidationError('Seat IDs must contain 1 to 100 unique valid values.');
  }
  if (typeof request.blocked !== 'boolean') {
    throw new SeatMapValidationError('Blocked must be a boolean.');
  }
  const reason = request.reason?.trim() ?? '';
  if (request.blocked && (reason.length < 2 || reason.length > 200)) {
    throw new SeatMapValidationError('Block reason must contain between 2 and 200 characters.');
  }
  const idempotencyKey = validateIdempotencyKey(request.idempotencyKey);
  return {
    tripId,
    seatIds,
    blocked: request.blocked,
    reason: request.blocked ? reason : 'UNBLOCKED',
    actorId: request.actor.id,
    idempotencyKey,
  };
}

function validateReleaseBookedSeatsRequest(request: ReleaseBookedSeatsRequest) {
  const bookingId = request.bookingId ?? '';
  const tripId = request.tripId ?? '';
  if (!isUuid(bookingId)) throw new SeatMapValidationError('Booking ID must be a valid UUID.');
  if (!isUuid(tripId)) throw new SeatMapValidationError('Trip ID must be a valid UUID.');
  const seatIds = [...new Set(request.seatIds ?? [])].sort();
  if (
    seatIds.length < 1 ||
    seatIds.length > 10 ||
    seatIds.length !== (request.seatIds ?? []).length ||
    seatIds.some((seatId) => !/^[A-Za-z0-9._-]{1,64}$/.test(seatId))
  ) {
    throw new SeatMapValidationError('Seat IDs must contain 1 to 10 unique valid values.');
  }
  return {
    bookingId,
    tripId,
    seatIds,
    idempotencyKey: validateIdempotencyKey(request.idempotencyKey),
  };
}

function releaseFingerprint(request: ReturnType<typeof validateReleaseBookedSeatsRequest>): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        bookingId: request.bookingId,
        tripId: request.tripId,
        seatIds: request.seatIds,
      }),
    )
    .digest('hex');
}

function validateConfirmRequest(request: ConfirmSeatsRequest) {
  const holdToken = request.holdToken ?? '';
  validateHoldToken(holdToken);
  const owner = validateOwner(request.owner);
  const tripId = request.tripId ?? '';
  const bookingId = request.bookingId ?? '';
  if (!isUuid(tripId)) throw new SeatMapValidationError('Trip ID must be a valid UUID.');
  if (!isUuid(bookingId)) throw new SeatMapValidationError('Booking ID must be a valid UUID.');
  const seatIds = [...new Set(request.seatIds ?? [])].sort();
  if (
    seatIds.length < 1 ||
    seatIds.length > 10 ||
    seatIds.length !== (request.seatIds ?? []).length ||
    seatIds.some((seatId) => !/^[A-Za-z0-9._-]{1,64}$/.test(seatId))
  ) {
    throw new SeatMapValidationError('Seat IDs must contain 1 to 10 unique valid values.');
  }
  const idempotencyKey = validateIdempotencyKey(request.idempotencyKey);
  return { holdToken, owner, tripId, seatIds, bookingId, idempotencyKey };
}

function confirmationFingerprint(request: ReturnType<typeof validateConfirmRequest>): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        holdTokenHash: createHash('sha256').update(request.holdToken).digest('hex'),
        owner: request.owner,
        tripId: request.tripId,
        seatIds: request.seatIds,
        bookingId: request.bookingId,
      }),
    )
    .digest('hex');
}

function confirmationResponse(
  request: ReturnType<typeof validateConfirmRequest>,
  confirmedAt: string,
  requestId?: string,
): ConfirmSeatsResponse {
  return {
    confirmed: true,
    tripId: request.tripId,
    seatIds: request.seatIds,
    bookingId: request.bookingId,
    confirmedAt,
    requestId: requestId ?? 'missing-request-id',
  };
}

function sameSeatSet(left: string[], right: string[]): boolean {
  const normalizedLeft = [...left].sort();
  return (
    normalizedLeft.length === right.length &&
    normalizedLeft.every((seatId, index) => seatId === right[index])
  );
}

function composeSeatMap(
  layout: CatalogTripLayout,
  durableStates: DurableSeatState[],
  activeHolds: Map<string, { heldByRequester: boolean }>,
) {
  const stateBySeat = new Map(durableStates.map((state) => [state.seatId, state.status]));
  return {
    tripId: layout.tripId,
    layoutId: layout.layoutId,
    layoutVersion: layout.layoutVersion,
    layoutName: layout.layoutName,
    deckCount: layout.deckCount,
    seats: layout.seats.map((seat) => {
      const durableStatus = stateBySeat.get(seat.id);
      const activeHold = activeHolds.get(seat.id);
      return {
        ...seat,
        status: durableStatus ?? (activeHold ? ('HELD' as const) : ('AVAILABLE' as const)),
        heldByRequester: !durableStatus && Boolean(activeHold?.heldByRequester),
      };
    }),
    generatedAt: new Date().toISOString(),
  };
}

function validateHoldRequest(request: HoldSeatsRequest) {
  const tripId = request.tripId ?? '';
  if (!isUuid(tripId)) throw new SeatMapValidationError('Trip ID must be a valid UUID.');
  const seatIds = [...new Set(request.seatIds ?? [])].sort();
  if (
    seatIds.length === 0 ||
    seatIds.length > 10 ||
    seatIds.length !== (request.seatIds ?? []).length ||
    seatIds.some((seatId) => !/^[A-Za-z0-9._-]{1,64}$/.test(seatId))
  ) {
    throw new SeatMapValidationError('Seat IDs must contain 1 to 10 unique valid values.');
  }
  const owner = validateOwner(request.owner);
  const idempotencyKey = validateIdempotencyKey(request.idempotencyKey);
  const ttlSeconds = request.requestedTtlSeconds ?? 300;
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 300) {
    throw new SeatMapValidationError('Hold TTL must be between 1 and 300 seconds.');
  }
  return { tripId, seatIds, owner, idempotencyKey, ttlSeconds };
}

function validateIdempotencyKey(value: string | undefined): string {
  const idempotencyKey = value ?? '';
  if (!/^[A-Za-z0-9._-]{16,128}$/.test(idempotencyKey)) {
    throw new SeatMapValidationError('Idempotency key format is invalid.');
  }
  return idempotencyKey;
}

function validateOwner(owner: HoldOwner | undefined): HoldOwner {
  if (!owner || !['GUEST_SESSION', 'CUSTOMER'].includes(owner.type) || !isUuid(owner.id)) {
    throw new SeatMapValidationError('A valid hold owner is required.');
  }
  return owner;
}

function validateHoldToken(value: string): void {
  if (!/^[A-Za-z0-9._-]{16,256}$/.test(value)) {
    throw new SeatMapValidationError('Hold token format is invalid.');
  }
}

function holdFingerprint(hold: ActiveSeatHold): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        tripId: hold.tripId,
        seatIds: hold.seatIds,
        owner: hold.owner,
        unitPriceVnd: hold.unitPriceVnd,
      }),
    )
    .digest('hex');
}

function toHoldView(hold: ActiveSeatHold): SeatHoldView {
  const remainingTtlSeconds = Math.max(
    0,
    Math.ceil((Date.parse(hold.expiresAt) - Date.now()) / 1_000),
  );
  return {
    ...hold,
    remainingTtlSeconds,
    status: remainingTtlSeconds > 0 ? 'ACTIVE' : 'EXPIRED',
  };
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
