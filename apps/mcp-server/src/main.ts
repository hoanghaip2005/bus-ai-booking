import './instrumentation.js';

import {
  createRequestId,
  incrementCounter,
  logEvent,
  withRequestContext,
} from '@bus/observability';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import express, { type Express, type Request, type Response } from 'express';

import { GrpcAnalyticsClient, type AnalyticsClient } from './analytics-client.js';
import { GrpcBookingClient, type BookingClient } from './booking-client.js';
import { GrpcCatalogClient, type CatalogClient } from './catalog-client.js';
import {
  GrpcIdentityClient,
  McpIdentityError,
  type IdentityClient,
  type McpActor,
} from './identity-client.js';
import { createMcpServer } from './mcp-server.js';
import { RedisMcpRateLimiter, type McpRateLimitBucket, type McpRateLimiter } from './rate-limit.js';
import {
  popularRoutesResourceCacheKey,
  RedisMcpResourceCache,
  type McpResourceCache,
} from './resource-cache.js';

export interface McpAppDependencies {
  catalog: CatalogClient;
  booking: BookingClient;
  identity: IdentityClient;
  analytics: AnalyticsClient;
  rateLimiter: McpRateLimiter;
  resourceCache: McpResourceCache;
}

export function createApp(
  dependencies: McpAppDependencies = {
    catalog: new GrpcCatalogClient(),
    booking: new GrpcBookingClient(),
    identity: new GrpcIdentityClient(),
    analytics: new GrpcAnalyticsClient(),
    rateLimiter: new RedisMcpRateLimiter(),
    resourceCache: new RedisMcpResourceCache(),
  },
): Express {
  const { catalog, booking, identity, analytics, rateLimiter, resourceCache } = dependencies;
  const resources = createPublicResources({
    catalog,
    booking,
    identity,
    analytics,
    rateLimiter,
    resourceCache,
  });
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use((request, response, next) => {
    const requestId = createRequestId(request.header('x-request-id'));
    response.setHeader('x-request-id', requestId);
    const startedAt = performance.now();
    withRequestContext(requestId, () => {
      response.once('finish', () =>
        logEvent({
          service: 'mcp-server',
          event: 'http.request.completed',
          message: `${request.method} ${request.originalUrl}`,
          requestId,
          fields: {
            method: request.method,
            path: request.originalUrl,
            statusCode: response.statusCode,
            durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
          },
        }),
      );
      next();
    });
  });
  app.get('/health', (_request, response) =>
    response.json({
      service: 'mcp-server',
      status: 'UP',
      version: '0.5.0',
      checkedAt: new Date().toISOString(),
    }),
  );
  app.get('/health/live', (_request, response) =>
    response.json({ service: 'mcp-server', status: 'UP', checkedAt: new Date().toISOString() }),
  );
  app.get('/health/ready', async (_request, response) => {
    try {
      await Promise.all([
        catalog.readiness(),
        booking.readiness(),
        identity.readiness(),
        analytics.readiness(),
        rateLimiter.readiness(),
      ]);
      response.json({ service: 'mcp-server', status: 'UP', checkedAt: new Date().toISOString() });
    } catch {
      response.status(503).json({
        service: 'mcp-server',
        status: 'DOWN',
        code: 'DEPENDENCY_UNAVAILABLE',
        checkedAt: new Date().toISOString(),
      });
    }
  });
  app.post('/mcp', async (request: Request, response: Response) => {
    let actor: McpActor | undefined;
    if (isToolCall(request.body)) {
      const tool = request.body.params.name;
      const bucket: McpRateLimitBucket =
        tool === 'get_booking_status' ? 'booking_lookup' : 'public';
      try {
        const rate = await rateLimiter.consume(clientIdentifier(request), bucket);
        response.setHeader('X-RateLimit-Limit', String(rate.limit));
        response.setHeader('X-RateLimit-Remaining', String(rate.remaining));
        if (!rate.allowed) {
          response.setHeader('Retry-After', String(rate.retryAfterSeconds));
          incrementCounter('mcp_rate_limit_total', { bucket, outcome: 'rejected' });
          response.status(429).json(mcpHttpError(request.body.id, -32029, 'RATE_LIMITED'));
          return;
        }
      } catch {
        incrementCounter('mcp_rate_limit_total', { bucket, outcome: 'unavailable' });
        response.status(503).json(mcpHttpError(request.body.id, -32003, 'DEPENDENCY_UNAVAILABLE'));
        return;
      }
      if (isAdminTool(request.body.params.name)) {
        try {
          actor = await identity.authenticate(
            request.header('authorization'),
            requestIdHeader(request),
          );
        } catch (error) {
          const identityError =
            error instanceof McpIdentityError
              ? error
              : new McpIdentityError('DEPENDENCY_UNAVAILABLE');
          const statusCode = identityError.code === 'DEPENDENCY_UNAVAILABLE' ? 503 : 401;
          if (statusCode === 401) response.setHeader('WWW-Authenticate', 'Bearer');
          logEvent({
            service: 'mcp-server',
            level: identityError.code === 'DEPENDENCY_UNAVAILABLE' ? 'warn' : 'info',
            event: 'mcp.admin-auth.rejected',
            message: 'MCP admin authentication was rejected.',
            fields: { tool: request.body.params.name, code: identityError.code },
          });
          response
            .status(statusCode)
            .json(mcpHttpError(request.body.id, -32001, identityError.code));
          return;
        }
        if (actor.role !== 'ADMIN') {
          logEvent({
            service: 'mcp-server',
            level: 'info',
            event: 'mcp.admin-auth.forbidden',
            message: 'MCP admin authorization was denied.',
            fields: { tool: request.body.params.name, actorId: actor.id, actorRole: actor.role },
          });
          response.status(403).json(mcpHttpError(request.body.id, -32003, 'FORBIDDEN'));
          return;
        }
      }
    }
    const server: McpServer = createMcpServer({ catalog, booking, analytics, actor, resources });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    try {
      await server.connect(transport);
      await transport.handleRequest(request, response, request.body);
    } catch (error) {
      logEvent({
        service: 'mcp-server',
        level: 'error',
        event: 'mcp.request.failed',
        message: 'MCP request failed.',
        fields: { errorName: error instanceof Error ? error.name : 'UnknownError' },
      });
      if (!response.headersSent)
        response
          .status(500)
          .json({ error: { code: 'INTERNAL_ERROR', message: 'MCP request failed.' } });
    }
  });
  app.all('/mcp', (_request, response) =>
    response.status(405).json({
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST for stateless MCP requests.' },
    }),
  );
  return app;
}

function createPublicResources(dependencies: McpAppDependencies) {
  const { catalog, booking, identity, analytics, rateLimiter, resourceCache } = dependencies;
  return {
    async popularRoutes() {
      return resourceCache.getOrLoad(popularRoutesResourceCacheKey, 60, async () => {
        const toDate = vietnamLocalDate(new Date());
        const fromDate = shiftLocalDate(toDate, -29);
        const result = await analytics.getPublicPopularRoutes(
          { fromDate, toDate, limit: 10 },
          createRequestId(),
        );
        return {
          title: 'Tuyáº¿n Ä‘Æ°á»£c tÃ¬m kiáº¿m nhiá»u' as const,
          version: '1.0' as const,
          uri: 'bus://routes/popular' as const,
          fromDate: result.fromDate,
          toDate: result.toDate,
          timezone: 'Asia/Ho_Chi_Minh' as const,
          routes: result.routes,
          ...(result.lastProcessedAt && { lastProcessedAt: result.lastProcessedAt }),
        };
      });
    },
    async systemHealth() {
      const checks = [
        ['catalog', () => catalog.readiness()],
        ['booking', () => booking.readiness()],
        ['identity', () => identity.readiness()],
        ['analytics', () => analytics.readiness()],
        ['redis', () => rateLimiter.readiness()],
      ] as const;
      const components = await Promise.all(
        checks.map(async ([name, check]) => {
          try {
            await check();
            return { name, status: 'UP' as const };
          } catch {
            return { name, status: 'DOWN' as const };
          }
        }),
      );
      return {
        service: 'intercity-bus-platform' as const,
        version: '0.5.0' as const,
        uri: 'bus://system/health' as const,
        status: components.every((component) => component.status === 'UP')
          ? ('UP' as const)
          : ('DEGRADED' as const),
        checkedAt: new Date().toISOString(),
        components,
      };
    },
  };
}

function vietnamLocalDate(value: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}

function shiftLocalDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isToolCall(value: unknown): value is {
  id?: string | number | null;
  method: 'tools/call';
  params: { name: string };
} {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  if (
    candidate.method !== 'tools/call' ||
    !candidate.params ||
    typeof candidate.params !== 'object'
  )
    return false;
  return typeof (candidate.params as Record<string, unknown>).name === 'string';
}

function clientIdentifier(request: Request): string {
  const forwarded = request.header('x-forwarded-for');
  const trustedAddress = forwarded?.split(',').at(-1)?.trim();
  return trustedAddress || request.socket.remoteAddress || 'unknown-client';
}

function isAdminTool(tool: string): boolean {
  return tool === 'get_revenue_summary' || tool === 'get_popular_routes';
}

function requestIdHeader(request: Request): string | undefined {
  const value = request.header('x-request-id');
  return value || undefined;
}

function mcpHttpError(id: string | number | null | undefined, code: number, stableCode: string) {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code, message: 'MCP request rejected.', data: { code: stableCode } },
  };
}

if (process.env.NODE_ENV !== 'test') {
  const port = Number(process.env.MCP_PORT ?? 3002);
  createApp().listen(port, '0.0.0.0', () =>
    console.log(`MCP Server listening on http://localhost:${port}/mcp`),
  );
}
