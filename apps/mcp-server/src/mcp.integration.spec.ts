import { createServer, type Server } from 'node:http';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { McpAnalyticsError, type AnalyticsClient } from './analytics-client.js';
import { McpBookingError, type BookingClient } from './booking-client.js';
import type { CatalogClient } from './catalog-client.js';
import { McpIdentityError, type IdentityClient, type McpActor } from './identity-client.js';
import { createApp } from './main.js';
import { McpRateLimitUnavailableError, type McpRateLimiter } from './rate-limit.js';
import type { McpResourceCache } from './resource-cache.js';

const origin = {
  id: '11111111-1111-4111-8111-111111111111',
  code: 'HCM',
  name: 'TP.HCM',
  kind: 'CITY',
};
const destination = {
  id: '22222222-2222-4222-8222-222222222222',
  code: 'DLI',
  name: 'Đà Lạt',
  kind: 'CITY',
};
const trip = {
  id: '33333333-3333-4333-8333-333333333333',
  operatorName: 'Phương Trang Demo',
  vehicleTypeName: 'Giường nằm 34 chỗ',
  vehicleCode: 'BUS-34',
  originName: origin.name,
  destinationName: destination.name,
  pickupName: 'Bến xe Miền Đông',
  dropoffName: 'Bến xe Liên tỉnh Đà Lạt',
  departureAt: '2026-07-16T12:00:00.000Z',
  arrivalAt: '2026-07-16T18:00:00.000Z',
  durationMinutes: 360,
  priceVnd: 280000,
  remainingSeats: 12,
};

const catalog: CatalogClient = {
  async readiness() {},
  async suggestLocations(query) {
    return query.toLowerCase().includes('lạt')
      ? [destination]
      : query.toLowerCase().includes('hcm')
        ? [origin]
        : [];
  },
  async searchTrips() {
    return { timezone: 'Asia/Ho_Chi_Minh', trips: [trip], nearestTravelDates: [] };
  },
  async getTrip() {
    return {
      ...trip,
      routeId: '44444444-4444-4444-8444-444444444444',
      routeCode: 'HCM-DLI',
      vehiclePlate: '51B-12345',
      status: 'SCHEDULED',
      stops: [
        {
          id: '55555555-5555-4555-8555-555555555555',
          name: trip.pickupName,
          kind: 'PICKUP',
          stopOrder: 1,
          scheduledAt: trip.departureAt,
        },
      ],
      policies: [
        {
          code: 'CANCELLATION_V1',
          title: 'Chính sách hủy vé',
          summary: 'Hủy trước giờ khởi hành.',
          resourceUri: 'bus://policy/cancellation',
        },
      ],
    };
  },
};

const booking: BookingClient = {
  async readiness() {},
  async getGuestBookingStatus(bookingCode, email) {
    if (email !== 'smoke.guest@example.com') {
      throw new McpBookingError('LOOKUP_DENIED');
    }
    return {
      bookingCode,
      status: 'TICKET_ISSUED',
      tripId: trip.id,
      originName: origin.name,
      destinationName: destination.name,
      departureAt: trip.departureAt,
      timezone: 'Asia/Ho_Chi_Minh',
      seatIds: ['A03'],
      ticketIssued: true,
      cancellationEligible: true,
    };
  },
};

const adminActor: McpActor = {
  id: '66666666-6666-4666-8666-666666666666',
  role: 'ADMIN',
  tokenId: '77777777-7777-4777-8777-777777777777',
  expiresAt: '2026-07-16T12:00:00.000Z',
};
const customerActor: McpActor = {
  ...adminActor,
  id: '88888888-8888-4888-8888-888888888888',
  role: 'CUSTOMER',
  tokenId: '99999999-9999-4999-8999-999999999999',
};

const identity: IdentityClient = {
  async readiness() {},
  async authenticate(authorization) {
    if (authorization === 'Bearer admin-token') return adminActor;
    if (authorization === 'Bearer customer-token') return customerActor;
    if (!authorization) throw new McpIdentityError('AUTHENTICATION_REQUIRED');
    throw new McpIdentityError('UNAUTHENTICATED');
  },
};

let lastAnalyticsActor: McpActor | undefined;
const analytics: AnalyticsClient = {
  async readiness() {},
  async getRevenueSummary(_input, actor) {
    if (actor.role !== 'ADMIN') throw new McpAnalyticsError('FORBIDDEN');
    lastAnalyticsActor = actor;
    return {
      days: [
        {
          localDate: '2026-07-15',
          revenueVnd: 560000,
          paidBookingCount: 2,
          ticketCount: 2,
        },
      ],
      totalRevenueVnd: 560000,
      paidBookingCount: 2,
      ticketCount: 2,
      lastProcessedAt: '2026-07-15T12:00:00.000Z',
      timezone: 'Asia/Ho_Chi_Minh',
    };
  },
  async getPopularRoutes(_input, actor) {
    if (actor.role !== 'ADMIN') throw new McpAnalyticsError('FORBIDDEN');
    lastAnalyticsActor = actor;
    return {
      routes: [
        {
          routeId: '44444444-4444-4444-8444-444444444444',
          routeCode: 'HCM-DLI',
          routeLabel: 'TP.HCM → Đà Lạt',
          searchCount: 10,
          paidBookingCount: 2,
          conversionRate: 20,
        },
      ],
      lastProcessedAt: '2026-07-15T12:00:00.000Z',
      timezone: 'Asia/Ho_Chi_Minh',
    };
  },
  async getPublicPopularRoutes(input) {
    return {
      routes: [
        {
          routeId: '44444444-4444-4444-8444-444444444444',
          routeCode: 'HCM-DLI',
          routeLabel: 'TP.HCM â†’ ÄÃ  Láº¡t',
          searchCount: 10,
        },
      ],
      fromDate: input.fromDate,
      toDate: input.toDate,
      lastProcessedAt: '2026-07-15T12:00:00.000Z',
      timezone: 'Asia/Ho_Chi_Minh',
    };
  },
};

let rateLimitMode: 'allow' | 'deny' | 'unavailable' = 'allow';
let dependenciesReady = true;
const rateLimiter: McpRateLimiter = {
  async readiness() {
    if (!dependenciesReady) throw new McpRateLimitUnavailableError();
  },
  async consume(_identifier, bucket) {
    if (rateLimitMode === 'unavailable') throw new McpRateLimitUnavailableError();
    return {
      allowed: rateLimitMode === 'allow',
      limit: bucket === 'booking_lookup' ? 5 : 30,
      remaining: rateLimitMode === 'allow' ? 4 : 0,
      retryAfterSeconds: 60,
    };
  },
};
const resourceCache: McpResourceCache = {
  async getOrLoad(_key, _ttlSeconds, loader) {
    return loader();
  },
};

describe('mcp public catalog slice', () => {
  let httpServer: Server;
  let client: Client;
  let mcpUrl: URL;
  beforeAll(async () => {
    httpServer = createServer(
      createApp({ catalog, booking, identity, analytics, rateLimiter, resourceCache }),
    );
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    const address = httpServer.address();
    if (!address || typeof address === 'string') throw new Error('Test MCP server did not bind.');
    mcpUrl = new URL(`http://127.0.0.1:${address.port}/mcp`);
    client = new Client({ name: 'mcp-contract-test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(mcpUrl));
  });
  afterAll(async () => {
    await client.close();
    await new Promise<void>((resolve, reject) =>
      httpServer.close((error) => (error ? reject(error) : resolve())),
    );
  });

  it('lists only the current public tools', async () => {
    const result = await client.listTools();
    expect(result.tools.map((tool) => tool.name).sort()).toEqual([
      'get_booking_status',
      'get_popular_routes',
      'get_revenue_summary',
      'get_trip_detail',
      'search_trips',
      'system_health',
    ]);
    expect(
      result.tools.find((tool) => tool.name === 'search_trips')?.inputSchema.additionalProperties,
    ).toBe(false);
  });

  it('requires a bearer token before invoking admin tools', async () => {
    const response = await rawToolCall(mcpUrl, 'get_revenue_summary', {
      fromDate: '2026-07-15',
      toDate: '2026-07-15',
    });
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe('Bearer');
    expect(await response.json()).toMatchObject({
      error: { data: { code: 'AUTHENTICATION_REQUIRED' } },
    });
  });

  it('rejects invalid or revoked admin credentials neutrally', async () => {
    const response = await rawToolCall(
      mcpUrl,
      'get_revenue_summary',
      { fromDate: '2026-07-15', toDate: '2026-07-15' },
      'revoked-token',
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { data: { code: 'UNAUTHENTICATED' } },
    });
  });

  it('rejects CUSTOMER credentials before Analytics is called', async () => {
    lastAnalyticsActor = undefined;
    const response = await rawToolCall(
      mcpUrl,
      'get_popular_routes',
      { fromDate: '2026-07-15', toDate: '2026-07-15', limit: 5 },
      'customer-token',
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { data: { code: 'FORBIDDEN' } } });
    expect(lastAnalyticsActor).toBeUndefined();
  });

  it('returns integer-VND revenue for an authenticated ADMIN', async () => {
    const adminClient = await authorizedClient(mcpUrl, 'admin-token');
    try {
      const result = await adminClient.callTool({
        name: 'get_revenue_summary',
        arguments: { fromDate: '2026-07-15', toDate: '2026-07-15' },
      });
      expect(result.structuredContent).toMatchObject({
        totalRevenueVnd: 560000,
        paidBookingCount: 2,
        days: [{ revenueVnd: 560000 }],
      });
      expect(lastAnalyticsActor).toEqual(adminActor);
    } finally {
      await adminClient.close();
    }
  });

  it('returns popular-route conversion only for an authenticated ADMIN', async () => {
    const adminClient = await authorizedClient(mcpUrl, 'admin-token');
    try {
      const result = await adminClient.callTool({
        name: 'get_popular_routes',
        arguments: { fromDate: '2026-07-15', toDate: '2026-07-15', limit: 5 },
      });
      expect(result.structuredContent).toMatchObject({
        routes: [{ routeCode: 'HCM-DLI', searchCount: 10, conversionRate: 20 }],
      });
    } finally {
      await adminClient.close();
    }
  });

  it('returns only the minimal booking projection with both credentials', async () => {
    const result = await client.callTool({
      name: 'get_booking_status',
      arguments: {
        bookingCode: 'BV-2030-ABCDEF1234',
        email: 'SMOKE.GUEST@EXAMPLE.COM',
      },
    });
    expect(result.structuredContent).toMatchObject({
      bookingCode: 'BV-2030-ABCDEF1234',
      status: 'TICKET_ISSUED',
      seatIds: ['A03'],
      ticketIssued: true,
    });
    expect(JSON.stringify(result.structuredContent)).not.toContain('email');
    expect(JSON.stringify(result.structuredContent)).not.toContain('passenger');
  });

  it('returns the same neutral denial for wrong booking credentials', async () => {
    const result = await client.callTool({
      name: 'get_booking_status',
      arguments: {
        bookingCode: 'BV-2030-ABCDEF1234',
        email: 'wrong@example.com',
      },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('Không thể xác minh booking');
    expect(JSON.stringify(result.content)).not.toContain('wrong@example.com');
  });

  it('rejects booking lookup when email is missing', async () => {
    const result = await client.callTool({
      name: 'get_booking_status',
      arguments: { bookingCode: 'BV-2030-ABCDEF1234' },
    });
    expect(result.isError).toBe(true);
  });

  it('returns HTTP 429 and Retry-After when the distributed limit is exhausted', async () => {
    rateLimitMode = 'deny';
    try {
      const response = await fetch(mcpUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.8' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 99,
          method: 'tools/call',
          params: {
            name: 'get_booking_status',
            arguments: {
              bookingCode: 'BV-2030-ABCDEF1234',
              email: 'smoke.guest@example.com',
            },
          },
        }),
      });
      expect(response.status).toBe(429);
      expect(response.headers.get('retry-after')).toBe('60');
      expect(await response.json()).toMatchObject({
        error: { data: { code: 'RATE_LIMITED' } },
      });
    } finally {
      rateLimitMode = 'allow';
    }
  });

  it('fails closed with HTTP 503 when Redis rate limiting is unavailable', async () => {
    rateLimitMode = 'unavailable';
    try {
      const response = await fetch(mcpUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 100,
          method: 'tools/call',
          params: { name: 'system_health', arguments: {} },
        }),
      });
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        error: { data: { code: 'DEPENDENCY_UNAVAILABLE' } },
      });
    } finally {
      rateLimitMode = 'allow';
    }
  });

  it('marks readiness down when a required protected-tool dependency is unavailable', async () => {
    dependenciesReady = false;
    try {
      const response = await fetch(new URL('/health/ready', mcpUrl));
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
    } finally {
      dependenciesReady = true;
    }
  });

  it('searches trips with normalized locations and integer VND', async () => {
    const result = await client.callTool({
      name: 'search_trips',
      arguments: { origin: 'TP.HCM', destination: 'Đà Lạt', travelDate: '2026-07-16' },
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      timezone: 'Asia/Ho_Chi_Minh',
      origin: { code: 'HCM' },
      destination: { code: 'DLI' },
      trips: [{ id: trip.id, priceVnd: 280000, remainingSeats: 12 }],
    });
  });

  it('returns sanitized input errors without exposing internals', async () => {
    const result = await client.callTool({
      name: 'search_trips',
      arguments: { origin: 'unknown', destination: 'Đà Lạt', travelDate: '2026-07-16' },
    });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      {
        type: 'text',
        text: JSON.stringify({
          code: 'INVALID_INPUT',
          message: 'Không tìm thấy điểm đi hoặc điểm đến phù hợp.',
        }),
      },
    ]);
  });

  it('returns public trip detail and policy references', async () => {
    const result = await client.callTool({
      name: 'get_trip_detail',
      arguments: { tripId: trip.id },
    });
    expect(result.structuredContent).toMatchObject({
      id: trip.id,
      routeCode: 'HCM-DLI',
      policies: [{ resourceUri: 'bus://policy/cancellation' }],
    });
  });

  it('lists and reads policy plus privacy-safe platform resources', async () => {
    const resources = await client.listResources();
    expect(resources.resources.map((resource) => resource.uri).sort()).toEqual([
      'bus://policy/cancellation',
      'bus://policy/checkin',
      'bus://routes/popular',
      'bus://system/health',
    ]);
    const cancellation = await client.readResource({ uri: 'bus://policy/cancellation' });
    const content = cancellation.contents[0];
    expect(JSON.parse(content && 'text' in content ? content.text : '{}')).toMatchObject({
      version: '1.0',
      effectiveDate: '2026-07-15',
      uri: 'bus://policy/cancellation',
    });
    const popular = await client.readResource({ uri: 'bus://routes/popular' });
    const popularContent = popular.contents[0];
    const popularJson = JSON.parse(
      popularContent && 'text' in popularContent ? popularContent.text : '{}',
    );
    expect(popularJson).toMatchObject({
      version: '1.0',
      uri: 'bus://routes/popular',
      routes: [{ routeCode: 'HCM-DLI', searchCount: 10 }],
    });
    expect(JSON.stringify(popularJson)).not.toContain('paidBookingCount');
    expect(JSON.stringify(popularJson)).not.toContain('conversionRate');

    const health = await client.readResource({ uri: 'bus://system/health' });
    const healthContent = health.contents[0];
    const healthJson = JSON.parse(
      healthContent && 'text' in healthContent ? healthContent.text : '{}',
    );
    expect(healthJson).toMatchObject({
      status: 'UP',
      components: expect.arrayContaining([{ name: 'redis', status: 'UP' }]),
    });
    expect(JSON.stringify(healthJson)).not.toContain('localhost');
    expect(JSON.stringify(healthJson)).not.toContain('5005');
  });
});

async function authorizedClient(url: URL, token: string): Promise<Client> {
  const client = new Client({ name: 'mcp-admin-contract-test', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(url, {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }),
  );
  return client;
}

function rawToolCall(
  url: URL,
  name: string,
  args: Record<string, unknown>,
  token?: string,
): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 200,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });
}
