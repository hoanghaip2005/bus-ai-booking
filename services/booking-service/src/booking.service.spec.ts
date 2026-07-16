import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  assertCancellationAllowed,
  BookingCancellationPolicyError,
  BookingLookupNotFoundError,
  BookingService,
  BookingValidationError,
  validateCreateBookingRequest,
  validatePassengerSeatMapping,
} from './booking.service';
import type { BookingRepository } from './booking.repository';

describe('BookingService domain validation', () => {
  it('normalizes guest contact and creates a stable fingerprint', () => {
    const request = {
      holdToken: 'hold-token-1234567890',
      owner: { type: 'GUEST_SESSION' as const, id: randomUUID() },
      idempotencyKey: 'booking-idempotency-123',
      contact: {
        fullName: '  Nguyen   Van An ',
        email: ' AN@Example.COM ',
        phone: '090 123 4567',
      },
      passengers: [
        { seatId: 'A02', fullName: ' Tran Thi B ' },
        { seatId: 'A01', fullName: ' Nguyen Van An ', phone: '091-222-3333' },
      ],
    };

    const first = validateCreateBookingRequest(request);
    const second = validateCreateBookingRequest(request);

    expect(first.contact).toEqual({
      fullName: 'Nguyen Van An',
      email: 'an@example.com',
      phone: '0901234567',
    });
    expect(first.passengers.map((passenger) => passenger.seatId)).toEqual(['A01', 'A02']);
    expect(first.requestFingerprint).toBe(second.requestFingerprint);
  });

  it('requires one passenger for every held seat with no extras', () => {
    expect(() =>
      validatePassengerSeatMapping([{ seatId: 'A01', fullName: 'Nguyen Van An' }], ['A01', 'A02']),
    ).toThrow(BookingValidationError);
  });

  it('rejects duplicate passenger seat assignments', () => {
    expect(() =>
      validateCreateBookingRequest({
        holdToken: 'hold-token-1234567890',
        owner: { type: 'GUEST_SESSION', id: randomUUID() },
        idempotencyKey: 'booking-idempotency-123',
        contact: {
          fullName: 'Nguyen Van An',
          email: 'an@example.com',
          phone: '0901234567',
        },
        passengers: [
          { seatId: 'A01', fullName: 'Nguyen Van An' },
          { seatId: 'A01', fullName: 'Tran Thi B' },
        ],
      }),
    ).toThrow('Each held seat must have exactly one passenger.');
  });

  it('allows paid cancellation strictly before departure using a fixed clock', () => {
    const booking = {
      trip: { departureAt: '2030-06-20T10:00:00.000Z' },
    } as never;

    expect(() =>
      assertCancellationAllowed(booking, new Date('2030-06-20T09:59:59.999Z')),
    ).not.toThrow();
    expect(() => assertCancellationAllowed(booking, new Date('2030-06-20T10:00:00.000Z'))).toThrow(
      BookingCancellationPolicyError,
    );
  });

  it('requires both normalized guest credentials and returns a privacy-minimal lookup', async () => {
    const findGuestBookingLookup = vi.fn(async () => ({
      bookingCode: 'BV-2030-ABC1234567',
      status: 'PAID' as const,
      tripId: '00000000-0000-4000-8000-000000000701',
      originName: 'TP.HCM',
      destinationName: 'Đà Lạt',
      departureAt: '2030-06-20T00:00:00.000Z',
      timezone: 'Asia/Ho_Chi_Minh',
      seatIds: ['A01'],
      ticketIssued: false,
      cancellationEligible: true,
    }));
    const service = new BookingService(
      {} as never,
      { findGuestBookingLookup } as unknown as BookingRepository,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.getGuestBookingLookup({
        bookingCode: 'bv-2030-abc1234567',
        normalizedEmail: ' Guest@Example.com ',
      }),
    ).resolves.toMatchObject({
      booking: { bookingCode: 'BV-2030-ABC1234567', status: 'PAID', seatIds: ['A01'] },
    });
    expect(findGuestBookingLookup).toHaveBeenCalledWith(
      'BV-2030-ABC1234567',
      'guest@example.com',
      expect.any(Date),
    );
  });

  it('returns the same neutral lookup error for an unknown code or wrong email', async () => {
    const service = new BookingService(
      {} as never,
      { findGuestBookingLookup: vi.fn(async () => null) } as unknown as BookingRepository,
      {} as never,
      {} as never,
      {} as never,
    );
    await expect(
      service.getGuestBookingLookup({
        bookingCode: 'BV-2030-ABC1234567',
        normalizedEmail: 'wrong@example.com',
      }),
    ).rejects.toBeInstanceOf(BookingLookupNotFoundError);
  });
});
