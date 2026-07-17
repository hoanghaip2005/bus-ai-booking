import { randomUUID } from 'node:crypto';

import { Metadata, status } from '@grpc/grpc-js';
import { describe, expect, it, vi } from 'vitest';

import { BookingController } from './booking.controller';
import {
  BookingInvalidStateTransitionError,
  BookingService,
  BookingValidationError,
} from './booking.service';
import type { BookingFulfillmentSnapshot, BookingStatus, BookingView } from './booking.types';

describe('BookingService ticket fulfillment', () => {
  it('returns fulfillment data only after the booking is paid', async () => {
    const paidSnapshot = fulfillmentSnapshot('PAID');
    const paidService = fulfillmentService({ snapshot: paidSnapshot });

    await expect(
      paidService.getFulfillmentSnapshot({ bookingId: paidSnapshot.booking.id }),
    ).resolves.toMatchObject({ snapshot: paidSnapshot });

    const pendingSnapshot = fulfillmentSnapshot('PENDING_PAYMENT');
    const pendingService = fulfillmentService({ snapshot: pendingSnapshot });
    await expect(
      pendingService.getFulfillmentSnapshot({ bookingId: pendingSnapshot.booking.id }),
    ).rejects.toBeInstanceOf(BookingInvalidStateTransitionError);
  });

  it('marks ticket issuance idempotently after the passenger count matches', async () => {
    const snapshot = fulfillmentSnapshot('PAID');
    const markTicketIssued = vi
      .fn()
      .mockResolvedValueOnce({ status: 'TICKET_ISSUED', transitioned: true })
      .mockResolvedValueOnce({ status: 'TICKET_ISSUED', transitioned: false });
    const service = fulfillmentService({ snapshot, markTicketIssued });
    const request = {
      bookingId: snapshot.booking.id,
      sourceEventId: randomUUID(),
      issuedAt: new Date().toISOString(),
      ticketCount: snapshot.booking.passengers.length,
      tickets: issuedTicketReferences(snapshot),
    };

    await expect(service.markTicketIssued(request)).resolves.toMatchObject({
      status: 'TICKET_ISSUED',
      transitioned: true,
    });
    await expect(service.markTicketIssued(request)).resolves.toMatchObject({
      status: 'TICKET_ISSUED',
      transitioned: false,
    });
    expect(markTicketIssued).toHaveBeenCalledTimes(2);
  });

  it('rejects a ticket count that does not match the booking passenger count', async () => {
    const snapshot = fulfillmentSnapshot('PAID');
    const markTicketIssued = vi.fn();
    const service = fulfillmentService({ snapshot, markTicketIssued });

    await expect(
      service.markTicketIssued({
        bookingId: snapshot.booking.id,
        sourceEventId: randomUUID(),
        issuedAt: new Date().toISOString(),
        ticketCount: snapshot.booking.passengers.length + 1,
        tickets: issuedTicketReferences(snapshot),
      }),
    ).rejects.toBeInstanceOf(BookingValidationError);
    expect(markTicketIssued).not.toHaveBeenCalled();
  });

  it('does not register ticket references after cancellation', async () => {
    const snapshot = fulfillmentSnapshot('CANCELLED');
    const markTicketIssued = vi.fn();
    const service = fulfillmentService({ snapshot, markTicketIssued });

    await expect(
      service.markTicketIssued({
        bookingId: snapshot.booking.id,
        sourceEventId: randomUUID(),
        issuedAt: new Date().toISOString(),
        ticketCount: snapshot.booking.passengers.length,
        tickets: issuedTicketReferences(snapshot),
      }),
    ).rejects.toBeInstanceOf(BookingInvalidStateTransitionError);
    expect(markTicketIssued).not.toHaveBeenCalled();
  });
});

describe('BookingController ticket fulfillment authorization', () => {
  it('rejects fulfillment calls without the fixed SYSTEM actor metadata', async () => {
    const getFulfillmentSnapshot = vi.fn();
    const controller = new BookingController({ getFulfillmentSnapshot } as never);

    await expect(
      controller.grpcGetFulfillmentSnapshot({ bookingId: randomUUID() }, new Metadata()),
    ).rejects.toMatchObject({
      error: { code: status.PERMISSION_DENIED, message: 'System actor required.' },
    });
    expect(getFulfillmentSnapshot).not.toHaveBeenCalled();
  });

  it('allows fulfillment calls from the fixed SYSTEM actor', async () => {
    const snapshot = fulfillmentSnapshot('PAID');
    const getFulfillmentSnapshot = vi.fn(async () => ({
      snapshot,
      requestId: 'worker-request-id',
    }));
    const controller = new BookingController({ getFulfillmentSnapshot } as never);
    const metadata = new Metadata();
    metadata.set('x-actor-category', 'SYSTEM');
    metadata.set('x-actor-id', '00000000-0000-4000-8000-000000000001');
    metadata.set('x-request-id', 'worker-request-id');

    await expect(
      controller.grpcGetFulfillmentSnapshot({ bookingId: snapshot.booking.id }, metadata),
    ).resolves.toMatchObject({
      snapshot: {
        bookingId: snapshot.booking.id,
        bookingCode: snapshot.booking.bookingCode,
        status: 3,
        owner: { type: 1, id: snapshot.owner.id },
        contactEmail: snapshot.booking.contact.email,
        trip: snapshot.booking.trip,
        passengers: snapshot.booking.passengers,
        totalPriceVnd: snapshot.booking.totalPriceVnd,
        paidAt: snapshot.paidAt,
      },
      requestId: 'worker-request-id',
    });
    expect(getFulfillmentSnapshot).toHaveBeenCalledWith({
      bookingId: snapshot.booking.id,
      requestId: 'worker-request-id',
    });
  });
});

function fulfillmentService(input: {
  snapshot: BookingFulfillmentSnapshot;
  markTicketIssued?: ReturnType<typeof vi.fn>;
}): BookingService {
  return new BookingService(
    {} as never,
    {
      findFulfillmentSnapshot: async () => input.snapshot,
      markTicketIssued:
        input.markTicketIssued ??
        vi.fn(async () => ({ status: 'TICKET_ISSUED', transitioned: true })),
    } as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

function issuedTicketReferences(snapshot: BookingFulfillmentSnapshot) {
  return snapshot.booking.passengers.map((passenger) => {
    const ticketId = randomUUID();
    return {
      ticketId,
      passengerId: passenger.id,
      ticketCode: `VT-2030-ABC1234567-${passenger.seatId}`,
      qrPayload: `${snapshot.booking.bookingCode}-${ticketId}`,
    };
  });
}

function fulfillmentSnapshot(statusValue: BookingStatus): BookingFulfillmentSnapshot {
  const booking: BookingView = {
    id: randomUUID(),
    bookingCode: 'BV-2030-ABC1234567',
    status: statusValue,
    trip: {
      tripId: '00000000-0000-4000-8000-000000000702',
      routeId: '00000000-0000-4000-8000-000000000501',
      routeCode: 'HCM-DLI',
      operatorName: 'Phuong Trang Demo',
      vehicleTypeName: 'Limousine 22',
      vehicleCode: 'PT-L22-01',
      vehiclePlate: '51B-220.01',
      originName: 'TP.HCM',
      destinationName: 'Da Lat',
      pickupName: 'Ben xe Mien Dong',
      dropoffName: 'Ben xe Lien tinh Da Lat',
      departureAt: '2030-06-20T01:00:00.000Z',
      arrivalAt: '2030-06-20T07:00:00.000Z',
      timezone: 'Asia/Ho_Chi_Minh',
      unitPriceVnd: 220_000,
    },
    contact: {
      fullName: 'Nguyen Van An',
      email: 'an@example.com',
      phone: '0901234567',
    },
    passengers: [
      {
        id: randomUUID(),
        seatId: 'A03',
        fullName: 'Nguyen Van An',
        hasDocumentNumber: false,
      },
    ],
    totalPriceVnd: 220_000,
    holdExpiresAt: '2030-06-20T00:30:00.000Z',
    createdAt: '2030-06-19T23:00:00.000Z',
  };
  return {
    booking,
    owner: { type: 'GUEST_SESSION', id: randomUUID() },
    paidAt: '2030-06-19T23:05:00.000Z',
  };
}
