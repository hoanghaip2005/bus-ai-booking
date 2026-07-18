import type {
  BookingDomainEvent,
  PaymentAttemptedV1,
  SearchPerformedEvent,
  SearchPerformedV2,
} from '@bus/contracts-events';
import { Inject, Injectable } from '@nestjs/common';

import { AnalyticsDatabase } from './analytics.database';

export interface AnalyticsActor {
  id: string;
  role: string;
  tokenId: string;
}

export class AnalyticsAuthorizationError extends Error {}
export class AnalyticsValidationError extends Error {}

@Injectable()
export class AnalyticsService {
  constructor(@Inject(AnalyticsDatabase) private readonly database: AnalyticsDatabase) {}

  async applyBookingEvent(event: BookingDomainEvent): Promise<boolean> {
    return this.database.withTransaction(async (client) => {
      const accepted = await client.query(
        `INSERT INTO analytics.processed_events
           (event_id, topic, event_type, occurred_at)
         VALUES ($1, 'booking-events', $2, $3)
         ON CONFLICT (event_id) DO NOTHING
         RETURNING event_id`,
        [event.eventId, event.eventType, event.occurredAt],
      );
      const isNewEvent = accepted.rowCount === 1;
      if (event.eventType !== 'BookingPaidV1') return isNewEvent;

      const localDate = vietnamLocalDate(event.payload.paidAt);
      if (isNewEvent) {
        await client.query(
          `INSERT INTO analytics.daily_revenue
           (local_date, revenue_vnd, paid_booking_count, ticket_count)
           VALUES ($1, $2, 1, $3)
           ON CONFLICT (local_date) DO UPDATE
           SET revenue_vnd = analytics.daily_revenue.revenue_vnd + EXCLUDED.revenue_vnd,
               paid_booking_count = analytics.daily_revenue.paid_booking_count + 1,
               ticket_count = analytics.daily_revenue.ticket_count + EXCLUDED.ticket_count,
               updated_at = now()`,
          [localDate, event.payload.totalPriceVnd, event.payload.passengerCount],
        );
      }
      await client.query(
        `INSERT INTO analytics.paid_route_facts
           (event_id, local_date, booking_id, route_id, route_code, ticket_count, revenue_vnd)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (event_id) DO UPDATE
         SET local_date = EXCLUDED.local_date,
             route_id = EXCLUDED.route_id,
             route_code = EXCLUDED.route_code,
             ticket_count = EXCLUDED.ticket_count,
             revenue_vnd = EXCLUDED.revenue_vnd`,
        [
          event.eventId,
          localDate,
          event.payload.bookingId,
          event.payload.routeId,
          event.payload.routeCode,
          event.payload.passengerCount,
          event.payload.totalPriceVnd,
        ],
      );
      return isNewEvent;
    });
  }

  async applyPaymentEvent(event: PaymentAttemptedV1): Promise<boolean> {
    return this.database.withTransaction(async (client) => {
      const accepted = await client.query(
        `INSERT INTO analytics.processed_events
           (event_id, topic, event_type, occurred_at)
         VALUES ($1, 'payment-events', $2, $3)
         ON CONFLICT (event_id) DO NOTHING
         RETURNING event_id`,
        [event.eventId, event.eventType, event.occurredAt],
      );
      const isNewEvent = accepted.rowCount === 1;
      await client.query(
        `INSERT INTO analytics.payment_attempt_facts
           (event_id, local_date, payment_attempt_id, booking_id,
            requested_outcome, status, amount_vnd)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (event_id) DO NOTHING`,
        [
          event.eventId,
          vietnamLocalDate(event.occurredAt),
          event.payload.paymentAttemptId,
          event.payload.bookingId,
          event.payload.requestedOutcome,
          event.payload.status,
          event.payload.amountVnd,
        ],
      );
      return isNewEvent;
    });
  }

  async applySearchEvent(event: SearchPerformedEvent): Promise<boolean> {
    return this.database.withTransaction(async (client) => {
      const accepted = await client.query(
        `INSERT INTO analytics.processed_events
           (event_id, topic, event_type, occurred_at)
         VALUES ($1, 'search-events', $2, $3)
         ON CONFLICT (event_id) DO NOTHING
         RETURNING event_id`,
        [event.eventId, event.eventType, event.occurredAt],
      );
      if (accepted.rowCount !== 1) return false;
      await client.query(
        `INSERT INTO analytics.search_facts
           (event_id, local_date, search_session_id, result_count)
         VALUES ($1, $2, $3, $4)`,
        [
          event.eventId,
          vietnamLocalDate(event.occurredAt),
          event.searchSessionId,
          event.payload.resultCount,
        ],
      );
      if (event.eventType === 'SearchPerformedV2') {
        for (const route of event.payload.matchedRoutes) {
          await client.query(
            `INSERT INTO analytics.search_route_matches (event_id, route_id, route_label)
             VALUES ($1, $2, $3)
             ON CONFLICT (event_id, route_id) DO NOTHING`,
            [event.eventId, route.routeId, `${route.originName} → ${route.destinationName}`],
          );
        }
      }
      return true;
    });
  }

  async getRevenueSummary(
    input: { fromDate: string; toDate: string; requestId: string },
    actor: AnalyticsActor,
  ) {
    validateAdminDateRange(input, actor);

    const result = await this.database.query<{
      local_date: string;
      revenue_vnd: string;
      paid_booking_count: number;
      ticket_count: number;
    }>(
      `SELECT local_date::text, revenue_vnd::text, paid_booking_count, ticket_count
       FROM analytics.daily_revenue
       WHERE local_date BETWEEN $1::date AND $2::date
       ORDER BY local_date`,
      [input.fromDate, input.toDate],
    );
    const freshness = await this.database.query<{ last_processed_at: Date | null }>(
      'SELECT max(processed_at) AS last_processed_at FROM analytics.processed_events',
    );
    const days = result.rows.map((row) => ({
      localDate: row.local_date,
      revenueVnd: Number(row.revenue_vnd),
      paidBookingCount: row.paid_booking_count,
      ticketCount: row.ticket_count,
    }));
    return {
      days,
      totalRevenueVnd: days.reduce((total, day) => total + day.revenueVnd, 0),
      paidBookingCount: days.reduce((total, day) => total + day.paidBookingCount, 0),
      ticketCount: days.reduce((total, day) => total + day.ticketCount, 0),
      lastProcessedAt: freshness.rows[0]?.last_processed_at?.toISOString(),
      timezone: 'Asia/Ho_Chi_Minh',
      requestId: input.requestId,
    };
  }

  async getPopularRoutes(
    input: { fromDate: string; toDate: string; limit: number; requestId: string },
    actor: AnalyticsActor,
  ) {
    validateAdminDateRange(input, actor);
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 20) {
      throw new AnalyticsValidationError('Popular route limit must be between 1 and 20.');
    }
    const result = await this.database.query<{
      route_id: string;
      route_code: string;
      route_label: string;
      search_count: number;
      paid_booking_count: number;
    }>(
      `WITH searches AS (
         SELECT match.route_id, max(match.route_label) AS route_label, count(*)::integer AS search_count
         FROM analytics.search_route_matches AS match
         JOIN analytics.search_facts AS search ON search.event_id = match.event_id
         WHERE search.local_date BETWEEN $1::date AND $2::date
         GROUP BY match.route_id
       ), paid AS (
         SELECT route_id, max(route_code) AS route_code, count(*)::integer AS paid_booking_count
         FROM analytics.paid_route_facts
         WHERE local_date BETWEEN $1::date AND $2::date
         GROUP BY route_id
       )
       SELECT coalesce(searches.route_id, paid.route_id)::text AS route_id,
              coalesce(paid.route_code, '') AS route_code,
              coalesce(searches.route_label, paid.route_code, 'Unknown route') AS route_label,
              coalesce(searches.search_count, 0)::integer AS search_count,
              coalesce(paid.paid_booking_count, 0)::integer AS paid_booking_count
       FROM searches FULL OUTER JOIN paid ON paid.route_id = searches.route_id
       ORDER BY search_count DESC, paid_booking_count DESC, route_id
       LIMIT $3`,
      [input.fromDate, input.toDate, input.limit],
    );
    return {
      routes: result.rows.map((row) => ({
        routeId: row.route_id,
        routeCode: row.route_code,
        routeLabel: row.route_label,
        searchCount: row.search_count,
        paidBookingCount: row.paid_booking_count,
        conversionRate: conversionRate(row.search_count, row.paid_booking_count),
      })),
      lastProcessedAt: await this.lastProcessedAt(),
      timezone: 'Asia/Ho_Chi_Minh',
      requestId: input.requestId,
    };
  }

  async getPublicPopularRoutes(input: {
    fromDate: string;
    toDate: string;
    limit: number;
    requestId: string;
  }) {
    validatePublicDateRange(input);
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 10) {
      throw new AnalyticsValidationError('Public popular route limit must be between 1 and 10.');
    }
    const result = await this.database.query<{
      route_id: string;
      route_code: string;
      route_label: string;
      search_count: number;
    }>(
      `WITH searches AS (
         SELECT match.route_id, max(match.route_label) AS route_label,
                count(*)::integer AS search_count
         FROM analytics.search_route_matches AS match
         JOIN analytics.search_facts AS search ON search.event_id = match.event_id
         WHERE search.local_date BETWEEN $1::date AND $2::date
         GROUP BY match.route_id
       ), codes AS (
         SELECT route_id, max(route_code) AS route_code
         FROM analytics.paid_route_facts
         GROUP BY route_id
       )
       SELECT searches.route_id::text,
              coalesce(codes.route_code, '') AS route_code,
              searches.route_label,
              searches.search_count
       FROM searches
       LEFT JOIN codes ON codes.route_id = searches.route_id
       ORDER BY searches.search_count DESC, searches.route_id
       LIMIT $3`,
      [input.fromDate, input.toDate, input.limit],
    );
    return {
      routes: result.rows.map((row) => ({
        routeId: row.route_id,
        routeCode: row.route_code,
        routeLabel: row.route_label,
        searchCount: row.search_count,
      })),
      fromDate: input.fromDate,
      toDate: input.toDate,
      lastProcessedAt: await this.lastProcessedAt(),
      timezone: 'Asia/Ho_Chi_Minh',
      requestId: input.requestId,
    };
  }

  async getSearchConversion(
    input: { fromDate: string; toDate: string; requestId: string },
    actor: AnalyticsActor,
  ) {
    validateAdminDateRange(input, actor);
    const result = await this.database.query<{
      search_count: number;
      paid_booking_count: number;
    }>(
      `SELECT
         (SELECT count(*)::integer FROM analytics.search_facts
          WHERE local_date BETWEEN $1::date AND $2::date) AS search_count,
         (SELECT count(*)::integer FROM analytics.paid_route_facts
          WHERE local_date BETWEEN $1::date AND $2::date) AS paid_booking_count`,
      [input.fromDate, input.toDate],
    );
    const counts = result.rows[0] ?? { search_count: 0, paid_booking_count: 0 };
    return {
      searchCount: counts.search_count,
      paidBookingCount: counts.paid_booking_count,
      conversionRate: conversionRate(counts.search_count, counts.paid_booking_count),
      lastProcessedAt: await this.lastProcessedAt(),
      timezone: 'Asia/Ho_Chi_Minh',
      requestId: input.requestId,
    };
  }

  async getTicketSalesByRoute(
    input: { fromDate: string; toDate: string; limit: number; requestId: string },
    actor: AnalyticsActor,
  ) {
    validateAdminDateRange(input, actor);
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 20) {
      throw new AnalyticsValidationError('Ticket sales route limit must be between 1 and 20.');
    }
    const result = await this.database.query<{
      route_id: string;
      route_code: string;
      route_label: string;
      paid_booking_count: number;
      ticket_count: string;
      revenue_vnd: string;
    }>(
      `WITH labels AS (
         SELECT match.route_id, max(match.route_label) AS route_label
         FROM analytics.search_route_matches AS match
         GROUP BY match.route_id
       )
       SELECT paid.route_id::text,
              max(paid.route_code) AS route_code,
              coalesce(max(labels.route_label), max(paid.route_code)) AS route_label,
              count(*)::integer AS paid_booking_count,
              sum(paid.ticket_count)::text AS ticket_count,
              sum(paid.revenue_vnd)::text AS revenue_vnd
       FROM analytics.paid_route_facts AS paid
       LEFT JOIN labels ON labels.route_id = paid.route_id
       WHERE paid.local_date BETWEEN $1::date AND $2::date
       GROUP BY paid.route_id
       ORDER BY sum(paid.ticket_count) DESC, sum(paid.revenue_vnd) DESC, paid.route_id
       LIMIT $3`,
      [input.fromDate, input.toDate, input.limit],
    );
    return {
      routes: result.rows.map((row) => ({
        routeId: row.route_id,
        routeCode: row.route_code,
        routeLabel: row.route_label,
        paidBookingCount: row.paid_booking_count,
        ticketCount: Number(row.ticket_count),
        revenueVnd: Number(row.revenue_vnd),
      })),
      lastProcessedAt: await this.lastProcessedAt(),
      timezone: 'Asia/Ho_Chi_Minh',
      requestId: input.requestId,
    };
  }

  async getPaymentSummary(
    input: { fromDate: string; toDate: string; requestId: string },
    actor: AnalyticsActor,
  ) {
    validateAdminDateRange(input, actor);
    const result = await this.database.query<{
      attempt_count: number;
      succeeded_count: number;
      failed_count: number;
      succeeded_amount_vnd: string;
    }>(
      `SELECT count(*)::integer AS attempt_count,
              count(*) FILTER (WHERE status = 'SUCCEEDED')::integer AS succeeded_count,
              count(*) FILTER (WHERE status = 'FAILED')::integer AS failed_count,
              coalesce(sum(amount_vnd) FILTER (WHERE status = 'SUCCEEDED'), 0)::text
                AS succeeded_amount_vnd
       FROM analytics.payment_attempt_facts
       WHERE local_date BETWEEN $1::date AND $2::date`,
      [input.fromDate, input.toDate],
    );
    const counts = result.rows[0] ?? {
      attempt_count: 0,
      succeeded_count: 0,
      failed_count: 0,
      succeeded_amount_vnd: '0',
    };
    return {
      attemptCount: counts.attempt_count,
      succeededCount: counts.succeeded_count,
      failedCount: counts.failed_count,
      successRate: conversionRate(counts.attempt_count, counts.succeeded_count),
      succeededAmountVnd: Number(counts.succeeded_amount_vnd),
      lastProcessedAt: await this.lastProcessedAt(),
      timezone: 'Asia/Ho_Chi_Minh',
      requestId: input.requestId,
    };
  }

  async readiness(): Promise<void> {
    await this.database.ping();
  }

  private async lastProcessedAt(): Promise<string | undefined> {
    const result = await this.database.query<{ last_processed_at: Date | null }>(
      'SELECT max(processed_at) AS last_processed_at FROM analytics.processed_events',
    );
    return result.rows[0]?.last_processed_at?.toISOString();
  }
}

export function vietnamLocalDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new AnalyticsValidationError('Event time is invalid.');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function isBookingDomainEvent(value: unknown): value is BookingDomainEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Partial<BookingDomainEvent>;
  const envelopeValid =
    typeof event.eventId === 'string' &&
    isUuid(event.eventId) &&
    event.eventVersion === 1 &&
    typeof event.occurredAt === 'string' &&
    isValidTimestamp(event.occurredAt) &&
    typeof event.traceId === 'string' &&
    event.traceId.length > 0 &&
    typeof event.requestId === 'string' &&
    event.requestId.length > 0 &&
    typeof event.aggregateId === 'string' &&
    isUuid(event.aggregateId) &&
    event.producer === 'booking-service' &&
    typeof event.eventType === 'string' &&
    ['BookingCreatedV1', 'BookingPaidV1', 'BookingExpiredV1', 'BookingCancelledV1'].includes(
      event.eventType,
    ) &&
    Boolean(event.payload);
  if (!envelopeValid) return false;
  if (event.eventType !== 'BookingPaidV1') return true;
  const payload = event.payload as Partial<BookingDomainEvent['payload']>;
  return (
    typeof payload === 'object' &&
    isUuid(String(payload.bookingId ?? '')) &&
    isUuid(String(payload.tripId ?? '')) &&
    isUuid(String(payload.routeId ?? '')) &&
    typeof payload.routeCode === 'string' &&
    payload.routeCode.length > 0 &&
    Array.isArray(payload.seatIds) &&
    payload.seatIds.length > 0 &&
    typeof (payload as { paidAt?: unknown }).paidAt === 'string' &&
    isValidTimestamp(String((payload as { paidAt?: unknown }).paidAt)) &&
    isUuid(String((payload as { paymentAttemptId?: unknown }).paymentAttemptId ?? '')) &&
    Number.isSafeInteger((payload as { totalPriceVnd?: unknown }).totalPriceVnd) &&
    Number((payload as { totalPriceVnd?: unknown }).totalPriceVnd) >= 0 &&
    Number.isInteger((payload as { passengerCount?: unknown }).passengerCount) &&
    Number((payload as { passengerCount?: unknown }).passengerCount) > 0
  );
}

export function isSearchPerformedEvent(value: unknown): value is SearchPerformedEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Partial<SearchPerformedEvent>;
  if (
    !isUuid(String(event.eventId ?? '')) ||
    !isUuid(String(event.searchSessionId ?? '')) ||
    event.eventVersion !== (event.eventType === 'SearchPerformedV1' ? 1 : 2) ||
    typeof event.occurredAt !== 'string' ||
    !isValidTimestamp(event.occurredAt) ||
    typeof event.traceId !== 'string' ||
    event.traceId.length === 0 ||
    event.producer !== 'catalog-service' ||
    (event.eventType !== 'SearchPerformedV1' && event.eventType !== 'SearchPerformedV2') ||
    !event.payload ||
    !Number.isInteger(event.payload.resultCount) ||
    event.payload.resultCount < 0 ||
    !isUuid(String(event.payload.originLocationId ?? '')) ||
    !isUuid(String(event.payload.destinationLocationId ?? ''))
  ) {
    return false;
  }
  if (event.eventType === 'SearchPerformedV1') return true;
  const v2 = event as Partial<SearchPerformedV2>;
  return (
    Array.isArray(v2.payload?.matchedRoutes) &&
    v2.payload.matchedRoutes.every(
      (route) =>
        Boolean(route) &&
        typeof route === 'object' &&
        isUuid(String(route.routeId ?? '')) &&
        typeof route.originName === 'string' &&
        route.originName.trim().length > 0 &&
        typeof route.destinationName === 'string' &&
        route.destinationName.trim().length > 0,
    )
  );
}

export function isPaymentAttemptedEvent(value: unknown): value is PaymentAttemptedV1 {
  if (!value || typeof value !== 'object') return false;
  const event = value as Partial<PaymentAttemptedV1>;
  const payload = event.payload as Partial<PaymentAttemptedV1['payload']> | undefined;
  return (
    event.eventType === 'PaymentAttemptedV1' &&
    event.eventVersion === 1 &&
    isUuid(String(event.eventId ?? '')) &&
    typeof event.occurredAt === 'string' &&
    isValidTimestamp(event.occurredAt) &&
    typeof event.traceId === 'string' &&
    event.traceId.length > 0 &&
    typeof event.requestId === 'string' &&
    event.requestId.length > 0 &&
    isUuid(String(event.aggregateId ?? '')) &&
    event.producer === 'payment-service' &&
    Boolean(payload) &&
    isUuid(String(payload?.paymentAttemptId ?? '')) &&
    isUuid(String(payload?.bookingId ?? '')) &&
    (payload?.requestedOutcome === 'SUCCESS' || payload?.requestedOutcome === 'FAILURE') &&
    (payload?.status === 'SUCCEEDED' || payload?.status === 'FAILED') &&
    Number.isSafeInteger(payload?.amountVnd) &&
    Number(payload?.amountVnd) >= 0 &&
    (payload?.status === 'SUCCEEDED' ? payload?.requestedOutcome === 'SUCCESS' : true) &&
    (payload?.status === 'FAILED'
      ? typeof payload.failureCode === 'string' && payload.failureCode.length > 0
      : !payload?.failureCode)
  );
}

function validateAdminDateRange(
  input: { fromDate: string; toDate: string },
  actor: AnalyticsActor,
): void {
  if (actor.role !== 'ADMIN' || !isUuid(actor.id) || !isUuid(actor.tokenId)) {
    throw new AnalyticsAuthorizationError('Admin role is required.');
  }
  if (!isLocalDate(input.fromDate) || !isLocalDate(input.toDate) || input.fromDate > input.toDate) {
    throw new AnalyticsValidationError('Date range is invalid.');
  }
}

function validatePublicDateRange(input: { fromDate: string; toDate: string }): void {
  if (!isLocalDate(input.fromDate) || !isLocalDate(input.toDate) || input.fromDate > input.toDate) {
    throw new AnalyticsValidationError('Date range is invalid.');
  }
  const durationDays =
    (Date.parse(`${input.toDate}T00:00:00.000Z`) - Date.parse(`${input.fromDate}T00:00:00.000Z`)) /
      86_400_000 +
    1;
  if (durationDays > 31) {
    throw new AnalyticsValidationError('Public popular route range cannot exceed 31 days.');
  }
}

function conversionRate(searchCount: number, paidBookingCount: number): number {
  return searchCount === 0
    ? 0
    : Math.min(100, Math.round((paidBookingCount / searchCount) * 10_000) / 100);
}

function isLocalDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isValidTimestamp(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}
