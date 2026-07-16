import { activePropagationHeaders, createRequestId, logEvent } from '@bus/observability';
import {
  AnalyticsQueryServiceClient,
  type GetPublicPopularRoutesResponse,
  type GetPopularRoutesResponse,
  type GetRevenueSummaryResponse,
  type HealthResponse,
} from '@bus/contracts-proto/generated/analytics';
import { credentials, Metadata, status, type CallOptions, type ServiceError } from '@grpc/grpc-js';

import type { McpActor } from './identity-client.js';

export class McpAnalyticsError extends Error {
  constructor(
    readonly code: 'FORBIDDEN' | 'INVALID_INPUT' | 'DEPENDENCY_UNAVAILABLE',
    options?: ErrorOptions,
  ) {
    super('Analytics request could not be completed.', options);
    this.name = 'McpAnalyticsError';
  }
}

export interface RevenueSummary {
  days: Array<{
    localDate: string;
    revenueVnd: number;
    paidBookingCount: number;
    ticketCount: number;
  }>;
  totalRevenueVnd: number;
  paidBookingCount: number;
  ticketCount: number;
  lastProcessedAt?: string;
  timezone: string;
}

export interface PopularRoutes {
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
}

export interface PublicPopularRoutes {
  routes: Array<{
    routeId: string;
    routeCode: string;
    routeLabel: string;
    searchCount: number;
  }>;
  fromDate: string;
  toDate: string;
  lastProcessedAt?: string;
  timezone: string;
}

export interface AnalyticsClient {
  readiness(requestId?: string): Promise<void>;
  getRevenueSummary(
    input: { fromDate: string; toDate: string },
    actor: McpActor,
    requestId?: string,
  ): Promise<RevenueSummary>;
  getPopularRoutes(
    input: { fromDate: string; toDate: string; limit: number },
    actor: McpActor,
    requestId?: string,
  ): Promise<PopularRoutes>;
  getPublicPopularRoutes(
    input: { fromDate: string; toDate: string; limit: number },
    requestId?: string,
  ): Promise<PublicPopularRoutes>;
}

export class GrpcAnalyticsClient implements AnalyticsClient {
  private readonly client: InstanceType<typeof AnalyticsQueryServiceClient>;

  constructor(
    address = process.env.ANALYTICS_GRPC_URL ?? '127.0.0.1:50057',
    private readonly timeoutMs = 3_000,
  ) {
    this.client = new AnalyticsQueryServiceClient(address, credentials.createInsecure());
  }

  async readiness(requestId?: string): Promise<void> {
    const correlationId = createRequestId(requestId);
    try {
      const response = await this.call<HealthResponse>(
        (metadata, options, callback) =>
          this.client.health({ requestId: correlationId }, metadata, options, callback),
        correlationId,
      );
      if (response.status !== 'UP') throw new McpAnalyticsError('DEPENDENCY_UNAVAILABLE');
    } catch (error) {
      this.normalizeError(error, correlationId, 'health');
    }
  }

  async getRevenueSummary(
    input: { fromDate: string; toDate: string },
    actor: McpActor,
    requestId?: string,
  ): Promise<RevenueSummary> {
    const correlationId = createRequestId(requestId);
    try {
      const response = await this.call<GetRevenueSummaryResponse>(
        (metadata, options, callback) =>
          this.client.getRevenueSummary(
            { ...input, requestId: correlationId },
            actorMetadata(metadata, actor),
            options,
            callback,
          ),
        correlationId,
      );
      return {
        days: response.days ?? [],
        totalRevenueVnd: response.totalRevenueVnd,
        paidBookingCount: response.paidBookingCount,
        ticketCount: response.ticketCount,
        ...(response.lastProcessedAt && { lastProcessedAt: response.lastProcessedAt }),
        timezone: response.timezone,
      };
    } catch (error) {
      this.normalizeError(error, correlationId, 'getRevenueSummary');
    }
  }

  async getPopularRoutes(
    input: { fromDate: string; toDate: string; limit: number },
    actor: McpActor,
    requestId?: string,
  ): Promise<PopularRoutes> {
    const correlationId = createRequestId(requestId);
    try {
      const response = await this.call<GetPopularRoutesResponse>(
        (metadata, options, callback) =>
          this.client.getPopularRoutes(
            { ...input, requestId: correlationId },
            actorMetadata(metadata, actor),
            options,
            callback,
          ),
        correlationId,
      );
      return {
        routes: response.routes ?? [],
        ...(response.lastProcessedAt && { lastProcessedAt: response.lastProcessedAt }),
        timezone: response.timezone,
      };
    } catch (error) {
      this.normalizeError(error, correlationId, 'getPopularRoutes');
    }
  }

  async getPublicPopularRoutes(
    input: { fromDate: string; toDate: string; limit: number },
    requestId?: string,
  ): Promise<PublicPopularRoutes> {
    const correlationId = createRequestId(requestId);
    try {
      const response = await this.call<GetPublicPopularRoutesResponse>(
        (metadata, options, callback) =>
          this.client.getPublicPopularRoutes(
            { ...input, requestId: correlationId },
            metadata,
            options,
            callback,
          ),
        correlationId,
      );
      return {
        routes: response.routes ?? [],
        fromDate: response.fromDate,
        toDate: response.toDate,
        ...(response.lastProcessedAt && { lastProcessedAt: response.lastProcessedAt }),
        timezone: response.timezone,
      };
    } catch (error) {
      this.normalizeError(error, correlationId, 'getPublicPopularRoutes');
    }
  }

  private call<T>(
    operation: (
      metadata: Metadata,
      options: Partial<CallOptions>,
      callback: (error: ServiceError | null, response: T) => void,
    ) => void,
    requestId: string,
  ): Promise<T> {
    const metadata = new Metadata();
    metadata.set('x-request-id', requestId);
    for (const [key, value] of Object.entries(activePropagationHeaders())) metadata.set(key, value);
    return new Promise((resolve, reject) => {
      operation(metadata, { deadline: new Date(Date.now() + this.timeoutMs) }, (error, response) =>
        error ? reject(error) : resolve(response),
      );
    });
  }

  private normalizeError(error: unknown, requestId: string, operation: string): never {
    if (error instanceof McpAnalyticsError) throw error;
    const grpcCode =
      typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
    const code =
      grpcCode === status.PERMISSION_DENIED
        ? 'FORBIDDEN'
        : grpcCode === status.INVALID_ARGUMENT
          ? 'INVALID_INPUT'
          : 'DEPENDENCY_UNAVAILABLE';
    logEvent({
      service: 'mcp-server',
      level: code === 'DEPENDENCY_UNAVAILABLE' ? 'error' : 'info',
      event: `analytics.${operation}.failed`,
      message: 'MCP Analytics request failed.',
      requestId,
      fields: { code },
    });
    throw new McpAnalyticsError(code, { cause: error });
  }
}

function actorMetadata(metadata: Metadata, actor: McpActor): Metadata {
  metadata.set('x-actor-id', actor.id);
  metadata.set('x-actor-role', actor.role);
  metadata.set('x-actor-token-id', actor.tokenId);
  return metadata;
}
