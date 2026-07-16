import { currentRequestId, incrementCounter, logEvent } from '@bus/observability';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { McpAnalyticsError, type AnalyticsClient } from './analytics-client.js';
import { McpBookingError, type BookingClient } from './booking-client.js';
import { McpCatalogError, type CatalogClient } from './catalog-client.js';
import type { McpActor } from './identity-client.js';

const searchInput = z
  .object({
    origin: z.string().trim().min(1).max(120),
    destination: z.string().trim().min(1).max(120),
    travelDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    departureTimeFrom: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .optional(),
    departureTimeTo: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .optional(),
    minPriceVnd: z.number().int().nonnegative().max(100_000_000).optional(),
    maxPriceVnd: z.number().int().nonnegative().max(100_000_000).optional(),
    operatorCodes: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
    vehicleTypeCodes: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
    minimumRemainingSeats: z.number().int().min(0).max(100).optional(),
    sort: z
      .enum(['DEPARTURE_EARLIEST', 'PRICE_LOWEST', 'DURATION_SHORTEST'])
      .default('DEPARTURE_EARLIEST'),
  })
  .strict();

const searchOutput = z
  .object({
    timezone: z.literal('Asia/Ho_Chi_Minh'),
    origin: z.object({
      id: z.string().uuid(),
      code: z.string(),
      name: z.string(),
      kind: z.string(),
    }),
    destination: z.object({
      id: z.string().uuid(),
      code: z.string(),
      name: z.string(),
      kind: z.string(),
    }),
    trips: z.array(
      z.object({
        id: z.string().uuid(),
        operatorName: z.string(),
        vehicleTypeName: z.string(),
        vehicleCode: z.string(),
        originName: z.string(),
        destinationName: z.string(),
        pickupName: z.string(),
        dropoffName: z.string(),
        departureAt: z.string().datetime({ offset: true }),
        arrivalAt: z.string().datetime({ offset: true }),
        durationMinutes: z.number().int().nonnegative(),
        priceVnd: z.number().int().nonnegative(),
        remainingSeats: z.number().int().nonnegative(),
      }),
    ),
    nearestTravelDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  })
  .strict();

const tripDetailOutput = searchOutput.shape.trips.element.extend({
  routeId: z.string().uuid(),
  routeCode: z.string(),
  vehiclePlate: z.string(),
  status: z.string(),
  stops: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      kind: z.string(),
      stopOrder: z.number().int(),
      scheduledAt: z.string().datetime({ offset: true }),
    }),
  ),
  policies: z.array(
    z.object({
      code: z.string(),
      title: z.string(),
      summary: z.string(),
      resourceUri: z.string().url().or(z.string().startsWith('bus://')),
    }),
  ),
});

const bookingLookupInput = z
  .object({
    bookingCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^BV-\d{4}-[A-Z0-9]{10}$/),
    email: z.string().trim().toLowerCase().email().max(254),
  })
  .strict();

const bookingLookupOutput = z
  .object({
    bookingCode: z.string().regex(/^BV-\d{4}-[A-Z0-9]{10}$/),
    status: z.enum([
      'DRAFT',
      'PENDING_PAYMENT',
      'PAID',
      'TICKET_ISSUED',
      'CHECKED_IN',
      'COMPLETED',
      'EXPIRED',
      'CANCELLED',
    ]),
    tripId: z.string().uuid(),
    originName: z.string(),
    destinationName: z.string(),
    departureAt: z.string().datetime({ offset: true }),
    timezone: z.literal('Asia/Ho_Chi_Minh'),
    seatIds: z.array(z.string()).max(10),
    ticketIssued: z.boolean(),
    cancellationEligible: z.boolean(),
  })
  .strict();

const adminDateRangeInput = z
  .object({
    fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .strict();

const revenueSummaryOutput = z
  .object({
    days: z.array(
      z.object({
        localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        revenueVnd: z.number().int().nonnegative(),
        paidBookingCount: z.number().int().nonnegative(),
        ticketCount: z.number().int().nonnegative(),
      }),
    ),
    totalRevenueVnd: z.number().int().nonnegative(),
    paidBookingCount: z.number().int().nonnegative(),
    ticketCount: z.number().int().nonnegative(),
    lastProcessedAt: z.string().datetime({ offset: true }).optional(),
    timezone: z.literal('Asia/Ho_Chi_Minh'),
  })
  .strict();

const popularRoutesInput = adminDateRangeInput.extend({
  limit: z.number().int().min(1).max(20).default(10),
});

const popularRoutesOutput = z
  .object({
    routes: z.array(
      z.object({
        routeId: z.string().uuid(),
        routeCode: z.string(),
        routeLabel: z.string(),
        searchCount: z.number().int().nonnegative(),
        paidBookingCount: z.number().int().nonnegative(),
        conversionRate: z.number().min(0).max(100),
      }),
    ),
    lastProcessedAt: z.string().datetime({ offset: true }).optional(),
    timezone: z.literal('Asia/Ho_Chi_Minh'),
  })
  .strict();

const popularRoutesResourceOutput = z
  .object({
    title: z.literal('Tuyáº¿n Ä‘Æ°á»£c tÃ¬m kiáº¿m nhiá»u'),
    version: z.literal('1.0'),
    uri: z.literal('bus://routes/popular'),
    fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    timezone: z.literal('Asia/Ho_Chi_Minh'),
    routes: z.array(
      z.object({
        routeId: z.string().uuid(),
        routeCode: z.string(),
        routeLabel: z.string(),
        searchCount: z.number().int().nonnegative(),
      }),
    ),
    lastProcessedAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

const systemHealthResourceOutput = z
  .object({
    service: z.literal('intercity-bus-platform'),
    version: z.literal('0.5.0'),
    uri: z.literal('bus://system/health'),
    status: z.enum(['UP', 'DEGRADED']),
    checkedAt: z.string().datetime({ offset: true }),
    components: z.array(z.object({ name: z.string(), status: z.enum(['UP', 'DOWN']) }).strict()),
  })
  .strict();

const policyDocuments = {
  cancellation: {
    title: 'Chính sách hủy vé nội bộ',
    version: '1.0',
    effectiveDate: '2026-07-15',
    uri: 'bus://policy/cancellation',
    content:
      'Booking ở trạng thái PAID hoặc TICKET_ISSUED được hủy khi thời điểm yêu cầu còn trước giờ khởi hành. Hệ thống demo giải phóng ghế nhưng không thực hiện hoàn tiền thật.',
  },
  checkin: {
    title: 'Hướng dẫn check-in nội bộ',
    version: '1.0',
    effectiveDate: '2026-07-15',
    uri: 'bus://policy/checkin',
    content:
      'Hành khách nên có mặt trước giờ khởi hành, xuất trình mã vé hoặc QR mô phỏng. Nhân viên chỉ đánh dấu check-in cho vé thuộc đúng chuyến và chưa được check-in trước đó.',
  },
} as const;

export interface McpServerDependencies {
  catalog: CatalogClient;
  booking: BookingClient;
  analytics: AnalyticsClient;
  actor?: McpActor;
  resources: {
    popularRoutes(): Promise<z.infer<typeof popularRoutesResourceOutput>>;
    systemHealth(): Promise<z.infer<typeof systemHealthResourceOutput>>;
  };
}

export function createMcpServer(dependencies: McpServerDependencies): McpServer {
  const { catalog, booking, analytics, actor, resources } = dependencies;
  const server = new McpServer({ name: 'intercity-bus-booking', version: '0.5.0' });
  server.registerTool(
    'search_trips',
    {
      title: 'Search trips',
      description: 'Find public bus trips by locations, local date and filters.',
      inputSchema: searchInput,
      outputSchema: searchOutput,
    },
    async (input) => {
      try {
        const [origin] = await catalog.suggestLocations(input.origin, 1, currentRequestId());
        const [destination] = await catalog.suggestLocations(
          input.destination,
          1,
          currentRequestId(),
        );
        if (!origin || !destination)
          return toolError('INVALID_INPUT', 'Không tìm thấy điểm đi hoặc điểm đến phù hợp.');
        const result = await catalog.searchTrips(
          { ...input, originLocationId: origin.id, destinationLocationId: destination.id },
          currentRequestId(),
        );
        const output = searchOutput.parse({ ...result, origin, destination });
        incrementCounter('mcp_tool_calls_total', { tool: 'search_trips', outcome: 'success' });
        return {
          content: [{ type: 'text', text: JSON.stringify(output) }],
          structuredContent: output,
        };
      } catch (error) {
        return mapToolError('search_trips', error);
      }
    },
  );
  server.registerTool(
    'get_revenue_summary',
    {
      title: 'Get revenue summary',
      description: 'Return admin-only daily and total revenue in integer VND.',
      inputSchema: adminDateRangeInput,
      outputSchema: revenueSummaryOutput,
      annotations: { readOnlyHint: true },
    },
    async (input) => {
      if (actor?.role !== 'ADMIN') return adminToolDenied('get_revenue_summary');
      try {
        const output = revenueSummaryOutput.parse(
          await analytics.getRevenueSummary(input, actor, currentRequestId()),
        );
        recordAdminToolSuccess('get_revenue_summary', actor);
        return {
          content: [{ type: 'text', text: JSON.stringify(output) }],
          structuredContent: output,
        };
      } catch (error) {
        return mapAnalyticsToolError('get_revenue_summary', error, actor);
      }
    },
  );
  server.registerTool(
    'get_popular_routes',
    {
      title: 'Get popular routes',
      description: 'Return admin-only route search and paid-booking rankings.',
      inputSchema: popularRoutesInput,
      outputSchema: popularRoutesOutput,
      annotations: { readOnlyHint: true },
    },
    async (input) => {
      if (actor?.role !== 'ADMIN') return adminToolDenied('get_popular_routes');
      try {
        const output = popularRoutesOutput.parse(
          await analytics.getPopularRoutes(input, actor, currentRequestId()),
        );
        recordAdminToolSuccess('get_popular_routes', actor);
        return {
          content: [{ type: 'text', text: JSON.stringify(output) }],
          structuredContent: output,
        };
      } catch (error) {
        return mapAnalyticsToolError('get_popular_routes', error, actor);
      }
    },
  );
  server.registerTool(
    'get_booking_status',
    {
      title: 'Get booking status',
      description:
        'Look up a booking only when both the booking code and checkout email are provided. Returns no passenger or contact identity fields.',
      inputSchema: bookingLookupInput,
      outputSchema: bookingLookupOutput,
    },
    async ({ bookingCode, email }) => {
      try {
        const output = bookingLookupOutput.parse(
          await booking.getGuestBookingStatus(bookingCode, email, currentRequestId()),
        );
        incrementCounter('mcp_tool_calls_total', {
          tool: 'get_booking_status',
          outcome: 'success',
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(output) }],
          structuredContent: output,
        };
      } catch (error) {
        return mapBookingToolError(error);
      }
    },
  );
  server.registerTool(
    'get_trip_detail',
    {
      title: 'Get trip detail',
      description: 'Get a public trip, stops and policy references by trip ID.',
      inputSchema: z.object({ tripId: z.string().uuid() }).strict(),
      outputSchema: tripDetailOutput,
    },
    async ({ tripId }) => {
      try {
        const output = tripDetailOutput.parse(await catalog.getTrip(tripId, currentRequestId()));
        incrementCounter('mcp_tool_calls_total', { tool: 'get_trip_detail', outcome: 'success' });
        return {
          content: [{ type: 'text', text: JSON.stringify(output) }],
          structuredContent: output,
        };
      } catch (error) {
        return mapToolError('get_trip_detail', error);
      }
    },
  );
  for (const [key, document] of Object.entries(policyDocuments)) {
    server.registerResource(
      key,
      document.uri,
      {
        title: document.title,
        description: 'Versioned internal policy reference.',
        mimeType: 'text/plain',
      },
      async (uri) => ({
        contents: [{ uri: uri.href, mimeType: 'text/plain', text: JSON.stringify(document) }],
      }),
    );
  }
  server.registerResource(
    'popular-routes',
    'bus://routes/popular',
    {
      title: 'Tuyáº¿n Ä‘Æ°á»£c tÃ¬m kiáº¿m nhiá»u',
      description: 'Privacy-safe recent route search ranking.',
      mimeType: 'application/json',
    },
    async (uri) => {
      const output = popularRoutesResourceOutput.parse(await resources.popularRoutes());
      incrementCounter('mcp_resource_reads_total', {
        resource: 'popular_routes',
        outcome: 'success',
      });
      return {
        contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(output) }],
      };
    },
  );
  server.registerResource(
    'system-health',
    'bus://system/health',
    {
      title: 'TÃ¬nh tráº¡ng há»‡ thá»‘ng demo',
      description: 'Sanitized component status without infrastructure details.',
      mimeType: 'application/json',
    },
    async (uri) => {
      const output = systemHealthResourceOutput.parse(await resources.systemHealth());
      incrementCounter('mcp_resource_reads_total', {
        resource: 'system_health',
        outcome: 'success',
      });
      return {
        contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(output) }],
      };
    },
  );
  server.registerTool(
    'system_health',
    { description: 'Returns the sanitized health of the MCP foundation service.', inputSchema: {} },
    async () => ({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            service: 'mcp-server',
            status: 'UP',
            version: '0.5.0',
            checkedAt: new Date().toISOString(),
          }),
        },
      ],
    }),
  );
  return server;
}

function adminToolDenied(tool: string) {
  incrementCounter('mcp_tool_calls_total', { tool, outcome: 'forbidden' });
  return toolError('FORBIDDEN', 'Quyền ADMIN là bắt buộc cho công cụ này.');
}

function recordAdminToolSuccess(tool: string, actor: McpActor): void {
  incrementCounter('mcp_tool_calls_total', { tool, outcome: 'success' });
  logEvent({
    service: 'mcp-server',
    event: 'mcp.admin-tool.completed',
    message: 'MCP admin tool completed.',
    fields: { tool, actorId: actor.id, actorRole: actor.role },
  });
}

function mapAnalyticsToolError(tool: string, error: unknown, actor: McpActor) {
  const code =
    error instanceof McpAnalyticsError ? error.code : ('DEPENDENCY_UNAVAILABLE' as const);
  const message =
    code === 'FORBIDDEN'
      ? 'Quyền ADMIN là bắt buộc cho công cụ này.'
      : code === 'INVALID_INPUT'
        ? 'Khoảng ngày hoặc giới hạn không hợp lệ.'
        : 'Dịch vụ báo cáo đang tạm gián đoạn.';
  incrementCounter('mcp_tool_calls_total', { tool, outcome: code.toLowerCase() });
  logEvent({
    service: 'mcp-server',
    level: code === 'DEPENDENCY_UNAVAILABLE' ? 'warn' : 'info',
    event: 'mcp.admin-tool.rejected',
    message: 'MCP admin tool returned a sanitized result.',
    fields: { tool, code, actorId: actor.id, actorRole: actor.role },
  });
  return toolError(code, message);
}

function mapBookingToolError(error: unknown) {
  const code = error instanceof McpBookingError ? error.code : ('DEPENDENCY_UNAVAILABLE' as const);
  const message =
    code === 'LOOKUP_DENIED'
      ? 'Không thể xác minh booking với thông tin đã cung cấp.'
      : 'Dịch vụ tra cứu booking đang tạm gián đoạn.';
  logEvent({
    service: 'mcp-server',
    level: code === 'LOOKUP_DENIED' ? 'info' : 'warn',
    event: 'mcp.booking-lookup.rejected',
    message: 'MCP booking lookup returned a sanitized result.',
    fields: { tool: 'get_booking_status', code },
  });
  incrementCounter('mcp_tool_calls_total', {
    tool: 'get_booking_status',
    outcome: code.toLowerCase(),
  });
  return toolError(code, message);
}

function toolError(code: string, message: string) {
  return {
    isError: true,
    content: [{ type: 'text' as const, text: JSON.stringify({ code, message }) }],
  };
}
function mapToolError(tool: string, error: unknown) {
  const code = error instanceof McpCatalogError ? error.code : 'DEPENDENCY_UNAVAILABLE';
  const message =
    code === 'INVALID_INPUT'
      ? 'Dữ liệu tìm kiếm không hợp lệ.'
      : code === 'NOT_FOUND'
        ? 'Không tìm thấy chuyến xe.'
        : 'Dịch vụ tra cứu đang tạm gián đoạn.';
  logEvent({
    service: 'mcp-server',
    level: 'warn',
    event: 'mcp.tool.rejected',
    message: 'MCP tool returned a sanitized error.',
    fields: { tool, code },
  });
  incrementCounter('mcp_tool_calls_total', { tool, outcome: code.toLowerCase() });
  return toolError(code, message);
}
