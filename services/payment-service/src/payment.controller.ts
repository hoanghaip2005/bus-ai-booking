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

import type { RequestWithContext } from './request-context.middleware';
import {
  PaymentIdempotencyConflictError,
  PaymentService,
  PaymentValidationError,
  type CreatePaymentAttemptResponse,
  type HealthRequest,
  type HealthResponse,
} from './payment.service';
import type {
  CreatePaymentAttemptRequest,
  PaymentAttemptView,
  PaymentOwner,
} from './payment.types';

type GrpcPaymentOwner = { type?: number | string; id?: string };
type GrpcPaymentRequest = Omit<CreatePaymentAttemptRequest, 'owner' | 'requestedOutcome'> & {
  owner?: GrpcPaymentOwner;
  requestedOutcome?: number | string;
};
type GrpcPaymentResponse = Omit<CreatePaymentAttemptResponse, 'attempt'> & {
  attempt: Omit<PaymentAttemptView, 'status'> & { status: 1 | 2 };
};

@Controller()
export class PaymentController {
  constructor(@Inject(PaymentService) private readonly paymentService: PaymentService) {}

  @Get('health')
  httpHealth(@Req() request: RequestWithContext): HealthResponse {
    return this.httpLiveness(request);
  }

  @Get('health/live')
  httpLiveness(@Req() request: RequestWithContext): HealthResponse {
    return this.paymentService.health(
      { requestId: request.requestId },
      currentTraceContext().traceId ?? 'unavailable',
    );
  }

  @Get('health/ready')
  async httpReadiness(@Req() request: RequestWithContext): Promise<HealthResponse> {
    try {
      return await this.paymentService.readiness(
        { requestId: request.requestId },
        currentTraceContext().traceId ?? 'unavailable',
      );
    } catch {
      throw new ServiceUnavailableException({
        code: 'DEPENDENCY_UNAVAILABLE',
        message: 'Payment dependencies are unavailable.',
      });
    }
  }

  @GrpcMethod('PaymentService', 'Health')
  async grpcHealth(request: HealthRequest, metadata: Metadata): Promise<HealthResponse> {
    const requestId = grpcRequestId(request.requestId, metadata);
    return withRequestContext(requestId, async () => {
      try {
        return await this.paymentService.readiness(
          { requestId },
          currentTraceContext().traceId ?? 'unavailable',
        );
      } catch {
        throw new RpcException({ code: status.UNAVAILABLE, message: 'Payment unavailable.' });
      }
    });
  }

  @GrpcMethod('PaymentService', 'CreatePaymentAttempt')
  async grpcCreatePaymentAttempt(
    request: GrpcPaymentRequest,
    metadata: Metadata,
  ): Promise<GrpcPaymentResponse> {
    const requestId = grpcRequestId(request.requestId, metadata);
    return withRequestContext(requestId, async () => {
      const startedAt = performance.now();
      try {
        const response = await this.paymentService.createPaymentAttempt({
          ...request,
          owner: mapOwner(request.owner),
          requestedOutcome: mapOutcome(request.requestedOutcome),
          requestId,
        });
        logEvent({
          service: 'payment-service',
          event: 'grpc.payment.create-attempt',
          message: 'Simulated payment attempt created or replayed.',
          requestId,
          fields: {
            rpc: 'PaymentService.CreatePaymentAttempt',
            bookingId: response.attempt.bookingId,
            paymentAttemptId: response.attempt.id,
            status: response.attempt.status,
            amountVnd: response.attempt.amountVnd,
            ownerType: request.owner?.type,
            durationMs: Math.round(performance.now() - startedAt),
          },
        });
        return {
          ...response,
          attempt: {
            ...response.attempt,
            status: response.attempt.status === 'SUCCEEDED' ? 1 : 2,
          },
        };
      } catch (error) {
        logEvent({
          service: 'payment-service',
          level:
            error instanceof PaymentValidationError ||
            error instanceof PaymentIdempotencyConflictError
              ? 'warn'
              : 'error',
          event: 'grpc.payment.create-attempt.rejected',
          message: 'Simulated payment attempt was rejected.',
          requestId,
          fields: {
            rpc: 'PaymentService.CreatePaymentAttempt',
            bookingId: request.bookingId,
            reason: error instanceof Error ? error.name : 'UnknownError',
            durationMs: Math.round(performance.now() - startedAt),
          },
        });
        throwPaymentError(error);
      }
    });
  }
}

function grpcRequestId(requestId: string | undefined, metadata: Metadata): string {
  const metadataRequestId = metadata.get('x-request-id')[0];
  return createRequestId(typeof metadataRequestId === 'string' ? metadataRequestId : requestId);
}

function mapOwner(owner: GrpcPaymentOwner | undefined): PaymentOwner | undefined {
  if (!owner) return undefined;
  if (
    owner.type === 1 ||
    owner.type === 'PAYMENT_OWNER_TYPE_GUEST_SESSION' ||
    owner.type === 'GUEST_SESSION'
  ) {
    return { type: 'GUEST_SESSION', id: owner.id ?? '' };
  }
  if (
    owner.type === 2 ||
    owner.type === 'PAYMENT_OWNER_TYPE_CUSTOMER' ||
    owner.type === 'CUSTOMER'
  ) {
    return { type: 'CUSTOMER', id: owner.id ?? '' };
  }
  return undefined;
}

function mapOutcome(value: number | string | undefined): 'SUCCESS' | 'FAILURE' | undefined {
  if (value === 1 || value === 'REQUESTED_PAYMENT_OUTCOME_SUCCESS' || value === 'SUCCESS') {
    return 'SUCCESS';
  }
  if (value === 2 || value === 'REQUESTED_PAYMENT_OUTCOME_FAILURE' || value === 'FAILURE') {
    return 'FAILURE';
  }
  return undefined;
}

function throwPaymentError(error: unknown): never {
  if (error instanceof PaymentValidationError) {
    throw new RpcException({ code: status.INVALID_ARGUMENT, message: error.message });
  }
  if (error instanceof PaymentIdempotencyConflictError) {
    throw new RpcException({ code: status.ABORTED, message: error.message });
  }
  throw new RpcException({ code: status.UNAVAILABLE, message: 'Payment unavailable.' });
}
