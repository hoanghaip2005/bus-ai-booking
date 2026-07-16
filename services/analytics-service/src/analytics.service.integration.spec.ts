import { randomUUID } from 'node:crypto';

import type { BookingPaidV1, PaymentAttemptedV1, SearchPerformedV2 } from '@bus/contracts-events';
import { afterAll, describe, expect, it } from 'vitest';

import { AnalyticsDatabase } from './analytics.database';
import { AnalyticsAuthorizationError, AnalyticsService } from './analytics.service';

const database = new AnalyticsDatabase();
const service = new AnalyticsService(database);
const routeId = randomUUID();
const event = bookingPaidEvent(routeId);
const searchEvent = searchPerformedEvent(routeId);
const paymentEvent = paymentAttemptedEvent(event.payload.bookingId);

describe.sequential('analytics daily revenue projection integration', () => {
  afterAll(async () => {
    await database.query('DELETE FROM analytics.paid_route_facts WHERE event_id = $1', [
      event.eventId,
    ]);
    await database.query('DELETE FROM analytics.search_facts WHERE event_id = $1', [
      searchEvent.eventId,
    ]);
    await database.query('DELETE FROM analytics.payment_attempt_facts WHERE event_id = $1', [
      paymentEvent.eventId,
    ]);
    await database.query(
      'DELETE FROM analytics.processed_events WHERE event_id = ANY($1::uuid[])',
      [[event.eventId, searchEvent.eventId, paymentEvent.eventId]],
    );
    await database.query("DELETE FROM analytics.daily_revenue WHERE local_date = '2098-04-03'");
    await database.onModuleDestroy();
  });

  it('deduplicates replayed events and exposes an ADMIN-only summary', async () => {
    await expect(service.applyBookingEvent(event)).resolves.toBe(true);
    await expect(service.applyBookingEvent(event)).resolves.toBe(false);
    await expect(service.applySearchEvent(searchEvent)).resolves.toBe(true);
    await expect(service.applySearchEvent(searchEvent)).resolves.toBe(false);
    await expect(service.applyPaymentEvent(paymentEvent)).resolves.toBe(true);
    await expect(service.applyPaymentEvent(paymentEvent)).resolves.toBe(false);

    const summary = await service.getRevenueSummary(
      { fromDate: '2098-04-03', toDate: '2098-04-03', requestId: randomUUID() },
      { id: randomUUID(), role: 'ADMIN', tokenId: randomUUID() },
    );
    expect(summary).toMatchObject({
      totalRevenueVnd: 560_000,
      paidBookingCount: 1,
      ticketCount: 2,
      timezone: 'Asia/Ho_Chi_Minh',
      days: [
        {
          localDate: '2098-04-03',
          revenueVnd: 560_000,
          paidBookingCount: 1,
          ticketCount: 2,
        },
      ],
    });
    expect(summary.lastProcessedAt).toBeTruthy();

    const popular = await service.getPopularRoutes(
      { fromDate: '2098-04-03', toDate: '2098-04-03', limit: 5, requestId: randomUUID() },
      { id: randomUUID(), role: 'ADMIN', tokenId: randomUUID() },
    );
    expect(popular.routes).toEqual([
      {
        routeId,
        routeCode: 'HCM-DLI',
        routeLabel: 'TP.HCM → Đà Lạt',
        searchCount: 1,
        paidBookingCount: 1,
        conversionRate: 100,
      },
    ]);

    await expect(
      service.getPublicPopularRoutes({
        fromDate: '2098-04-03',
        toDate: '2098-04-03',
        limit: 5,
        requestId: randomUUID(),
      }),
    ).resolves.toMatchObject({
      fromDate: '2098-04-03',
      toDate: '2098-04-03',
      timezone: 'Asia/Ho_Chi_Minh',
      routes: [{ routeId, routeCode: 'HCM-DLI', searchCount: 1 }],
    });

    await expect(
      service.getSearchConversion(
        { fromDate: '2098-04-03', toDate: '2098-04-03', requestId: randomUUID() },
        { id: randomUUID(), role: 'ADMIN', tokenId: randomUUID() },
      ),
    ).resolves.toMatchObject({ searchCount: 1, paidBookingCount: 1, conversionRate: 100 });

    await expect(
      service.getTicketSalesByRoute(
        { fromDate: '2098-04-03', toDate: '2098-04-03', limit: 5, requestId: randomUUID() },
        { id: randomUUID(), role: 'ADMIN', tokenId: randomUUID() },
      ),
    ).resolves.toMatchObject({
      routes: [
        {
          routeId,
          routeCode: 'HCM-DLI',
          paidBookingCount: 1,
          ticketCount: 2,
          revenueVnd: 560_000,
        },
      ],
    });

    await expect(
      service.getPaymentSummary(
        { fromDate: '2098-04-03', toDate: '2098-04-03', requestId: randomUUID() },
        { id: randomUUID(), role: 'ADMIN', tokenId: randomUUID() },
      ),
    ).resolves.toMatchObject({
      attemptCount: 1,
      succeededCount: 1,
      failedCount: 0,
      successRate: 100,
      succeededAmountVnd: 560_000,
    });

    await expect(
      service.getRevenueSummary(
        { fromDate: '2098-04-03', toDate: '2098-04-03', requestId: randomUUID() },
        { id: randomUUID(), role: 'CUSTOMER', tokenId: randomUUID() },
      ),
    ).rejects.toBeInstanceOf(AnalyticsAuthorizationError);
  });
});

function bookingPaidEvent(routeId: string): BookingPaidV1 {
  const bookingId = randomUUID();
  return {
    eventId: randomUUID(),
    eventType: 'BookingPaidV1',
    eventVersion: 1,
    occurredAt: '2098-04-02T18:30:00.000Z',
    traceId: randomUUID().replaceAll('-', ''),
    requestId: randomUUID(),
    producer: 'booking-service',
    aggregateId: bookingId,
    actorCategory: 'GUEST',
    checkoutSessionId: randomUUID(),
    payload: {
      bookingId,
      tripId: randomUUID(),
      routeId,
      routeCode: 'HCM-DLI',
      seatIds: ['A01', 'A02'],
      passengerCount: 2,
      totalPriceVnd: 560_000,
      paymentAttemptId: randomUUID(),
      paidAt: '2098-04-02T18:30:00.000Z',
      status: 'PAID',
    },
  };
}

function searchPerformedEvent(routeId: string): SearchPerformedV2 {
  return {
    eventId: randomUUID(),
    eventType: 'SearchPerformedV2',
    eventVersion: 2,
    occurredAt: '2098-04-02T18:31:00.000Z',
    traceId: randomUUID().replaceAll('-', ''),
    producer: 'catalog-service',
    searchSessionId: randomUUID(),
    actorCategory: 'GUEST',
    payload: {
      originLocationId: randomUUID(),
      destinationLocationId: randomUUID(),
      travelDate: '2098-04-03',
      operatorCodes: [],
      vehicleTypeCodes: [],
      sort: 'DEPARTURE_EARLIEST',
      resultCount: 2,
      nearestDateCount: 0,
      cacheStatus: 'MISS',
      matchedRoutes: [{ routeId, originName: 'TP.HCM', destinationName: 'Đà Lạt' }],
    },
  };
}

function paymentAttemptedEvent(bookingId: string): PaymentAttemptedV1 {
  return {
    eventId: randomUUID(),
    eventType: 'PaymentAttemptedV1',
    eventVersion: 1,
    occurredAt: '2098-04-02T18:32:00.000Z',
    traceId: randomUUID().replaceAll('-', ''),
    requestId: randomUUID(),
    producer: 'payment-service',
    aggregateId: bookingId,
    actorCategory: 'GUEST',
    checkoutSessionId: randomUUID(),
    payload: {
      paymentAttemptId: randomUUID(),
      bookingId,
      requestedOutcome: 'SUCCESS',
      status: 'SUCCEEDED',
      amountVnd: 560_000,
    },
  };
}
