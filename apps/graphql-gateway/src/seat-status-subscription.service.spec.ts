import { describe, expect, it } from 'vitest';

import { parseSeatStatusEvent } from './seat-status-subscription.service';

const validEvent = {
  eventId: '00000000-0000-4000-8000-000000000903',
  eventType: 'SeatStatusChangedV1',
  eventVersion: 1,
  occurredAt: '2030-06-20T00:00:00.000Z',
  producer: 'seat-inventory-service',
  tripId: '00000000-0000-4000-8000-000000000701',
  seatIds: ['A03'],
  status: 'HELD',
  expiresAt: '2030-06-20T00:05:00.000Z',
  version: 1,
} as const;

describe('SeatStatusSubscriptionService event boundary', () => {
  it('accepts the versioned privacy-safe seat event', () => {
    expect(parseSeatStatusEvent(JSON.stringify(validEvent))).toEqual(validEvent);
    const bookedEvent = {
      ...validEvent,
      eventId: '00000000-0000-4000-8000-000000000904',
      eventType: 'SeatStatusChangedV2',
      eventVersion: 2,
      status: 'BOOKED',
      expiresAt: undefined,
      version: 2,
    };
    const parsedBookedEvent = parseSeatStatusEvent(JSON.stringify(bookedEvent));
    expect(parsedBookedEvent).toEqual(
      expect.objectContaining({
        eventId: bookedEvent.eventId,
        tripId: validEvent.tripId,
        seatIds: validEvent.seatIds,
        status: 'BOOKED',
        version: 2,
      }),
    );
    expect(parsedBookedEvent).not.toHaveProperty('expiresAt');
    expect(
      parseSeatStatusEvent(
        JSON.stringify({
          ...bookedEvent,
          eventId: '00000000-0000-4000-8000-000000000905',
          status: 'BLOCKED',
          version: 3,
        }),
      ),
    ).toEqual(expect.objectContaining({ status: 'BLOCKED', version: 3 }));
  });

  it('rejects messages with checkout secrets or malformed versions', () => {
    expect(parseSeatStatusEvent(JSON.stringify({ ...validEvent, holdToken: 'secret' }))).toBeNull();
    expect(
      parseSeatStatusEvent(JSON.stringify({ ...validEvent, owner: { id: 'secret' } })),
    ).toBeNull();
    expect(parseSeatStatusEvent(JSON.stringify({ ...validEvent, version: 0 }))).toBeNull();
    expect(
      parseSeatStatusEvent(
        JSON.stringify({
          ...validEvent,
          eventType: 'SeatStatusChangedV1',
          eventVersion: 1,
          status: 'BOOKED',
        }),
      ),
    ).toBeNull();
  });
});
