import { describe, expect, it } from 'vitest';

import {
  AnalyticsValidationError,
  isBookingDomainEvent,
  isPaymentAttemptedEvent,
  isSearchPerformedEvent,
  vietnamLocalDate,
} from './analytics.service';

describe('analytics projection date', () => {
  it('rejects analytics events with malformed envelopes or mismatched payloads', () => {
    expect(isSearchPerformedEvent({ eventType: 'SearchPerformedV2' })).toBe(false);
    expect(isPaymentAttemptedEvent({ eventType: 'PaymentAttemptedV1' })).toBe(false);
    expect(
      isBookingDomainEvent({
        eventId: '00000000-0000-4000-8000-000000000001',
        eventVersion: 1,
        eventType: 'BookingPaidV1',
        occurredAt: '2026-07-18T00:00:00.000Z',
        traceId: 'trace',
        requestId: 'request',
        aggregateId: '00000000-0000-4000-8000-000000000002',
        actorCategory: 'CUSTOMER',
        producer: 'booking-service',
        payload: { totalPriceVnd: 200_000, passengerCount: 1 },
      }),
    ).toBe(false);
  });

  it('uses the Vietnam-local calendar date for event time', () => {
    expect(vietnamLocalDate('2026-07-14T18:30:00.000Z')).toBe('2026-07-15');
  });

  it('rejects invalid event time', () => {
    expect(() => vietnamLocalDate('not-a-date')).toThrow(AnalyticsValidationError);
  });
});
