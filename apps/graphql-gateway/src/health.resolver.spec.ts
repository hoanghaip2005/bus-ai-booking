import type { GraphQLError } from 'graphql';
import { describe, expect, it, vi } from 'vitest';

import type { CatalogHealthService } from './catalog-health.service';
import { BookingHoldExpiredGatewayError, type BookingGatewayService } from './booking.service';
import { CatalogNotFoundError } from './catalog-not-found.error';
import { HealthResolver } from './health.resolver';
import {
  IdentityUnauthenticatedGatewayError,
  type IdentityGatewayService,
} from './identity.service';
import {
  SeatUnavailableGatewayError,
  type SeatInventoryGatewayService,
} from './seat-inventory.service';
import type { SeatStatusSubscriptionService } from './seat-status-subscription.service';

describe('HealthResolver locationSuggestions', () => {
  it('trims input and maps the protobuf location kind', async () => {
    const suggestLocations = vi.fn(async () => ({
      suggestions: [
        {
          id: 'location-1',
          code: 'HCM',
          name: 'TP.HCM',
          normalizedName: 'tp hcm',
          kind: 'LOCATION_KIND_CITY',
        },
      ],
      normalizedQuery: 'sai gon',
      requestId: 'request-1',
    }));
    const resolver = new HealthResolver({ suggestLocations } as unknown as CatalogHealthService);

    const result = await resolver.locationSuggestions('  Sai Gon  ', 8, 'request-1');

    expect(suggestLocations).toHaveBeenCalledWith('Sai Gon', 8, 'request-1');
    expect(result).toEqual([expect.objectContaining({ code: 'HCM', kind: 'CITY' })]);
  });

  it('rejects short queries before calling Catalog Service', async () => {
    const suggestLocations = vi.fn();
    const resolver = new HealthResolver({ suggestLocations } as unknown as CatalogHealthService);

    await expect(resolver.locationSuggestions(' ', 8, 'request-2')).rejects.toEqual(
      expect.objectContaining<Partial<GraphQLError>>({
        extensions: expect.objectContaining({ code: 'VALIDATION_ERROR', field: 'query' }),
      }),
    );
    expect(suggestLocations).not.toHaveBeenCalled();
  });

  it('rejects overlong queries before calling Catalog Service', async () => {
    const suggestLocations = vi.fn();
    const resolver = new HealthResolver({ suggestLocations } as unknown as CatalogHealthService);

    await expect(resolver.locationSuggestions('a'.repeat(101), 8, 'request-4')).rejects.toEqual(
      expect.objectContaining<Partial<GraphQLError>>({
        extensions: expect.objectContaining({ code: 'VALIDATION_ERROR', field: 'query' }),
      }),
    );
    expect(suggestLocations).not.toHaveBeenCalled();
  });

  it('treats an omitted protobuf repeated field as an empty result', async () => {
    const resolver = new HealthResolver({
      suggestLocations: async () => ({
        suggestions: undefined,
        normalizedQuery: 'unknown',
        requestId: 'request-3',
      }),
    } as unknown as CatalogHealthService);

    await expect(resolver.locationSuggestions('unknown', 8, 'request-3')).resolves.toEqual([]);
  });

  it('returns typed trip search results', async () => {
    const searchTrips = vi.fn(async () => ({
      trips: [{ id: 'trip-1', priceVnd: 280000 }],
      timezone: 'Asia/Ho_Chi_Minh',
      requestId: 'request-trip',
      nearestTravelDates: [],
    }));
    const resolver = new HealthResolver({ searchTrips } as unknown as CatalogHealthService);

    await expect(
      resolver.searchTrips(
        {
          originLocationId: '00000000-0000-4000-8000-000000000001',
          destinationLocationId: '00000000-0000-4000-8000-000000000002',
          travelDate: '2030-06-20',
        },
        'request-trip',
      ),
    ).resolves.toEqual({
      trips: [{ id: 'trip-1', priceVnd: 280000 }],
      timezone: 'Asia/Ho_Chi_Minh',
      nearestTravelDates: [],
    });
  });

  it('maps trip detail stop kinds and timezone', async () => {
    const getTrip = vi.fn(async () => ({
      trip: {
        id: '00000000-0000-4000-8000-000000000701',
        stops: [{ id: 'stop-1', kind: 'TRIP_STOP_KIND_PICKUP' }],
        policies: [],
        seatLayout: { id: 'layout-1', seats: [] },
      },
      timezone: 'Asia/Ho_Chi_Minh',
      requestId: 'request-detail',
    }));
    const resolver = new HealthResolver({ getTrip } as unknown as CatalogHealthService);

    await expect(
      resolver.trip('00000000-0000-4000-8000-000000000701', 'request-detail'),
    ).resolves.toMatchObject({
      timezone: 'Asia/Ho_Chi_Minh',
      stops: [{ kind: 'PICKUP' }],
    });
  });

  it('returns a stable NOT_FOUND GraphQL error for an inactive trip', async () => {
    const resolver = new HealthResolver({
      getTrip: async () => {
        throw new CatalogNotFoundError('request-missing', 'Trip not found.');
      },
    } as unknown as CatalogHealthService);

    await expect(
      resolver.trip('00000000-0000-4000-8000-000000000799', 'request-missing'),
    ).rejects.toMatchObject({
      extensions: expect.objectContaining({ code: 'NOT_FOUND', retryable: false }),
    });
  });

  it('maps authoritative seat states from Seat Inventory', async () => {
    const resolver = new HealthResolver(
      {} as CatalogHealthService,
      {
        getSeatMap: async () => ({
          seatMap: {
            tripId: '00000000-0000-4000-8000-000000000701',
            layoutId: 'layout-1',
            layoutVersion: 1,
            layoutName: 'Sleeper 34',
            deckCount: 2,
            generatedAt: '2030-06-20T00:00:00.000Z',
            seats: [
              { id: 'A01', label: 'A01', deck: 1, row: 1, column: 1, status: 3 },
              { id: 'A02', label: 'A02', deck: 1, row: 1, column: 2, status: 4 },
            ],
          },
          requestId: 'request-seat',
        }),
      } as unknown as SeatInventoryGatewayService,
    );

    await expect(
      resolver.seatMap('00000000-0000-4000-8000-000000000701', null, 'request-seat'),
    ).resolves.toMatchObject({
      seats: [
        { id: 'A01', status: 'BOOKED' },
        { id: 'A02', status: 'BLOCKED' },
      ],
    });
  });

  it('derives the hold owner from checkout context instead of GraphQL input', async () => {
    const holdSeats = vi.fn(async () => ({
      hold: {
        token: 'hold-token-1234567890',
        tripId: '00000000-0000-4000-8000-000000000701',
        seatIds: ['A03'],
        expiresAt: '2030-06-20T00:05:00.000Z',
        remainingTtlSeconds: 300,
        unitPriceVnd: 280000,
        totalPriceVnd: 280000,
        status: 1,
      },
      requestId: 'request-hold',
    }));
    const resolver = new HealthResolver(
      {} as CatalogHealthService,
      { holdSeats } as unknown as SeatInventoryGatewayService,
    );

    await expect(
      resolver.holdSeats(
        {
          tripId: '00000000-0000-4000-8000-000000000701',
          seatIds: ['A03'],
          idempotencyKey: '00000000-0000-4000-8000-000000000903',
          ttlSeconds: 300,
        },
        'request-hold',
        '00000000-0000-4000-8000-000000000902',
      ),
    ).resolves.toMatchObject({ token: 'hold-token-1234567890', status: 'ACTIVE' });
    expect(holdSeats).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: {
          type: 'GUEST_SESSION',
          id: '00000000-0000-4000-8000-000000000902',
        },
      }),
      'request-hold',
    );
  });

  it('returns the stable SEAT_UNAVAILABLE code for a hold conflict', async () => {
    const resolver = new HealthResolver(
      {} as CatalogHealthService,
      {
        holdSeats: async () => {
          throw new SeatUnavailableGatewayError('request-conflict');
        },
      } as unknown as SeatInventoryGatewayService,
    );

    await expect(
      resolver.holdSeats(
        {
          tripId: '00000000-0000-4000-8000-000000000701',
          seatIds: ['A03'],
          idempotencyKey: '00000000-0000-4000-8000-000000000903',
          ttlSeconds: 300,
        },
        'request-conflict',
        '00000000-0000-4000-8000-000000000902',
      ),
    ).rejects.toMatchObject({
      extensions: expect.objectContaining({ code: 'SEAT_UNAVAILABLE', retryable: true }),
    });
  });

  it('creates a trip-filtered realtime seat subscription', () => {
    const stream = { next: vi.fn() };
    const subscribeToTrip = vi.fn(() => stream);
    const resolver = new HealthResolver(
      {} as CatalogHealthService,
      {} as SeatInventoryGatewayService,
      { subscribeToTrip } as unknown as SeatStatusSubscriptionService,
    );

    expect(resolver.seatStatusChanged('00000000-0000-4000-8000-000000000701')).toBe(stream);
    expect(subscribeToTrip).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000701');
  });

  it('derives guest booking ownership from checkout context', async () => {
    const createBooking = vi.fn(async () => ({
      booking: {
        id: '00000000-0000-4000-8000-000000001101',
        bookingCode: 'BV-2030-ABC1234567',
        status: 2,
        trip: {
          tripId: '00000000-0000-4000-8000-000000000701',
          routeId: '00000000-0000-4000-8000-000000000501',
          routeCode: 'HCM-DLI',
          operatorName: 'Phuong Trang Demo',
          vehicleTypeName: 'Sleeper 34',
          vehicleCode: 'PT-S34-01',
          vehiclePlate: '51B-120.01',
          originName: 'TP.HCM',
          destinationName: 'Đà Lạt',
          pickupName: 'Bến xe Miền Đông',
          dropoffName: 'Bến xe Liên tỉnh Đà Lạt',
          departureAt: '2030-06-20T00:00:00.000Z',
          arrivalAt: '2030-06-20T07:00:00.000Z',
          timezone: 'Asia/Ho_Chi_Minh',
          unitPriceVnd: 280000,
        },
        contact: {
          fullName: 'Nguyen Van An',
          email: 'an@example.com',
          phone: '0901234567',
        },
        passengers: [
          {
            id: '00000000-0000-4000-8000-000000001201',
            seatId: 'A03',
            fullName: 'Nguyen Van An',
            hasDocumentNumber: false,
          },
        ],
        totalPriceVnd: 280000,
        holdExpiresAt: '2030-06-20T00:05:00.000Z',
        createdAt: '2030-06-20T00:01:00.000Z',
      },
      requestId: 'request-booking',
    }));
    const resolver = new HealthResolver(
      {} as CatalogHealthService,
      {} as SeatInventoryGatewayService,
      undefined,
      { createBooking } as unknown as BookingGatewayService,
    );

    await expect(
      resolver.createBooking(
        {
          holdToken: 'hold-token-1234567890',
          idempotencyKey: 'booking-idempotency-123',
          contact: {
            fullName: 'Nguyen Van An',
            email: 'an@example.com',
            phone: '0901234567',
          },
          passengers: [{ seatId: 'A03', fullName: 'Nguyen Van An' }],
        },
        'request-booking',
        '00000000-0000-4000-8000-000000000902',
      ),
    ).resolves.toMatchObject({ status: 'PENDING_PAYMENT', bookingCode: 'BV-2030-ABC1234567' });
    expect(createBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: {
          type: 'GUEST_SESSION',
          id: '00000000-0000-4000-8000-000000000902',
        },
      }),
      'request-booking',
    );
  });

  it('maps an expired booking hold to HOLD_EXPIRED', async () => {
    const resolver = new HealthResolver(
      {} as CatalogHealthService,
      {} as SeatInventoryGatewayService,
      undefined,
      {
        createBooking: async () => {
          throw new BookingHoldExpiredGatewayError('request-expired');
        },
      } as unknown as BookingGatewayService,
    );

    await expect(
      resolver.createBooking(
        {
          holdToken: 'hold-token-1234567890',
          idempotencyKey: 'booking-idempotency-123',
          contact: {
            fullName: 'Nguyen Van An',
            email: 'an@example.com',
            phone: '0901234567',
          },
          passengers: [{ seatId: 'A03', fullName: 'Nguyen Van An' }],
        },
        'request-expired',
        '00000000-0000-4000-8000-000000000902',
      ),
    ).rejects.toMatchObject({
      extensions: expect.objectContaining({ code: 'HOLD_EXPIRED', retryable: false }),
    });
  });

  it('derives simulated payment ownership and never forwards an amount from GraphQL', async () => {
    const simulatePayment = vi.fn(async () => ({
      result: {
        paymentAttemptId: '00000000-0000-4000-8000-000000001301',
        status: 1,
        processedAt: '2030-06-20T00:02:00.000Z',
        booking: {
          id: '00000000-0000-4000-8000-000000001101',
          bookingCode: 'BV-2030-ABC1234567',
          status: 3,
          trip: {
            tripId: '00000000-0000-4000-8000-000000000701',
            routeId: '00000000-0000-4000-8000-000000000501',
            routeCode: 'HCM-DLI',
            operatorName: 'Phuong Trang Demo',
            vehicleTypeName: 'Sleeper 34',
            vehicleCode: 'PT-S34-01',
            vehiclePlate: '51B-120.01',
            originName: 'TP.HCM',
            destinationName: 'Đà Lạt',
            pickupName: 'Bến xe Miền Đông',
            dropoffName: 'Bến xe Liên tỉnh Đà Lạt',
            departureAt: '2030-06-20T00:00:00.000Z',
            arrivalAt: '2030-06-20T07:00:00.000Z',
            timezone: 'Asia/Ho_Chi_Minh',
            unitPriceVnd: 280000,
          },
          contact: {
            fullName: 'Nguyen Van An',
            email: 'an@example.com',
            phone: '0901234567',
          },
          passengers: [],
          totalPriceVnd: 280000,
          holdExpiresAt: '2030-06-20T00:05:00.000Z',
          createdAt: '2030-06-20T00:01:00.000Z',
        },
      },
      requestId: 'request-payment',
    }));
    const resolver = new HealthResolver(
      {} as CatalogHealthService,
      {} as SeatInventoryGatewayService,
      undefined,
      { simulatePayment } as unknown as BookingGatewayService,
    );

    await expect(
      resolver.simulatePayment(
        {
          bookingId: '00000000-0000-4000-8000-000000001101',
          outcome: 'SUCCESS',
          idempotencyKey: 'payment-idempotency-123',
        },
        'request-payment',
        '00000000-0000-4000-8000-000000000902',
      ),
    ).resolves.toMatchObject({ status: 'SUCCEEDED', booking: { status: 'PAID' } });
    expect(simulatePayment).toHaveBeenCalledWith(
      {
        bookingId: '00000000-0000-4000-8000-000000001101',
        outcome: 'SUCCESS',
        idempotencyKey: 'payment-idempotency-123',
        owner: {
          type: 'GUEST_SESSION',
          id: '00000000-0000-4000-8000-000000000902',
        },
      },
      'request-payment',
    );
  });

  it('maps a missing or expired access token to UNAUTHENTICATED', async () => {
    const authenticate = vi.fn(async () => {
      throw new IdentityUnauthenticatedGatewayError('request-auth');
    });
    const resolver = new HealthResolver(
      {} as CatalogHealthService,
      undefined,
      undefined,
      undefined,
      undefined,
      { authenticate } as unknown as IdentityGatewayService,
    );

    await expect(resolver.viewer(undefined, 'request-auth')).rejects.toMatchObject({
      extensions: expect.objectContaining({ code: 'UNAUTHENTICATED', retryable: false }),
    });
  });

  it('rejects CUSTOMER before forwarding an admin command', async () => {
    const setTripActive = vi.fn();
    const resolver = new HealthResolver(
      { setTripActive } as unknown as CatalogHealthService,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        authenticate: vi.fn(async () => ({
          id: '00000000-0000-4000-8000-000000001401',
          email: 'customer.demo@benviet.vn',
          displayName: 'Khách hàng Demo',
          role: 'CUSTOMER',
          tokenId: '00000000-0000-4000-8000-000000009001',
          expiresAt: '2030-06-20T00:15:00.000Z',
        })),
      } as unknown as IdentityGatewayService,
    );

    await expect(
      resolver.setTripActive(
        { tripId: '00000000-0000-4000-8000-000000000704', isActive: false },
        'Bearer customer-token',
        'request-customer',
      ),
    ).rejects.toMatchObject({ extensions: expect.objectContaining({ code: 'FORBIDDEN' }) });
    expect(setTripActive).not.toHaveBeenCalled();
  });

  it('propagates the authenticated ADMIN actor to Catalog', async () => {
    const actor = {
      id: '00000000-0000-4000-8000-000000001403',
      email: 'admin.demo@benviet.vn',
      displayName: 'Quản trị Demo',
      role: 'ADMIN' as const,
      tokenId: '00000000-0000-4000-8000-000000009003',
      expiresAt: '2030-06-20T00:15:00.000Z',
    };
    const setTripActive = vi.fn(async () => ({
      tripId: '00000000-0000-4000-8000-000000000704',
      isActive: false,
      changed: true,
      requestId: 'request-admin',
    }));
    const resolver = new HealthResolver(
      { setTripActive } as unknown as CatalogHealthService,
      undefined,
      undefined,
      undefined,
      undefined,
      { authenticate: vi.fn(async () => actor) } as unknown as IdentityGatewayService,
    );

    await expect(
      resolver.setTripActive(
        { tripId: '00000000-0000-4000-8000-000000000704', isActive: false },
        'Bearer admin-token',
        'request-admin',
      ),
    ).resolves.toMatchObject({ isActive: false, changed: true });
    expect(setTripActive).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000704',
      false,
      actor,
      'request-admin',
    );
  });

  it('rejects STAFF before forwarding a trip lifecycle command', async () => {
    const transitionTripStatus = vi.fn();
    const resolver = new HealthResolver(
      { transitionTripStatus } as unknown as CatalogHealthService,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        authenticate: vi.fn(async () => ({
          id: '00000000-0000-4000-8000-000000001402',
          email: 'staff.demo@benviet.vn',
          displayName: 'Staff Demo',
          role: 'STAFF',
          tokenId: '00000000-0000-4000-8000-000000009002',
          expiresAt: '2030-06-20T00:15:00.000Z',
        })),
      } as unknown as IdentityGatewayService,
    );

    await expect(
      resolver.transitionTripStatus(
        {
          tripId: '00000000-0000-4000-8000-000000000704',
          targetStatus: 'DEPARTED',
          idempotencyKey: 'trip-lifecycle-resolver-001',
        },
        'Bearer staff-token',
        'request-staff-lifecycle',
      ),
    ).rejects.toMatchObject({ extensions: expect.objectContaining({ code: 'FORBIDDEN' }) });
    expect(transitionTripStatus).not.toHaveBeenCalled();
  });

  it('propagates ADMIN lifecycle commands without accepting actor input', async () => {
    const actor = {
      id: '00000000-0000-4000-8000-000000001403',
      email: 'admin.demo@benviet.vn',
      displayName: 'Admin Demo',
      role: 'ADMIN' as const,
      tokenId: '00000000-0000-4000-8000-000000009003',
      expiresAt: '2030-06-20T00:15:00.000Z',
    };
    const transitionTripStatus = vi.fn(async () => ({
      tripId: '00000000-0000-4000-8000-000000000704',
      previousStatus: 'SCHEDULED',
      status: 'DEPARTED',
      changed: true,
      transitionedAt: '2030-06-21T01:00:00.000Z',
      requestId: 'request-admin-lifecycle',
    }));
    const resolver = new HealthResolver(
      { transitionTripStatus } as unknown as CatalogHealthService,
      undefined,
      undefined,
      undefined,
      undefined,
      { authenticate: vi.fn(async () => actor) } as unknown as IdentityGatewayService,
    );

    await expect(
      resolver.transitionTripStatus(
        {
          tripId: '00000000-0000-4000-8000-000000000704',
          targetStatus: 'DEPARTED',
          idempotencyKey: 'trip-lifecycle-resolver-002',
        },
        'Bearer admin-token',
        'request-admin-lifecycle',
      ),
    ).resolves.toMatchObject({ previousStatus: 'SCHEDULED', status: 'DEPARTED' });
    expect(transitionTripStatus).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000704',
      'DEPARTED',
      'trip-lifecycle-resolver-002',
      actor,
      'request-admin-lifecycle',
    );
  });

  it('allows STAFF ticket lookup and check-in without actor fields in public input', async () => {
    const actor = {
      id: '00000000-0000-4000-8000-000000001402',
      email: 'staff.demo@benviet.vn',
      displayName: 'Staff Demo',
      role: 'STAFF' as const,
      tokenId: '00000000-0000-4000-8000-000000009002',
      expiresAt: '2030-06-20T00:15:00.000Z',
    };
    const ticket = {
      ticketId: '00000000-0000-4000-8000-000000001701',
      ticketCode: 'VT-2030-ABC1234567-A01',
      bookingId: '00000000-0000-4000-8000-000000001101',
      bookingCode: 'BV-2030-ABC1234567',
      bookingStatus: 4,
      passengerId: '00000000-0000-4000-8000-000000001201',
      passengerName: 'Passenger Demo',
      seatId: 'A01',
      tripId: '00000000-0000-4000-8000-000000000702',
      routeLabel: 'TP.HCM -> Đà Lạt',
      departureAt: '2030-06-20T01:00:00.000Z',
    };
    const staffTicketLookup = vi.fn(async () => ({
      tickets: [ticket],
      requestId: 'request-lookup',
    }));
    const checkInTicket = vi.fn(async () => ({
      ticket: { ...ticket, bookingStatus: 5, checkedInAt: '2030-06-20T00:00:00.000Z' },
      transitioned: true,
      requestId: 'request-check-in',
    }));
    const resolver = new HealthResolver(
      {} as CatalogHealthService,
      undefined,
      undefined,
      { staffTicketLookup, checkInTicket } as unknown as BookingGatewayService,
      undefined,
      { authenticate: vi.fn(async () => actor) } as unknown as IdentityGatewayService,
    );

    await expect(
      resolver.staffTicketLookup(
        { kind: 'BOOKING_CODE', credential: 'BV-2030-ABC1234567' },
        'Bearer staff-token',
        'request-lookup',
      ),
    ).resolves.toMatchObject([{ bookingStatus: 'TICKET_ISSUED' }]);
    await expect(
      resolver.checkInTicket(
        {
          kind: 'TICKET_CODE',
          credential: ticket.ticketCode,
          tripId: ticket.tripId,
          idempotencyKey: 'ticket-check-in-resolver-001',
        },
        'Bearer staff-token',
        'request-check-in',
      ),
    ).resolves.toMatchObject({ transitioned: true, ticket: { bookingStatus: 'CHECKED_IN' } });
    expect(staffTicketLookup).toHaveBeenCalledWith(
      'BOOKING_CODE',
      'BV-2030-ABC1234567',
      { id: actor.id, role: 'STAFF', tokenId: actor.tokenId },
      'request-lookup',
    );
  });

  it('derives registered checkout and history ownership from the CUSTOMER token', async () => {
    const actor = {
      id: '00000000-0000-4000-8000-000000001401',
      email: 'customer.demo@benviet.vn',
      displayName: 'Khách hàng Demo',
      role: 'CUSTOMER' as const,
      tokenId: '00000000-0000-4000-8000-000000009001',
      expiresAt: '2030-06-20T00:15:00.000Z',
    };
    const listMyBookings = vi.fn(async () => ({
      bookings: [],
      nextCursor: undefined,
      requestId: 'request-history',
    }));
    const resolver = new HealthResolver(
      {} as CatalogHealthService,
      undefined,
      undefined,
      { listMyBookings } as unknown as BookingGatewayService,
      undefined,
      { authenticate: vi.fn(async () => actor) } as unknown as IdentityGatewayService,
    );

    await expect(
      resolver.myBookings(10, null, 'Bearer customer-token', 'request-history'),
    ).resolves.toEqual({
      nodes: [],
      pageInfo: { endCursor: null, hasNextPage: false },
    });
    expect(listMyBookings).toHaveBeenCalledWith(
      10,
      undefined,
      { id: actor.id, role: 'CUSTOMER', tokenId: actor.tokenId },
      'request-history',
    );
  });

  it('normalizes both guest booking lookup credentials and returns no contact PII', async () => {
    const getGuestBookingLookup = vi.fn(async () => ({
      booking: {
        bookingCode: 'BV-2030-ABC1234567',
        status: 4,
        tripId: '00000000-0000-4000-8000-000000000701',
        originName: 'TP.HCM',
        destinationName: 'Đà Lạt',
        departureAt: '2030-06-20T00:00:00.000Z',
        timezone: 'Asia/Ho_Chi_Minh',
        seatIds: ['A01'],
        ticketIssued: true,
        cancellationEligible: true,
      },
      requestId: 'request-booking-lookup',
    }));
    const resolver = new HealthResolver({} as CatalogHealthService, undefined, undefined, {
      getGuestBookingLookup,
    } as unknown as BookingGatewayService);

    await expect(
      resolver.bookingLookup(
        ' bv-2030-abc1234567 ',
        ' Guest@Example.com ',
        'request-booking-lookup',
      ),
    ).resolves.toEqual({
      bookingCode: 'BV-2030-ABC1234567',
      status: 'TICKET_ISSUED',
      tripId: '00000000-0000-4000-8000-000000000701',
      originName: 'TP.HCM',
      destinationName: 'Đà Lạt',
      departureAt: '2030-06-20T00:00:00.000Z',
      timezone: 'Asia/Ho_Chi_Minh',
      seatIds: ['A01'],
      ticketIssued: true,
      cancellationEligible: true,
    });
    expect(getGuestBookingLookup).toHaveBeenCalledWith(
      'BV-2030-ABC1234567',
      'guest@example.com',
      'request-booking-lookup',
    );
  });

  it('derives cancellation ownership from the CUSTOMER token', async () => {
    const actor = {
      id: '00000000-0000-4000-8000-000000001401',
      email: 'customer.demo@benviet.vn',
      displayName: 'Khách hàng Demo',
      role: 'CUSTOMER' as const,
      tokenId: '00000000-0000-4000-8000-000000009001',
      expiresAt: '2030-06-20T00:15:00.000Z',
    };
    const booking = {
      id: '00000000-0000-4000-8000-000000001101',
      status: 8,
      trip: { tripId: '00000000-0000-4000-8000-000000000702' },
      contact: { fullName: 'Demo', email: 'demo@example.com', phone: '0901234567' },
      passengers: [],
    };
    const cancelBooking = vi.fn(async () => ({
      result: {
        booking,
        cancelledAt: '2030-06-20T00:00:00.000Z',
        policyCode: 'BEFORE_DEPARTURE_FULL_RELEASE',
        seatsReleased: true,
      },
      requestId: 'request-cancel',
    }));
    const resolver = new HealthResolver(
      {} as CatalogHealthService,
      undefined,
      undefined,
      { cancelBooking } as unknown as BookingGatewayService,
      undefined,
      { authenticate: vi.fn(async () => actor) } as unknown as IdentityGatewayService,
    );

    await expect(
      resolver.cancelBooking(
        {
          bookingId: booking.id,
          idempotencyKey: 'cancel-idempotency-123',
        },
        'Bearer customer-token',
        'request-cancel',
      ),
    ).resolves.toMatchObject({ booking: { status: 'CANCELLED' }, seatsReleased: true });
    expect(cancelBooking).toHaveBeenCalledWith(
      booking.id,
      'cancel-idempotency-123',
      { id: actor.id, role: 'CUSTOMER', tokenId: actor.tokenId },
      'request-cancel',
    );
  });

  it('derives passenger profile ownership from the CUSTOMER token', async () => {
    const actor = {
      id: '00000000-0000-4000-8000-000000001401',
      email: 'customer.demo@benviet.vn',
      displayName: 'Khách hàng Demo',
      role: 'CUSTOMER' as const,
      tokenId: '00000000-0000-4000-8000-000000009001',
      expiresAt: '2030-06-20T00:15:00.000Z',
    };
    const listPassengerProfiles = vi.fn(async () => [
      {
        id: '00000000-0000-4000-8000-000000001601',
        label: 'Tôi',
        fullName: 'Khách hàng Demo',
        createdAt: '2026-07-15T00:00:00.000Z',
        updatedAt: '2026-07-15T00:00:00.000Z',
      },
    ]);
    const resolver = new HealthResolver(
      {} as CatalogHealthService,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        authenticate: vi.fn(async () => actor),
        listPassengerProfiles,
      } as unknown as IdentityGatewayService,
    );

    await expect(
      resolver.passengerProfiles('Bearer customer-token', 'request-profiles'),
    ).resolves.toHaveLength(1);
    expect(listPassengerProfiles).toHaveBeenCalledWith(actor, 'request-profiles');
  });
});
