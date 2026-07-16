import { readFileSync } from 'node:fs';

import { buildSchema, graphql } from 'graphql';
import { describe, expect, it } from 'vitest';

const schemaSource = readFileSync(new URL('./schema.graphql', import.meta.url), 'utf8');

describe('GraphQL foundation contract', () => {
  it('exposes platform and catalog health queries', async () => {
    const schema = buildSchema(schemaSource);
    const result = await graphql({
      schema,
      source: '{ platformHealth { status } catalogHealth { status } }',
      rootValue: {
        platformHealth: { status: 'UP' },
        catalogHealth: { status: 'UP' },
      },
    });

    expect(result.errors).toBeUndefined();
  });

  it('exposes typed location suggestions with a default limit', async () => {
    const schema = buildSchema(schemaSource);
    const result = await graphql({
      schema,
      source: '{ locationSuggestions(query: "Sai Gon") { code name kind parentLocationId } }',
      rootValue: {
        locationSuggestions: [{ code: 'HCM', name: 'TP.HCM', kind: 'CITY' }],
      },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.locationSuggestions).toEqual([
      { code: 'HCM', name: 'TP.HCM', kind: 'CITY', parentLocationId: null },
    ]);
  });

  it('exposes the typed trip search boundary', async () => {
    const schema = buildSchema(schemaSource);
    const result = await graphql({
      schema,
      source:
        'query { searchTrips(input: { originLocationId: "origin", destinationLocationId: "destination", travelDate: "2030-06-20" }) { timezone nearestTravelDates trips { id priceVnd remainingSeats } } }',
      rootValue: {
        searchTrips: {
          timezone: 'Asia/Ho_Chi_Minh',
          nearestTravelDates: [],
          trips: [{ id: 'trip-1', priceVnd: 280000, remainingSeats: 34 }],
        },
      },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.searchTrips).toEqual({
      timezone: 'Asia/Ho_Chi_Minh',
      nearestTravelDates: [],
      trips: [{ id: 'trip-1', priceVnd: 280000, remainingSeats: 34 }],
    });
  });

  it('exposes trip detail with stops, seat layout and policy references', async () => {
    const schema = buildSchema(schemaSource);
    const result = await graphql({
      schema,
      source:
        '{ trip(id: "trip-1") { id routeCode status timezone stops { kind scheduledAt } seatLayout { version seats { label deck row column } } policies { code resourceUri } } }',
      rootValue: {
        trip: {
          id: 'trip-1',
          routeCode: 'HCM-DLI',
          status: 'SCHEDULED',
          timezone: 'Asia/Ho_Chi_Minh',
          stops: [{ kind: 'PICKUP', scheduledAt: '2030-06-20T00:00:00.000Z' }],
          seatLayout: {
            version: 1,
            seats: [{ label: 'A01', deck: 1, row: 1, column: 1 }],
          },
          policies: [{ code: 'CANCELLATION', resourceUri: 'bus://policy/cancellation' }],
        },
      },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.trip).toMatchObject({
      routeCode: 'HCM-DLI',
      status: 'SCHEDULED',
      timezone: 'Asia/Ho_Chi_Minh',
    });
  });

  it('exposes authoritative seat-map states', async () => {
    const schema = buildSchema(schemaSource);
    const result = await graphql({
      schema,
      source:
        '{ seatMap(tripId: "trip-1") { tripId layoutVersion seats { label status heldByRequester } } }',
      rootValue: {
        seatMap: {
          tripId: 'trip-1',
          layoutVersion: 1,
          seats: [
            { label: 'A01', status: 'BOOKED', heldByRequester: false },
            { label: 'A02', status: 'BLOCKED', heldByRequester: false },
          ],
        },
      },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.seatMap).toMatchObject({
      tripId: 'trip-1',
      seats: [{ status: 'BOOKED' }, { status: 'BLOCKED' }],
    });
  });

  it('exposes hold, lookup and release operations without accepting an owner from clients', async () => {
    const schema = buildSchema(schemaSource);
    const hold = {
      token: 'hold-token-1234567890',
      tripId: 'trip-1',
      seatIds: ['A03'],
      expiresAt: '2030-06-20T00:05:00.000Z',
      remainingTtlSeconds: 300,
      unitPriceVnd: 280000,
      totalPriceVnd: 280000,
      status: 'ACTIVE',
    };
    const result = await graphql({
      schema,
      source: `
        mutation {
          holdSeats(input: {
            tripId: "trip-1"
            seatIds: ["A03"]
            idempotencyKey: "idem-1234567890"
          }) { token tripId seatIds expiresAt remainingTtlSeconds unitPriceVnd totalPriceVnd status }
          releaseSeatHold(input: {
            holdToken: "hold-token-1234567890"
            idempotencyKey: "release-1234567890"
          }) { released tripId seatIds releasedAt }
        }
      `,
      rootValue: {
        holdSeats: hold,
        releaseSeatHold: {
          released: true,
          tripId: 'trip-1',
          seatIds: ['A03'],
          releasedAt: '2030-06-20T00:01:00.000Z',
        },
      },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.holdSeats).toMatchObject({ token: hold.token, status: 'ACTIVE' });
    expect(result.data?.releaseSeatHold).toMatchObject({ released: true, seatIds: ['A03'] });
    expect(schema.getQueryType()?.getFields().seatHold).toBeDefined();
    expect(schema.getType('HoldSeatsInput')?.toString()).toBe('HoldSeatsInput');
    expect(schemaSource).not.toContain('ownerId:');
  });

  it('exposes privacy-safe realtime seat notifications filtered by trip', () => {
    const schema = buildSchema(schemaSource);
    const subscription = schema.getSubscriptionType()?.getFields().seatStatusChanged;
    const event = schema.getType('SeatStatusEvent');

    expect(subscription?.args.map((argument) => [argument.name, argument.type.toString()])).toEqual(
      [['tripId', 'ID!']],
    );
    expect(event?.toString()).toBe('SeatStatusEvent');
    expect(schemaSource).toContain('seatIds: [ID!]!');
    expect(schemaSource).toContain('version: Int!');
    expect(schemaSource).not.toMatch(/type SeatStatusEvent\s*{[^}]*(?:token|owner)/i);
  });

  it('exposes guest booking creation without accepting checkout ownership', async () => {
    const schema = buildSchema(schemaSource);
    const result = await graphql({
      schema,
      source: `
        mutation {
          createBooking(input: {
            holdToken: "hold-token-1234567890"
            idempotencyKey: "booking-idempotency-123"
            contact: { fullName: "Nguyen Van An", email: "an@example.com", phone: "0901234567" }
            passengers: [{ seatId: "A03", fullName: "Nguyen Van An" }]
          }) {
            bookingCode status totalPriceVnd
            trip { tripId routeCode unitPriceVnd }
            passengers { seatId fullName hasDocumentNumber }
          }
        }
      `,
      rootValue: {
        createBooking: {
          bookingCode: 'BV-2030-DEMO',
          status: 'PENDING_PAYMENT',
          totalPriceVnd: 280000,
          trip: {
            tripId: '00000000-0000-4000-8000-000000000701',
            routeCode: 'HCM-DLI',
            unitPriceVnd: 280000,
          },
          passengers: [{ seatId: 'A03', fullName: 'Nguyen Van An', hasDocumentNumber: false }],
        },
      },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.createBooking).toMatchObject({ status: 'PENDING_PAYMENT' });
    expect(schemaSource).not.toMatch(/input CreateBookingInput\s*{[^}]*(?:owner|checkoutSession)/i);
    expect(schemaSource).not.toMatch(/type BookingPassenger\s*{[^}]*\n\s*documentNumber\s*:/i);
  });

  it('exposes simulated payment without accepting owner or authoritative amount', async () => {
    const schema = buildSchema(schemaSource);
    const result = await graphql({
      schema,
      source: `
        mutation {
          simulatePayment(input: {
            bookingId: "00000000-0000-4000-8000-000000001101"
            outcome: SUCCESS
            idempotencyKey: "payment-idempotency-123"
          }) {
            paymentAttemptId status failureCode processedAt
            booking { id status totalPriceVnd }
          }
        }
      `,
      rootValue: {
        simulatePayment: {
          paymentAttemptId: '00000000-0000-4000-8000-000000001301',
          status: 'SUCCEEDED',
          processedAt: '2030-06-20T00:02:00.000Z',
          booking: {
            id: '00000000-0000-4000-8000-000000001101',
            status: 'PAID',
            totalPriceVnd: 280000,
          },
        },
      },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.simulatePayment).toMatchObject({
      status: 'SUCCEEDED',
      booking: { status: 'PAID' },
    });
    expect(schemaSource).not.toMatch(/input SimulatePaymentInput\s*{[^}]*(?:amount|owner)/i);
  });

  it('exposes customer booking history with stable cursor pagination', async () => {
    const schema = buildSchema(schemaSource);
    const result = await graphql({
      schema,
      source: `query { myBookings(first: 5) {
        nodes { id bookingCode status }
        pageInfo { endCursor hasNextPage }
      } }`,
      rootValue: {
        myBookings: {
          nodes: [
            {
              id: '00000000-0000-4000-8000-000000001101',
              bookingCode: 'BV-2030-DEMO',
              status: 'PAID',
            },
          ],
          pageInfo: { endCursor: 'opaque_cursor', hasNextPage: true },
        },
      },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.myBookings).toMatchObject({
      nodes: [{ status: 'PAID' }],
      pageInfo: { hasNextPage: true },
    });
  });

  it('exposes owner-derived booking cancellation without customer or refund input', async () => {
    const schema = buildSchema(schemaSource);
    const result = await graphql({
      schema,
      source: `mutation {
        cancelBooking(input: {
          bookingId: "00000000-0000-4000-8000-000000001101"
          idempotencyKey: "cancel-idempotency-123"
        }) {
          booking { id status }
          cancelledAt policyCode seatsReleased
        }
      }`,
      rootValue: {
        cancelBooking: {
          booking: { id: '00000000-0000-4000-8000-000000001101', status: 'CANCELLED' },
          cancelledAt: '2030-06-20T01:00:00.000Z',
          policyCode: 'BEFORE_DEPARTURE_FULL_RELEASE',
          seatsReleased: true,
        },
      },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.cancelBooking).toMatchObject({ seatsReleased: true });
    expect(schemaSource).not.toMatch(/input CancelBookingInput\s*{[^}]*(?:customer|owner|refund)/i);
  });

  it('exposes customer-owned passenger profile CRUD without a user ID input', async () => {
    const schema = buildSchema(schemaSource);
    const result = await graphql({
      schema,
      source: `mutation {
        createPassengerProfile(input: { label: "Tôi", fullName: "Nguyen Van An", phone: "0901234567" }) {
          id label fullName phone
        }
      }`,
      rootValue: {
        createPassengerProfile: {
          id: '00000000-0000-4000-8000-000000001601',
          label: 'Tôi',
          fullName: 'Nguyen Van An',
          phone: '0901234567',
        },
      },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.createPassengerProfile).toMatchObject({ label: 'Tôi' });
    expect(schemaSource).not.toMatch(/input PassengerProfileInput\s*{[^}]*(?:userId|owner)/i);
  });

  it('exposes owner-scoped booking ticket documents without lookup credentials in input', async () => {
    const schema = buildSchema(schemaSource);
    const result = await graphql({
      schema,
      source: `{
        bookingTickets(bookingId: "00000000-0000-4000-8000-000000001101") {
          bookingId ready
          tickets { ticketCode passengerName seatId htmlContent pdfBase64 qrPayload }
        }
      }`,
      rootValue: {
        bookingTickets: {
          bookingId: '00000000-0000-4000-8000-000000001101',
          ready: true,
          tickets: [
            {
              ticketCode: 'VT-DEMO-A01',
              passengerName: 'Nguyen Van An',
              seatId: 'A01',
              htmlContent: '<html></html>',
              pdfBase64: 'JVBERi0=',
              qrPayload: 'BV-DEMO-ticket-id',
            },
          ],
        },
      },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.bookingTickets).toMatchObject({ ready: true });
    expect(schemaSource).not.toMatch(/bookingTickets\([^)]*(?:email|owner|checkoutSession)/i);
  });

  it('exposes an actor-free admin trip lifecycle command', async () => {
    const schema = buildSchema(schemaSource);
    const result = await graphql({
      schema,
      source: `mutation {
        transitionTripStatus(input: {
          tripId: "00000000-0000-4000-8000-000000000704"
          targetStatus: DEPARTED
          idempotencyKey: "trip-lifecycle-contract-001"
        }) { tripId previousStatus status changed transitionedAt }
      }`,
      rootValue: {
        transitionTripStatus: {
          tripId: '00000000-0000-4000-8000-000000000704',
          previousStatus: 'SCHEDULED',
          status: 'DEPARTED',
          changed: true,
          transitionedAt: '2030-06-21T01:00:00.000Z',
        },
      },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.transitionTripStatus).toMatchObject({ status: 'DEPARTED' });
    expect(schemaSource).not.toMatch(
      /input TransitionTripStatusInput\s*{[^}]*(?:actor|admin|userId)/i,
    );
  });

  it('exposes staff ticket lookup and check-in without actor input', async () => {
    const schema = buildSchema(schemaSource);
    const ticket = {
      ticketId: '00000000-0000-4000-8000-000000001701',
      ticketCode: 'VT-2030-ABC1234567-A01',
      bookingId: '00000000-0000-4000-8000-000000001101',
      bookingCode: 'BV-2030-ABC1234567',
      bookingStatus: 'TICKET_ISSUED',
      passengerId: '00000000-0000-4000-8000-000000001201',
      passengerName: 'Passenger Demo',
      seatId: 'A01',
      tripId: '00000000-0000-4000-8000-000000000702',
      routeLabel: 'TP.HCM -> Đà Lạt',
      departureAt: '2030-06-20T01:00:00.000Z',
    };
    const lookup = await graphql({
      schema,
      source: `query {
        staffTicketLookup(input: { kind: BOOKING_CODE, credential: "BV-2030-ABC1234567" }) {
          ticketCode bookingStatus passengerName seatId tripId
        }
      }`,
      rootValue: { staffTicketLookup: [ticket] },
    });
    const checkIn = await graphql({
      schema,
      source: `mutation {
        checkInTicket(input: {
          kind: TICKET_CODE
          credential: "VT-2030-ABC1234567-A01"
          tripId: "00000000-0000-4000-8000-000000000702"
          idempotencyKey: "ticket-check-in-contract-001"
        }) { transitioned ticket { ticketCode bookingStatus checkedInAt } }
      }`,
      rootValue: {
        checkInTicket: {
          transitioned: true,
          ticket: { ...ticket, bookingStatus: 'CHECKED_IN', checkedInAt: '2030-06-20T00:00:00Z' },
        },
      },
    });

    expect(lookup.errors).toBeUndefined();
    expect(checkIn.errors).toBeUndefined();
    expect(schemaSource).not.toMatch(
      /input (?:StaffTicketLookupInput|CheckInTicketInput)\s*{[^}]*(?:actor|staffId|userId)/i,
    );
  });
});
