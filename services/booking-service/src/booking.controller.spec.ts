import { Metadata, status } from '@grpc/grpc-js';
import { describe, expect, it, vi } from 'vitest';

import { BookingController } from './booking.controller';
import type { BookingService } from './booking.service';

const customerId = '00000000-0000-4000-8000-000000001401';
const tokenId = '00000000-0000-4000-8000-000000009001';

describe('BookingController customer authorization', () => {
  it('derives my-bookings ownership from validated actor metadata', async () => {
    const listMyBookings = vi.fn(async () => ({ bookings: [], requestId: 'request-history' }));
    const controller = new BookingController({ listMyBookings } as unknown as BookingService);
    const metadata = customerMetadata();

    await expect(
      controller.grpcListMyBookings({ pageSize: 10, requestId: 'request-history' }, metadata),
    ).resolves.toMatchObject({ bookings: [], requestId: 'request-history' });
    expect(listMyBookings).toHaveBeenCalledWith({
      pageSize: 10,
      customerId,
      requestId: 'request-history',
    });
  });

  it('rejects missing actor metadata and customer-owner mismatch', async () => {
    const controller = new BookingController({
      listMyBookings: vi.fn(),
    } as unknown as BookingService);

    await expect(
      controller.grpcListMyBookings({ pageSize: 10 }, new Metadata()),
    ).rejects.toMatchObject({ error: expect.objectContaining({ code: status.PERMISSION_DENIED }) });

    const metadata = customerMetadata();
    await expect(
      controller.grpcCreateBooking(
        {
          holdToken: 'hold-token-1234567890',
          owner: { type: 2, id: '00000000-0000-4000-8000-000000001499' },
          contact: {
            fullName: 'Customer Demo',
            email: 'customer@example.com',
            phone: '0901234567',
          },
          passengers: [{ seatId: 'A01', fullName: 'Customer Demo' }],
          idempotencyKey: 'booking-idempotency-123',
        },
        metadata,
      ),
    ).rejects.toMatchObject({ error: expect.objectContaining({ code: status.PERMISSION_DENIED }) });
  });

  it('derives cancellation owner from customer metadata instead of request input', async () => {
    const cancelBooking = vi.fn(async () => ({
      result: {
        booking: { id: randomBookingId, status: 'CANCELLED' as const },
        cancelledAt: '2030-06-20T00:00:00.000Z',
        policyCode: 'BEFORE_DEPARTURE_FULL_RELEASE' as const,
        seatsReleased: true,
      },
      requestId: 'request-cancel',
    }));
    const controller = new BookingController({ cancelBooking } as unknown as BookingService);

    await expect(
      controller.grpcCancelBooking(
        {
          bookingId: randomBookingId,
          idempotencyKey: 'cancel-idempotency-123',
          requestId: 'request-cancel',
        },
        customerMetadata(),
      ),
    ).resolves.toMatchObject({ result: { booking: { status: 8 }, seatsReleased: true } });
    expect(cancelBooking).toHaveBeenCalledWith({
      bookingId: randomBookingId,
      idempotencyKey: 'cancel-idempotency-123',
      customerId,
      requestId: 'request-cancel',
    });
  });
});

describe('BookingController staff check-in authorization', () => {
  it('rejects CUSTOMER metadata before ticket lookup', async () => {
    const staffTicketLookup = vi.fn();
    const controller = new BookingController({ staffTicketLookup } as unknown as BookingService);

    await expect(
      controller.grpcStaffTicketLookup(
        { kind: 1, credential: 'BV-2030-ABC1234567' },
        customerMetadata(),
      ),
    ).rejects.toMatchObject({ error: expect.objectContaining({ code: status.PERMISSION_DENIED }) });
    expect(staffTicketLookup).not.toHaveBeenCalled();
  });

  it('derives STAFF actor metadata for an idempotent check-in command', async () => {
    const checkInTicket = vi.fn(async () => ({
      ticket: {
        ticketId: '00000000-0000-4000-8000-000000001701',
        ticketCode: 'VT-2030-ABC1234567-A01',
        bookingId: randomBookingId,
        bookingCode: 'BV-2030-ABC1234567',
        bookingStatus: 'CHECKED_IN' as const,
        passengerId: '00000000-0000-4000-8000-000000001201',
        passengerName: 'Passenger Demo',
        seatId: 'A01',
        tripId: '00000000-0000-4000-8000-000000000702',
        routeLabel: 'TP.HCM -> Đà Lạt',
        departureAt: '2030-06-20T01:00:00.000Z',
        checkedInAt: '2030-06-20T00:00:00.000Z',
      },
      transitioned: true,
      requestId: 'request-check-in',
    }));
    const controller = new BookingController({ checkInTicket } as unknown as BookingService);

    await expect(
      controller.grpcCheckInTicket(
        {
          kind: 2,
          credential: 'VT-2030-ABC1234567-A01',
          tripId: '00000000-0000-4000-8000-000000000702',
          idempotencyKey: 'ticket-check-in-controller',
          requestId: 'request-check-in',
        },
        staffMetadata(),
      ),
    ).resolves.toMatchObject({ ticket: { bookingStatus: 5 }, transitioned: true });
    expect(checkInTicket).toHaveBeenCalledWith({
      kind: 'TICKET_CODE',
      credential: 'VT-2030-ABC1234567-A01',
      tripId: '00000000-0000-4000-8000-000000000702',
      idempotencyKey: 'ticket-check-in-controller',
      actor: {
        id: '00000000-0000-4000-8000-000000001402',
        role: 'STAFF',
      },
      requestId: 'request-check-in',
    });
  });
});

describe('BookingController admin operations authorization', () => {
  it('requires ADMIN metadata and maps operational booking statuses', async () => {
    const getAdminOperations = vi.fn(async () => ({
      bookings: [{ id: randomBookingId, status: 'PAID' as const }],
      summary: {
        bookingCount: 1,
        passengerCount: 1,
        revenueVnd: 220_000,
        statusCounts: [{ status: 'PAID' as const, count: 1 }],
      },
      auditEvents: [],
      requestId: 'request-admin-operations',
    }));
    const controller = new BookingController({ getAdminOperations } as unknown as BookingService);

    await expect(
      controller.grpcGetAdminOperations(
        { tripId: '00000000-0000-4000-8000-000000000702', bookingLimit: 20, auditLimit: 20 },
        customerMetadata(),
      ),
    ).rejects.toMatchObject({ error: expect.objectContaining({ code: status.PERMISSION_DENIED }) });

    const metadata = new Metadata();
    metadata.set('x-actor-id', '00000000-0000-4000-8000-000000001403');
    metadata.set('x-actor-role', 'ADMIN');
    metadata.set('x-actor-token-id', '00000000-0000-4000-8000-000000009003');
    await expect(
      controller.grpcGetAdminOperations(
        {
          tripId: '00000000-0000-4000-8000-000000000702',
          bookingLimit: 20,
          auditLimit: 20,
          requestId: 'request-admin-operations',
        },
        metadata,
      ),
    ).resolves.toMatchObject({
      bookings: [{ status: 3 }],
      summary: { statusCounts: [{ status: 3, count: 1 }] },
    });
  });
});

describe('BookingController guest lookup privacy', () => {
  it('does not require actor metadata and maps only the minimal booking status view', async () => {
    const getGuestBookingLookup = vi.fn(async () => ({
      booking: {
        bookingCode: 'BV-2030-ABC1234567',
        status: 'TICKET_ISSUED' as const,
        tripId: '00000000-0000-4000-8000-000000000701',
        originName: 'TP.HCM',
        destinationName: 'Đà Lạt',
        departureAt: '2030-06-20T00:00:00.000Z',
        timezone: 'Asia/Ho_Chi_Minh',
        seatIds: ['A01'],
        ticketIssued: true,
        cancellationEligible: true,
      },
      requestId: 'request-guest-lookup',
    }));
    const controller = new BookingController({
      getGuestBookingLookup,
    } as unknown as BookingService);

    await expect(
      controller.grpcGetGuestBookingLookup(
        {
          bookingCode: 'BV-2030-ABC1234567',
          normalizedEmail: 'guest@example.com',
          requestId: 'request-guest-lookup',
        },
        new Metadata(),
      ),
    ).resolves.toMatchObject({ booking: { status: 4, seatIds: ['A01'] } });
  });
});

const randomBookingId = '00000000-0000-4000-8000-000000001101';

function customerMetadata(): Metadata {
  const metadata = new Metadata();
  metadata.set('x-actor-id', customerId);
  metadata.set('x-actor-role', 'CUSTOMER');
  metadata.set('x-actor-token-id', tokenId);
  return metadata;
}

function staffMetadata(): Metadata {
  const metadata = new Metadata();
  metadata.set('x-actor-id', '00000000-0000-4000-8000-000000001402');
  metadata.set('x-actor-role', 'STAFF');
  metadata.set('x-actor-token-id', '00000000-0000-4000-8000-000000009002');
  return metadata;
}
