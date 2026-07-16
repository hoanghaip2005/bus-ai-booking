import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createBookingCreatedDispatch, createBookingExpiredDispatch } from './booking.events';
import type { PersistBookingInput } from './booking.types';

describe('booking event contracts', () => {
  it('creates a privacy-safe booking fact and propagates actor metadata in headers', () => {
    const booking = persistBooking();
    const dispatch = createBookingCreatedDispatch(booking, 'request-booking-created');

    expect(dispatch.event).toMatchObject({
      eventType: 'BookingCreatedV1',
      aggregateId: booking.id,
      actorCategory: 'GUEST',
      checkoutSessionId: booking.owner.id,
      payload: { bookingId: booking.id, seatIds: ['A03'], totalPriceVnd: 280000 },
    });
    expect(dispatch.headers).toMatchObject({
      actorCategory: 'GUEST',
      actorId: booking.owner.id,
      requestId: 'request-booking-created',
    });
    expect(JSON.stringify(dispatch.event)).not.toMatch(
      /hold-token|an@example\.com|0901234567|document/i,
    );
  });

  it('marks background expiry as SYSTEM without dropping the checkout funnel id', () => {
    const booking = persistBooking();
    const dispatch = createBookingExpiredDispatch({
      booking: {
        id: booking.id,
        bookingCode: booking.bookingCode,
        status: 'PENDING_PAYMENT',
        trip: booking.trip,
        contact: booking.contact,
        passengers: booking.passengers.map((passenger) => ({
          id: passenger.id,
          seatId: passenger.seatId,
          fullName: passenger.fullName,
          hasDocumentNumber: false,
        })),
        totalPriceVnd: booking.totalPriceVnd,
        holdExpiresAt: booking.holdExpiresAt,
        createdAt: booking.createdAt,
      },
      owner: booking.owner,
      expiredAt: '2030-06-20T00:05:00.000Z',
      reason: 'HOLD_EXPIRED',
      requestId: 'request-expiry',
      actor: { category: 'SYSTEM', id: '00000000-0000-4000-8000-000000000001' },
    });

    expect(dispatch.event).toMatchObject({
      actorCategory: 'SYSTEM',
      checkoutSessionId: booking.owner.id,
      payload: { reason: 'HOLD_EXPIRED', status: 'EXPIRED' },
    });
    expect(dispatch.headers.actorId).toBe('00000000-0000-4000-8000-000000000001');
  });
});

function persistBooking(): PersistBookingInput {
  return {
    id: randomUUID(),
    bookingCode: 'BV-2030-ABC1234567',
    owner: { type: 'GUEST_SESSION', id: randomUUID() },
    idempotencyKey: randomUUID(),
    requestFingerprint: 'a'.repeat(64),
    holdToken: 'hold-token-1234567890',
    holdExpiresAt: '2030-06-20T00:05:00.000Z',
    contact: { fullName: 'Nguyen Van An', email: 'an@example.com', phone: '0901234567' },
    normalizedEmail: 'an@example.com',
    trip: {
      tripId: '00000000-0000-4000-8000-000000000701',
      routeId: '00000000-0000-4000-8000-000000000501',
      routeCode: 'HCM-DLI',
      operatorName: 'Phuong Trang Demo',
      vehicleTypeName: 'Sleeper 34',
      vehicleCode: 'PT-S34-01',
      vehiclePlate: '51B-120.01',
      originName: 'TP.HCM',
      destinationName: 'Da Lat',
      pickupName: 'Ben xe Mien Dong',
      dropoffName: 'Ben xe Da Lat',
      departureAt: '2030-06-20T01:00:00.000Z',
      arrivalAt: '2030-06-20T07:00:00.000Z',
      timezone: 'Asia/Ho_Chi_Minh',
      unitPriceVnd: 280000,
    },
    passengers: [{ id: randomUUID(), seatId: 'A03', fullName: 'Nguyen Van An' }],
    totalPriceVnd: 280000,
    createdAt: '2030-06-20T00:01:00.000Z',
  };
}
