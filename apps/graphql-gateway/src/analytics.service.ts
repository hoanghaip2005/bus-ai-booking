import { activePropagationHeaders, createRequestId } from '@bus/observability';
import { Metadata, status } from '@grpc/grpc-js';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom, type Observable, timeout } from 'rxjs';

export interface AnalyticsAdminActor {
  id: string;
  role: 'ADMIN';
  tokenId: string;
}

export interface RevenueSummaryGatewayResponse {
  days: Array<{
    localDate: string;
    revenueVnd: number | string;
    paidBookingCount: number;
    ticketCount: number;
  }>;
  totalRevenueVnd: number | string;
  paidBookingCount: number;
  ticketCount: number;
  lastProcessedAt?: string;
  timezone: string;
  requestId: string;
}

export interface PopularRoutesGatewayResponse {
  routes: Array<{
    routeId: string;
    routeCode: string;
    routeLabel: string;
    searchCount: number;
    paidBookingCount: number;
    conversionRate: number;
  }>;
  lastProcessedAt?: string;
  timezone: string;
  requestId: string;
}

export interface SearchConversionGatewayResponse {
  searchCount: number;
  paidBookingCount: number;
  conversionRate: number;
  lastProcessedAt?: string;
  timezone: string;
  requestId: string;
}

export interface TicketSalesGatewayResponse {
  routes: Array<{
    routeId: string;
    routeCode: string;
    routeLabel: string;
    paidBookingCount: number;
    ticketCount: number;
    revenueVnd: number | string;
  }>;
  lastProcessedAt?: string;
  timezone: string;
  requestId: string;
}

export interface PaymentSummaryGatewayResponse {
  attemptCount: number;
  succeededCount: number;
  failedCount: number;
  successRate: number;
  succeededAmountVnd: number | string;
  consumerLag?: {
    available: boolean;
    totalLag: number | string;
    topics?: Array<{ topic: string; lag: number | string }>;
  };
  lastProcessedAt?: string;
  timezone: string;
  requestId: string;
}

interface AnalyticsClientContract {
  getRevenueSummary(
    input: { fromDate: string; toDate: string; requestId: string },
    metadata?: Metadata,
  ): Observable<RevenueSummaryGatewayResponse>;
  getPopularRoutes(
    input: { fromDate: string; toDate: string; limit: number; requestId: string },
    metadata?: Metadata,
  ): Observable<PopularRoutesGatewayResponse>;
  getSearchConversion(
    input: { fromDate: string; toDate: string; requestId: string },
    metadata?: Metadata,
  ): Observable<SearchConversionGatewayResponse>;
  getTicketSalesByRoute(
    input: { fromDate: string; toDate: string; limit: number; requestId: string },
    metadata?: Metadata,
  ): Observable<TicketSalesGatewayResponse>;
  getPaymentSummary(
    input: { fromDate: string; toDate: string; requestId: string },
    metadata?: Metadata,
  ): Observable<PaymentSummaryGatewayResponse>;
}

export class AnalyticsDependencyError extends Error {
  constructor(
    readonly requestId: string,
    options?: ErrorOptions,
  ) {
    super('Analytics Service is unavailable.', options);
  }
}

export class AnalyticsForbiddenError extends Error {
  constructor(readonly requestId: string) {
    super('Admin role is required.');
  }
}

export class AnalyticsValidationGatewayError extends Error {
  constructor(
    readonly requestId: string,
    message: string,
  ) {
    super(message);
  }
}

@Injectable()
export class AnalyticsGatewayService implements OnModuleInit {
  private client?: AnalyticsClientContract;

  constructor(@Inject('ANALYTICS_GRPC') private readonly grpcClient: ClientGrpc) {}

  onModuleInit(): void {
    this.client = this.grpcClient.getService<AnalyticsClientContract>('AnalyticsQueryService');
  }

  async getRevenueSummary(
    input: { fromDate: string; toDate: string },
    actor: AnalyticsAdminActor,
    requestId?: string,
  ): Promise<RevenueSummaryGatewayResponse> {
    const correlationId = createRequestId(requestId);
    const metadata = new Metadata();
    metadata.set('x-request-id', correlationId);
    metadata.set('x-actor-id', actor.id);
    metadata.set('x-actor-role', actor.role);
    metadata.set('x-actor-token-id', actor.tokenId);
    for (const [key, value] of Object.entries(activePropagationHeaders())) metadata.set(key, value);
    try {
      if (!this.client) throw new Error('Analytics gRPC client is not initialized.');
      return await firstValueFrom(
        this.client
          .getRevenueSummary({ ...input, requestId: correlationId }, metadata)
          .pipe(timeout(5_000)),
      );
    } catch (error) {
      const code = grpcCode(error);
      if (code === status.PERMISSION_DENIED) throw new AnalyticsForbiddenError(correlationId);
      if (code === status.INVALID_ARGUMENT) {
        throw new AnalyticsValidationGatewayError(correlationId, grpcMessage(error));
      }
      throw new AnalyticsDependencyError(correlationId, { cause: error });
    }
  }

  getPopularRoutes(
    input: { fromDate: string; toDate: string; limit: number },
    actor: AnalyticsAdminActor,
    requestId?: string,
  ): Promise<PopularRoutesGatewayResponse> {
    return this.call('getPopularRoutes', input, actor, requestId);
  }

  getSearchConversion(
    input: { fromDate: string; toDate: string },
    actor: AnalyticsAdminActor,
    requestId?: string,
  ): Promise<SearchConversionGatewayResponse> {
    return this.call('getSearchConversion', input, actor, requestId);
  }

  getTicketSalesByRoute(
    input: { fromDate: string; toDate: string; limit: number },
    actor: AnalyticsAdminActor,
    requestId?: string,
  ): Promise<TicketSalesGatewayResponse> {
    return this.call('getTicketSalesByRoute', input, actor, requestId);
  }

  getPaymentSummary(
    input: { fromDate: string; toDate: string },
    actor: AnalyticsAdminActor,
    requestId?: string,
  ): Promise<PaymentSummaryGatewayResponse> {
    return this.call('getPaymentSummary', input, actor, requestId);
  }

  private async call<Response>(
    method:
      'getPopularRoutes' | 'getSearchConversion' | 'getTicketSalesByRoute' | 'getPaymentSummary',
    input: Record<string, unknown>,
    actor: AnalyticsAdminActor,
    requestId?: string,
  ): Promise<Response> {
    const correlationId = createRequestId(requestId);
    const metadata = actorMetadata(actor, correlationId);
    try {
      if (!this.client) throw new Error('Analytics gRPC client is not initialized.');
      const rpc = this.client[method] as (
        value: Record<string, unknown>,
        metadata?: Metadata,
      ) => Observable<Response>;
      return await firstValueFrom(
        rpc
          .call(this.client, { ...input, requestId: correlationId }, metadata)
          .pipe(timeout(5_000)),
      );
    } catch (error) {
      throw mapAnalyticsError(error, correlationId);
    }
  }
}

function actorMetadata(actor: AnalyticsAdminActor, requestId: string): Metadata {
  const metadata = new Metadata();
  metadata.set('x-request-id', requestId);
  metadata.set('x-actor-id', actor.id);
  metadata.set('x-actor-role', actor.role);
  metadata.set('x-actor-token-id', actor.tokenId);
  for (const [key, value] of Object.entries(activePropagationHeaders())) metadata.set(key, value);
  return metadata;
}

function mapAnalyticsError(error: unknown, requestId: string): Error {
  const code = grpcCode(error);
  if (code === status.PERMISSION_DENIED) return new AnalyticsForbiddenError(requestId);
  if (code === status.INVALID_ARGUMENT) {
    return new AnalyticsValidationGatewayError(requestId, grpcMessage(error));
  }
  return new AnalyticsDependencyError(requestId, { cause: error });
}

function grpcCode(error: unknown): number | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? Number((error as { code: unknown }).code)
    : undefined;
}

function grpcMessage(error: unknown): string {
  return error instanceof Error ? error.message.replace(/^\d+ [A-Z_]+: /, '') : 'Invalid request.';
}
