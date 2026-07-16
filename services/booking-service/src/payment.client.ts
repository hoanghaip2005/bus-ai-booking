import { activePropagationHeaders, createRequestId, logEvent } from '@bus/observability';
import { Metadata, status } from '@grpc/grpc-js';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom, type Observable, timeout } from 'rxjs';

import type { CheckoutOwner } from './booking.types';

interface PaymentHealthResponse {
  status: string;
}

interface PaymentAttemptResponse {
  attempt?: {
    id: string;
    bookingId: string;
    status: number | string;
    amountVnd: number;
    failureCode?: string;
    createdAt: string;
  };
}

interface PaymentClientContract {
  health(input: { requestId: string }, metadata?: Metadata): Observable<PaymentHealthResponse>;
  createPaymentAttempt(
    input: {
      bookingId: string;
      owner: { type: 1 | 2; id: string };
      amountVnd: number;
      requestedOutcome: 1 | 2;
      idempotencyKey: string;
      requestId: string;
    },
    metadata?: Metadata,
  ): Observable<PaymentAttemptResponse>;
}

export interface BookingPaymentAttempt {
  id: string;
  status: 'SUCCEEDED' | 'FAILED';
  amountVnd: number;
  failureCode?: string;
  createdAt: string;
}

export class PaymentDependencyError extends Error {
  constructor(options?: ErrorOptions) {
    super('Payment Service is unavailable.', options);
    this.name = 'PaymentDependencyError';
  }
}

export class PaymentIdempotencyError extends Error {
  constructor(options?: ErrorOptions) {
    super('Payment idempotency key conflicts with an earlier request.', options);
    this.name = 'PaymentIdempotencyError';
  }
}

@Injectable()
export class PaymentClient implements OnModuleInit {
  private client?: PaymentClientContract;

  constructor(@Inject('PAYMENT_GRPC') private readonly grpcClient: ClientGrpc) {}

  onModuleInit(): void {
    this.client = this.grpcClient.getService<PaymentClientContract>('PaymentService');
  }

  async readiness(requestId?: string): Promise<void> {
    const correlationId = createRequestId(requestId);
    const response = await this.call(
      (client, metadata) => client.health({ requestId: correlationId }, metadata),
      correlationId,
    );
    if (response.status !== 'UP') throw new PaymentDependencyError();
  }

  async createPaymentAttempt(input: {
    bookingId: string;
    owner: CheckoutOwner;
    amountVnd: number;
    outcome: 'SUCCESS' | 'FAILURE';
    idempotencyKey: string;
    requestId?: string;
  }): Promise<BookingPaymentAttempt> {
    const correlationId = createRequestId(input.requestId);
    try {
      const response = await this.call(
        (client, metadata) =>
          client.createPaymentAttempt(
            {
              bookingId: input.bookingId,
              owner: { type: input.owner.type === 'GUEST_SESSION' ? 1 : 2, id: input.owner.id },
              amountVnd: input.amountVnd,
              requestedOutcome: input.outcome === 'SUCCESS' ? 1 : 2,
              idempotencyKey: input.idempotencyKey,
              requestId: correlationId,
            },
            metadata,
          ),
        correlationId,
      );
      const attempt = response.attempt;
      if (
        !attempt ||
        attempt.bookingId !== input.bookingId ||
        attempt.amountVnd !== input.amountVnd
      ) {
        throw new PaymentDependencyError();
      }
      return {
        id: attempt.id,
        status: mapStatus(attempt.status),
        amountVnd: attempt.amountVnd,
        ...(attempt.failureCode !== undefined && { failureCode: attempt.failureCode }),
        createdAt: attempt.createdAt,
      };
    } catch (error) {
      if (error instanceof PaymentDependencyError) throw error;
      if (isGrpcCode(error, status.ABORTED)) throw new PaymentIdempotencyError({ cause: error });
      logEvent({
        service: 'booking-service',
        level: 'error',
        event: 'payment.create-attempt.failed',
        message: 'Payment attempt request failed.',
        requestId: correlationId,
        fields: { dependency: 'payment-service', bookingId: input.bookingId },
      });
      throw new PaymentDependencyError({ cause: error });
    }
  }

  private async call<T>(
    operation: (client: PaymentClientContract, metadata: Metadata) => Observable<T>,
    requestId: string,
  ): Promise<T> {
    if (!this.client) throw new PaymentDependencyError();
    const metadata = new Metadata();
    metadata.set('x-request-id', requestId);
    for (const [key, value] of Object.entries(activePropagationHeaders())) metadata.set(key, value);
    return firstValueFrom(operation(this.client, metadata).pipe(timeout(3_000)));
  }
}

function mapStatus(value: number | string): 'SUCCEEDED' | 'FAILED' {
  if (value === 1 || value === 'PAYMENT_ATTEMPT_STATUS_SUCCEEDED' || value === 'SUCCEEDED') {
    return 'SUCCEEDED';
  }
  if (value === 2 || value === 'PAYMENT_ATTEMPT_STATUS_FAILED' || value === 'FAILED') {
    return 'FAILED';
  }
  throw new PaymentDependencyError();
}

function isGrpcCode(error: unknown, code: number): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}
