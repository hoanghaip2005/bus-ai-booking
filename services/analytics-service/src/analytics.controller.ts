import { currentTraceContext, createRequestId, withRequestContext } from '@bus/observability';
import type { Metadata } from '@grpc/grpc-js';
import { status } from '@grpc/grpc-js';
import { Controller, Get, Inject, Req, ServiceUnavailableException } from '@nestjs/common';
import { GrpcMethod, RpcException } from '@nestjs/microservices';

import {
  AnalyticsAuthorizationError,
  AnalyticsService,
  AnalyticsValidationError,
} from './analytics.service';
import { AnalyticsConsumer } from './analytics.consumer';
import type { RequestWithContext } from './request-context.middleware';

@Controller()
export class AnalyticsController {
  constructor(
    @Inject(AnalyticsService) private readonly analyticsService: AnalyticsService,
    @Inject(AnalyticsConsumer) private readonly analyticsConsumer: AnalyticsConsumer,
  ) {}

  @Get('health')
  async health(@Req() request: RequestWithContext) {
    try {
      await this.analyticsService.readiness();
      return healthResponse(request.requestId ?? createRequestId());
    } catch {
      throw new ServiceUnavailableException({
        code: 'DEPENDENCY_UNAVAILABLE',
        message: 'Analytics dependencies are unavailable.',
      });
    }
  }

  @GrpcMethod('AnalyticsQueryService', 'Health')
  async grpcHealth(request: { requestId?: string }, metadata: Metadata) {
    const requestId = grpcRequestId(request.requestId, metadata);
    return withRequestContext(requestId, async () => {
      try {
        await this.analyticsService.readiness();
        return healthResponse(requestId);
      } catch {
        throw new RpcException({ code: status.UNAVAILABLE, message: 'Analytics unavailable.' });
      }
    });
  }

  @GrpcMethod('AnalyticsQueryService', 'GetRevenueSummary')
  async getRevenueSummary(
    request: { fromDate: string; toDate: string; requestId?: string },
    metadata: Metadata,
  ) {
    const requestId = grpcRequestId(request.requestId, metadata);
    return withRequestContext(requestId, async () => {
      try {
        return await this.analyticsService.getRevenueSummary(
          { fromDate: request.fromDate, toDate: request.toDate, requestId },
          {
            id: metadataValue(metadata, 'x-actor-id'),
            role: metadataValue(metadata, 'x-actor-role'),
            tokenId: metadataValue(metadata, 'x-actor-token-id'),
          },
        );
      } catch (error) {
        if (error instanceof AnalyticsAuthorizationError) {
          throw new RpcException({ code: status.PERMISSION_DENIED, message: error.message });
        }
        if (error instanceof AnalyticsValidationError) {
          throw new RpcException({ code: status.INVALID_ARGUMENT, message: error.message });
        }
        throw error;
      }
    });
  }

  @GrpcMethod('AnalyticsQueryService', 'GetPopularRoutes')
  async getPopularRoutes(
    request: { fromDate: string; toDate: string; limit: number; requestId?: string },
    metadata: Metadata,
  ) {
    const requestId = grpcRequestId(request.requestId, metadata);
    return withRequestContext(requestId, () =>
      this.mapQueryErrors(() =>
        this.analyticsService.getPopularRoutes({ ...request, requestId }, analyticsActor(metadata)),
      ),
    );
  }

  @GrpcMethod('AnalyticsQueryService', 'GetPublicPopularRoutes')
  async getPublicPopularRoutes(
    request: {
      fromDate: string;
      toDate: string;
      limit: number;
      requestId?: string;
    },
    metadata: Metadata,
  ) {
    const requestId = grpcRequestId(request.requestId, metadata);
    return withRequestContext(requestId, () =>
      this.mapQueryErrors(() =>
        this.analyticsService.getPublicPopularRoutes({ ...request, requestId }),
      ),
    );
  }

  @GrpcMethod('AnalyticsQueryService', 'GetSearchConversion')
  async getSearchConversion(
    request: { fromDate: string; toDate: string; requestId?: string },
    metadata: Metadata,
  ) {
    const requestId = grpcRequestId(request.requestId, metadata);
    return withRequestContext(requestId, () =>
      this.mapQueryErrors(() =>
        this.analyticsService.getSearchConversion(
          { ...request, requestId },
          analyticsActor(metadata),
        ),
      ),
    );
  }

  @GrpcMethod('AnalyticsQueryService', 'GetTicketSalesByRoute')
  async getTicketSalesByRoute(
    request: { fromDate: string; toDate: string; limit: number; requestId?: string },
    metadata: Metadata,
  ) {
    const requestId = grpcRequestId(request.requestId, metadata);
    return withRequestContext(requestId, () =>
      this.mapQueryErrors(() =>
        this.analyticsService.getTicketSalesByRoute(
          { ...request, requestId },
          analyticsActor(metadata),
        ),
      ),
    );
  }

  @GrpcMethod('AnalyticsQueryService', 'GetPaymentSummary')
  async getPaymentSummary(
    request: { fromDate: string; toDate: string; requestId?: string },
    metadata: Metadata,
  ) {
    const requestId = grpcRequestId(request.requestId, metadata);
    return withRequestContext(requestId, () =>
      this.mapQueryErrors(async () => ({
        ...(await this.analyticsService.getPaymentSummary(
          { ...request, requestId },
          analyticsActor(metadata),
        )),
        consumerLag: await this.analyticsConsumer.getLag(),
      })),
    );
  }

  private async mapQueryErrors<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof AnalyticsAuthorizationError) {
        throw new RpcException({ code: status.PERMISSION_DENIED, message: error.message });
      }
      if (error instanceof AnalyticsValidationError) {
        throw new RpcException({ code: status.INVALID_ARGUMENT, message: error.message });
      }
      throw error;
    }
  }
}

function healthResponse(requestId: string) {
  return {
    service: 'analytics-service',
    status: 'UP',
    version: '0.1.0',
    requestId,
    checkedAt: new Date().toISOString(),
    traceId: currentTraceContext().traceId ?? 'unavailable',
  };
}

function grpcRequestId(requestId: string | undefined, metadata: Metadata): string {
  const value = metadata.get('x-request-id')[0];
  return createRequestId(typeof value === 'string' ? value : requestId);
}

function metadataValue(metadata: Metadata, key: string): string {
  const value = metadata.get(key)[0];
  return typeof value === 'string' ? value : '';
}

function analyticsActor(metadata: Metadata) {
  return {
    id: metadataValue(metadata, 'x-actor-id'),
    role: metadataValue(metadata, 'x-actor-role'),
    tokenId: metadataValue(metadata, 'x-actor-token-id'),
  };
}
