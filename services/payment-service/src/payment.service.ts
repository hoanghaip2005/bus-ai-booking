import { createHash, randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { PaymentDatabase } from './payment.database';
import { createPaymentAttemptedDispatch } from './payment.events';
import { PaymentRepository } from './payment.repository';
import type {
  CreatePaymentAttemptRequest,
  PaymentAttemptView,
  PaymentOwner,
  PersistPaymentAttemptInput,
  ValidatedPaymentAttemptRequest,
} from './payment.types';

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

export interface CreatePaymentAttemptResponse {
  attempt: PaymentAttemptView;
  requestId: string;
}

export class PaymentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentValidationError';
  }
}

export class PaymentIdempotencyConflictError extends Error {
  constructor() {
    super('Idempotency key was already used for a different payment request.');
    this.name = 'PaymentIdempotencyConflictError';
  }
}

@Injectable()
export class PaymentService {
  constructor(
    @Inject(PaymentDatabase) private readonly database: PaymentDatabase,
    @Inject(PaymentRepository) private readonly repository: PaymentRepository,
  ) {}

  health(request: HealthRequest, traceId = 'unavailable'): HealthResponse {
    return {
      service: 'payment-service',
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

  async createPaymentAttempt(
    request: CreatePaymentAttemptRequest,
  ): Promise<CreatePaymentAttemptResponse> {
    const validated = validatePaymentAttemptRequest(request);
    const replay = await this.repository.findByIdempotency(
      validated.bookingId,
      validated.idempotencyKey,
    );
    if (replay) {
      if (replay.requestFingerprint !== validated.requestFingerprint) {
        throw new PaymentIdempotencyConflictError();
      }
      return { attempt: replay.attempt, requestId: request.requestId ?? 'missing-request-id' };
    }

    const persistInput = toPersistInput(validated, request.requestId);
    const persisted = await this.repository.createOrReplay(
      persistInput,
      createPaymentAttemptedDispatch(persistInput),
    );
    if (persisted.requestFingerprint !== validated.requestFingerprint) {
      throw new PaymentIdempotencyConflictError();
    }
    return {
      attempt: persisted.attempt,
      requestId: request.requestId ?? 'missing-request-id',
    };
  }
}

export function validatePaymentAttemptRequest(
  request: CreatePaymentAttemptRequest,
): ValidatedPaymentAttemptRequest {
  const bookingId = request.bookingId ?? '';
  if (!isUuid(bookingId)) throw new PaymentValidationError('Booking ID must be a valid UUID.');
  const owner = validateOwner(request.owner);
  const amountVnd = request.amountVnd ?? 0;
  if (!Number.isInteger(amountVnd) || amountVnd < 1 || amountVnd > 2_147_483_647) {
    throw new PaymentValidationError('Payment amount must be a positive integer VND value.');
  }
  const requestedOutcome = request.requestedOutcome;
  if (requestedOutcome !== 'SUCCESS' && requestedOutcome !== 'FAILURE') {
    throw new PaymentValidationError('Requested payment outcome is invalid.');
  }
  const idempotencyKey = request.idempotencyKey?.trim() ?? '';
  if (!/^[A-Za-z0-9._-]{16,128}$/.test(idempotencyKey)) {
    throw new PaymentValidationError('Idempotency key format is invalid.');
  }
  const requestFingerprint = createHash('sha256')
    .update(JSON.stringify({ bookingId, owner, amountVnd, requestedOutcome }))
    .digest('hex');
  return { bookingId, owner, amountVnd, requestedOutcome, idempotencyKey, requestFingerprint };
}

function toPersistInput(
  request: ValidatedPaymentAttemptRequest,
  requestId?: string,
): PersistPaymentAttemptInput {
  const failed = request.requestedOutcome === 'FAILURE';
  return {
    ...request,
    id: randomUUID(),
    status: failed ? 'FAILED' : 'SUCCEEDED',
    ...(failed && { failureCode: 'SIMULATED_FAILURE' }),
    createdAt: new Date().toISOString(),
    ...(requestId !== undefined && { requestId }),
  };
}

function validateOwner(owner: PaymentOwner | undefined): PaymentOwner {
  if (!owner || !['GUEST_SESSION', 'CUSTOMER'].includes(owner.type) || !isUuid(owner.id)) {
    throw new PaymentValidationError('A valid payment owner is required.');
  }
  return owner;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
