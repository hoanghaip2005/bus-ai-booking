import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { createClient } from 'graphql-ws';
import WebSocket from 'ws';

const edgeUrl = process.env.EDGE_URL ?? 'http://127.0.0.1:8080';
const smokeLocalDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ho_Chi_Minh',
}).format(new Date());
clearMcpRateLimits();

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function getJson(path) {
  const response = await fetch(`${edgeUrl}${path}`);
  assert(response.ok, `${path} returned HTTP ${response.status}`);
  return response.json();
}

const page = await fetch(edgeUrl);
assert(page.ok, `web returned HTTP ${page.status}`);
assert((await page.text()).includes('Bến Việt'), 'web response did not contain the product title');

for (const path of [
  '/health',
  '/gateway-health',
  '/catalog-health',
  '/seat-inventory-health',
  '/booking-health',
  '/payment-health',
  '/ticket-health',
  '/notification-health',
  '/identity-health',
  '/analytics-health',
  '/mcp-health',
]) {
  const health = await getJson(path);
  assert(health.status === 'UP', `${path} was not UP`);
}

async function graphql(query, variables = {}, accessToken) {
  const response = await fetch(`${edgeUrl}/graphql`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
  });
  return { response, body: await response.json() };
}

const loginMutation = `mutation($input: LoginInput!) {
  login(input: $input) { accessToken refreshToken user { id role } }
}`;
const refreshMutation = `mutation($input: RefreshSessionInput!) {
  refreshSession(input: $input) { accessToken refreshToken user { id role } }
}`;
const customerLogin = await graphql(loginMutation, {
  input: { email: 'customer.demo@benviet.vn', password: 'Customer123!' },
});
assert(
  !customerLogin.body.errors,
  `Customer login failed: ${JSON.stringify(customerLogin.body.errors)}`,
);
const customerSession = customerLogin.body.data.login;
const viewerResult = await graphql('{ viewer { id role } }', {}, customerSession.accessToken);
assert(viewerResult.body.data?.viewer.role === 'CUSTOMER', 'Access token did not resolve CUSTOMER');
const historyResult = await graphql(
  '{ myBookings(first: 5) { nodes { id bookingCode status } pageInfo { hasNextPage } } }',
  {},
  customerSession.accessToken,
);
assert(
  !historyResult.body.errors,
  `Customer history failed: ${JSON.stringify(historyResult.body.errors)}`,
);
assert(
  Array.isArray(historyResult.body.data?.myBookings.nodes),
  'Customer history did not return nodes',
);
const profilesResult = await graphql(
  '{ passengerProfiles { id label fullName phone } }',
  {},
  customerSession.accessToken,
);
assert(
  !profilesResult.body.errors,
  `Passenger profiles failed: ${JSON.stringify(profilesResult.body.errors)}`,
);
assert(
  profilesResult.body.data?.passengerProfiles.some((profile) => profile.label === 'Tôi'),
  'Seeded passenger profile was not returned',
);
const smokeProfileLabel = `Smoke-${Date.now()}`;
const createdProfile = await graphql(
  `
    mutation ($input: PassengerProfileInput!) {
      createPassengerProfile(input: $input) {
        id
        label
        fullName
        phone
      }
    }
  `,
  { input: { label: smokeProfileLabel, fullName: 'Smoke Passenger', phone: '0901112233' } },
  customerSession.accessToken,
);
assert(
  !createdProfile.body.errors,
  `Profile create failed: ${JSON.stringify(createdProfile.body.errors)}`,
);
const profileId = createdProfile.body.data.createPassengerProfile.id;
const updatedProfile = await graphql(
  `
    mutation ($id: ID!, $input: PassengerProfileInput!) {
      updatePassengerProfile(id: $id, input: $input) {
        id
        label
        fullName
        phone
      }
    }
  `,
  { id: profileId, input: { label: smokeProfileLabel, fullName: 'Smoke Passenger Updated' } },
  customerSession.accessToken,
);
assert(
  updatedProfile.body.data?.updatePassengerProfile.fullName === 'Smoke Passenger Updated',
  'Profile update failed',
);
const deletedProfile = await graphql(
  'mutation($id: ID!) { deletePassengerProfile(id: $id) { id deleted } }',
  { id: profileId },
  customerSession.accessToken,
);
assert(deletedProfile.body.data?.deletePassengerProfile.deleted === true, 'Profile delete failed');
const forbiddenAdmin = await graphql(
  'mutation($input: SetTripActiveInput!) { setTripActive(input: $input) { changed } }',
  { input: { tripId: '00000000-0000-4000-8000-000000000704', isActive: true } },
  customerSession.accessToken,
);
assert(
  forbiddenAdmin.body.errors?.[0]?.extensions?.code === 'FORBIDDEN',
  'CUSTOMER admin command was not forbidden',
);
const customerRefresh = await graphql(refreshMutation, {
  input: { refreshToken: customerSession.refreshToken },
});
assert(
  !customerRefresh.body.errors,
  `Refresh failed: ${JSON.stringify(customerRefresh.body.errors)}`,
);
assert(
  customerRefresh.body.data.refreshSession.refreshToken !== customerSession.refreshToken,
  'Refresh token did not rotate',
);
const refreshReplay = await graphql(refreshMutation, {
  input: { refreshToken: customerSession.refreshToken },
});
assert(
  refreshReplay.body.errors?.[0]?.extensions?.code === 'UNAUTHENTICATED',
  'Rotated token replay was accepted',
);

const adminLogin = await graphql(loginMutation, {
  input: { email: 'admin.demo@benviet.vn', password: 'Admin123!' },
});
assert(!adminLogin.body.errors, `Admin login failed: ${JSON.stringify(adminLogin.body.errors)}`);
const adminSession = adminLogin.body.data.login;
const activationMutation =
  'mutation($input: SetTripActiveInput!) { setTripActive(input: $input) { isActive changed } }';
try {
  const deactivate = await graphql(
    activationMutation,
    { input: { tripId: '00000000-0000-4000-8000-000000000704', isActive: false } },
    adminSession.accessToken,
  );
  assert(deactivate.body.data?.setTripActive.isActive === false, 'ADMIN could not deactivate trip');
} finally {
  const restore = await graphql(
    activationMutation,
    { input: { tripId: '00000000-0000-4000-8000-000000000704', isActive: true } },
    adminSession.accessToken,
  );
  assert(restore.body.data?.setTripActive.isActive === true, 'Smoke could not restore trip 704');
}
const logoutResult = await graphql(
  'mutation($input: LogoutInput!) { logout(input: $input) { revoked } }',
  { input: { refreshToken: adminSession.refreshToken } },
);
assert(logoutResult.body.data?.logout.revoked === true, 'Logout did not revoke refresh session');
const revokedRefresh = await graphql(refreshMutation, {
  input: { refreshToken: adminSession.refreshToken },
});
assert(
  revokedRefresh.body.errors?.[0]?.extensions?.code === 'UNAUTHENTICATED',
  'Logout token was reusable',
);

const graphqlResponse = await fetch(`${edgeUrl}/graphql`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    query: '{ platformHealth { status } catalogHealth { service status requestId traceId } }',
  }),
});
const graphqlBody = await graphqlResponse.json();
assert(graphqlResponse.ok, `GraphQL returned HTTP ${graphqlResponse.status}`);
assert(!graphqlBody.errors, `GraphQL returned errors: ${JSON.stringify(graphqlBody.errors)}`);
assert(graphqlBody.data.catalogHealth.status === 'UP', 'Catalog gRPC health was not UP');
assert(
  graphqlBody.data.catalogHealth.requestId === graphqlResponse.headers.get('x-request-id'),
  'request id was not propagated from HTTP through gRPC',
);
assert(
  graphqlBody.data.catalogHealth.traceId !== 'unavailable',
  'trace context was not active inside Catalog Service',
);

const suggestionsResponse = await fetch(`${edgeUrl}/graphql`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    query: 'query($query: String!) { locationSuggestions(query: $query) { code name kind } }',
    variables: { query: 'Sai Gon' },
  }),
});
const suggestionsBody = await suggestionsResponse.json();
assert(suggestionsResponse.ok, `Location suggestions returned HTTP ${suggestionsResponse.status}`);
assert(
  !suggestionsBody.errors,
  `Location suggestions returned errors: ${JSON.stringify(suggestionsBody.errors)}`,
);
assert(
  suggestionsBody.data.locationSuggestions.some((location) => location.name === 'TP.HCM'),
  'Unaccented Sai Gon alias did not resolve to TP.HCM',
);

const tripSearchResponse = await fetch(`${edgeUrl}/graphql`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    query:
      'query($input: SearchTripsInput!) { searchTrips(input: $input) { timezone trips { operatorName departureAt priceVnd remainingSeats } } }',
    variables: {
      input: {
        originLocationId: '00000000-0000-4000-8000-000000000001',
        destinationLocationId: '00000000-0000-4000-8000-000000000002',
        travelDate: '2030-06-20',
      },
    },
  }),
});
const tripSearchBody = await tripSearchResponse.json();
assert(tripSearchResponse.ok, `Trip search returned HTTP ${tripSearchResponse.status}`);
assert(
  !tripSearchBody.errors,
  `Trip search returned errors: ${JSON.stringify(tripSearchBody.errors)}`,
);
assert(tripSearchBody.data.searchTrips.timezone === 'Asia/Ho_Chi_Minh', 'Trip timezone is wrong');
assert(
  tripSearchBody.data.searchTrips.trips.length === 3,
  'Seeded trip search did not return 3 trips',
);
assert(
  tripSearchBody.data.searchTrips.trips[0].departureAt === '2030-06-20T00:00:00.000Z',
  'Trip departure was not stored and returned in UTC',
);

const tripDetailResponse = await fetch(`${edgeUrl}/graphql`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    query:
      'query($id: ID!) { trip(id: $id) { routeCode timezone stops { kind scheduledAt } seatLayout { version seats { label } } policies { code resourceUri } } }',
    variables: { id: '00000000-0000-4000-8000-000000000701' },
  }),
});
const tripDetailBody = await tripDetailResponse.json();
assert(!tripDetailBody.errors, `Trip detail failed: ${JSON.stringify(tripDetailBody.errors)}`);
assert(tripDetailBody.data.trip.routeCode === 'HCM-DLI', 'Trip detail route code is wrong');
assert(tripDetailBody.data.trip.stops.length === 2, 'Trip detail did not return ordered stops');
assert(
  tripDetailBody.data.trip.seatLayout.seats.length === 34,
  'Trip detail did not return the versioned sleeper seat layout',
);

const seatMapResponse = await fetch(`${edgeUrl}/graphql`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    query:
      'query($tripId: ID!) { seatMap(tripId: $tripId) { tripId layoutVersion seats { label status } } }',
    variables: { tripId: '00000000-0000-4000-8000-000000000701' },
  }),
});
const seatMapBody = await seatMapResponse.json();
assert(!seatMapBody.errors, `Seat map failed: ${JSON.stringify(seatMapBody.errors)}`);
assert(seatMapBody.data.seatMap.seats.length === 34, 'Seat map did not return 34 seats');
assert(
  seatMapBody.data.seatMap.seats.find((seat) => seat.label === 'A01')?.status === 'BOOKED',
  'Durable booked seat did not override AVAILABLE',
);
assert(
  seatMapBody.data.seatMap.seats.find((seat) => seat.label === 'A02')?.status === 'BLOCKED',
  'Durable blocked seat did not override AVAILABLE',
);

const checkoutSessionId = randomUUID();
const holdResponse = await fetch(`${edgeUrl}/graphql`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-checkout-session-id': checkoutSessionId,
  },
  body: JSON.stringify({
    query:
      'mutation($input: HoldSeatsInput!) { holdSeats(input: $input) { token seatIds status unitPriceVnd totalPriceVnd } }',
    variables: {
      input: {
        tripId: '00000000-0000-4000-8000-000000000701',
        seatIds: ['A03'],
        idempotencyKey: randomUUID(),
        ttlSeconds: 300,
      },
    },
  }),
});
const holdBody = await holdResponse.json();
assert(!holdBody.errors, `Seat hold failed: ${JSON.stringify(holdBody.errors)}`);
assert(holdBody.data.holdSeats.status === 'ACTIVE', 'Seat hold was not active');
assert(holdBody.data.holdSeats.totalPriceVnd === 280000, 'Seat hold price was not authoritative');

const heldMapResponse = await fetch(`${edgeUrl}/graphql`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-checkout-session-id': checkoutSessionId,
  },
  body: JSON.stringify({
    query:
      'query($tripId: ID!, $token: String) { seatMap(tripId: $tripId, holdToken: $token) { seats { id status heldByRequester } } }',
    variables: {
      tripId: '00000000-0000-4000-8000-000000000701',
      token: holdBody.data.holdSeats.token,
    },
  }),
});
const heldMapBody = await heldMapResponse.json();
const heldSeat = heldMapBody.data.seatMap.seats.find((seat) => seat.id === 'A03');
assert(heldSeat?.status === 'HELD' && heldSeat.heldByRequester, 'Hold was not visible to owner');

const bookingResponse = await fetch(`${edgeUrl}/graphql`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-checkout-session-id': checkoutSessionId,
  },
  body: JSON.stringify({
    query:
      'mutation($input: CreateBookingInput!) { createBooking(input: $input) { id bookingCode status totalPriceVnd passengers { seatId } } }',
    variables: {
      input: {
        holdToken: holdBody.data.holdSeats.token,
        idempotencyKey: randomUUID(),
        contact: {
          fullName: 'Smoke Guest',
          email: 'smoke.guest@example.com',
          phone: '0901234567',
        },
        passengers: [{ seatId: 'A03', fullName: 'Smoke Guest' }],
      },
    },
  }),
});
const bookingBody = await bookingResponse.json();
assert(!bookingBody.errors, `Booking creation failed: ${JSON.stringify(bookingBody.errors)}`);
assert(
  bookingBody.data.createBooking.status === 'PENDING_PAYMENT',
  'Booking was not PENDING_PAYMENT',
);
assert(
  bookingBody.data.createBooking.totalPriceVnd === 280000,
  'Booking price was not authoritative',
);

const bookedPendingMapResponse = await fetch(`${edgeUrl}/graphql`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-checkout-session-id': checkoutSessionId,
  },
  body: JSON.stringify({
    query:
      'query($tripId: ID!, $token: String) { seatMap(tripId: $tripId, holdToken: $token) { seats { id status heldByRequester } } }',
    variables: {
      tripId: '00000000-0000-4000-8000-000000000701',
      token: holdBody.data.holdSeats.token,
    },
  }),
});
const bookedPendingMapBody = await bookedPendingMapResponse.json();
const pendingSeat = bookedPendingMapBody.data.seatMap.seats.find((seat) => seat.id === 'A03');
assert(
  pendingSeat?.status === 'HELD' && pendingSeat.heldByRequester,
  'PENDING_PAYMENT booking sold the seat before payment',
);

const failedPaymentResponse = await fetch(`${edgeUrl}/graphql`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-checkout-session-id': checkoutSessionId,
  },
  body: JSON.stringify({
    query:
      'mutation($input: SimulatePaymentInput!) { simulatePayment(input: $input) { status failureCode booking { status } } }',
    variables: {
      input: {
        bookingId: bookingBody.data.createBooking.id,
        outcome: 'FAILURE',
        idempotencyKey: randomUUID(),
      },
    },
  }),
});
const failedPaymentBody = await failedPaymentResponse.json();
assert(
  !failedPaymentBody.errors,
  `Simulated payment failure returned errors: ${JSON.stringify(failedPaymentBody.errors)}`,
);
assert(
  failedPaymentBody.data.simulatePayment.status === 'FAILED' &&
    failedPaymentBody.data.simulatePayment.booking.status === 'PENDING_PAYMENT',
  'Simulated payment failure sold seats or changed booking state',
);

const successfulPaymentResponse = await fetch(`${edgeUrl}/graphql`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-checkout-session-id': checkoutSessionId,
  },
  body: JSON.stringify({
    query:
      'mutation($input: SimulatePaymentInput!) { simulatePayment(input: $input) { paymentAttemptId status booking { status } } }',
    variables: {
      input: {
        bookingId: bookingBody.data.createBooking.id,
        outcome: 'SUCCESS',
        idempotencyKey: randomUUID(),
      },
    },
  }),
});
const successfulPaymentBody = await successfulPaymentResponse.json();
assert(
  !successfulPaymentBody.errors,
  `Simulated payment success returned errors: ${JSON.stringify(successfulPaymentBody.errors)}`,
);
assert(
  successfulPaymentBody.data.simulatePayment.status === 'SUCCEEDED' &&
    successfulPaymentBody.data.simulatePayment.booking.status === 'PAID',
  'Successful payment did not transition booking to PAID',
);

const paidSeatMapResponse = await fetch(`${edgeUrl}/graphql`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    query: 'query($tripId: ID!) { seatMap(tripId: $tripId) { seats { id status } } }',
    variables: { tripId: '00000000-0000-4000-8000-000000000701' },
  }),
});
const paidSeatMapBody = await paidSeatMapResponse.json();
assert(!paidSeatMapBody.errors, `Paid seat map failed: ${JSON.stringify(paidSeatMapBody.errors)}`);
assert(
  paidSeatMapBody.data.seatMap.seats.find((seat) => seat.id === 'A03')?.status === 'BOOKED',
  'PAID booking did not create durable BOOKED inventory',
);
const ticketDelivery = await waitForTicketDelivery(
  bookingBody.data.createBooking.id,
  checkoutSessionId,
);
assert(ticketDelivery.tickets.length === 1, 'Ticket Worker did not issue one passenger ticket');
assert(
  Buffer.from(ticketDelivery.tickets[0].pdfBase64, 'base64').subarray(0, 5).toString() === '%PDF-',
  'Ticket Worker did not return a valid PDF document',
);
assert(ticketDelivery.tickets[0].htmlContent.includes('Smoke Guest'), 'HTML ticket is incomplete');
await waitForNotificationLog(bookingBody.data.createBooking.id);
const mcpBooking = await callMcp(20, 'tools/call', {
  name: 'get_booking_status',
  arguments: {
    bookingCode: bookingBody.data.createBooking.bookingCode,
    email: 'smoke.guest@example.com',
  },
});
assert(mcpBooking.includes('TICKET_ISSUED'), 'MCP booking lookup did not return issued status');
assert(mcpBooking.includes('A03'), 'MCP booking lookup did not return the booked seat');
assert(!mcpBooking.includes('smoke.guest@example.com'), 'MCP booking output exposed email');
const deniedMcpBooking = await callMcp(21, 'tools/call', {
  name: 'get_booking_status',
  arguments: {
    bookingCode: bookingBody.data.createBooking.bookingCode,
    email: 'wrong@example.com',
  },
});
assert(
  deniedMcpBooking.includes('Không thể xác minh booking'),
  'MCP wrong-email lookup was not neutral',
);
for (let attempt = 0; attempt < 3; attempt += 1) {
  await callMcp(22 + attempt, 'tools/call', {
    name: 'get_booking_status',
    arguments: {
      bookingCode: bookingBody.data.createBooking.bookingCode,
      email: 'smoke.guest@example.com',
    },
  });
}
const limitedMcpBooking = await fetch(`${edgeUrl}/mcp`, {
  method: 'POST',
  headers: {
    accept: 'application/json, text/event-stream',
    'content-type': 'application/json',
  },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 25,
    method: 'tools/call',
    params: {
      name: 'get_booking_status',
      arguments: {
        bookingCode: bookingBody.data.createBooking.bookingCode,
        email: 'smoke.guest@example.com',
      },
    },
  }),
});
assert(limitedMcpBooking.status === 429, 'MCP booking lookup limit did not return HTTP 429');
assert(limitedMcpBooking.headers.get('retry-after'), 'MCP rate limit omitted Retry-After');
deleteSmokeBooking(bookingBody.data.createBooking.id);

const missingTripResponse = await fetch(`${edgeUrl}/graphql`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    query: 'query($id: ID!) { trip(id: $id) { id } }',
    variables: { id: '00000000-0000-4000-8000-000000000799' },
  }),
});
const missingTripBody = await missingTripResponse.json();
assert(
  missingTripBody.errors?.[0]?.extensions?.code === 'NOT_FOUND',
  `Inactive trip did not return NOT_FOUND: ${JSON.stringify(missingTripBody.errors)}`,
);

const filteredTripResponse = await fetch(`${edgeUrl}/graphql`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    query:
      'query($input: SearchTripsInput!) { searchTrips(input: $input) { trips { operatorName priceVnd } } }',
    variables: {
      input: {
        originLocationId: '00000000-0000-4000-8000-000000000001',
        destinationLocationId: '00000000-0000-4000-8000-000000000002',
        travelDate: '2030-06-20',
        maxPriceVnd: 250000,
        sort: 'PRICE_LOWEST',
      },
    },
  }),
});
const filteredTripBody = await filteredTripResponse.json();
assert(
  !filteredTripBody.errors,
  `Filtered trip search failed: ${JSON.stringify(filteredTripBody.errors)}`,
);
assert(
  filteredTripBody.data.searchTrips.trips.length === 1 &&
    filteredTripBody.data.searchTrips.trips[0].operatorName === 'Kumho Demo',
  'Price filter did not return the expected trip',
);

const nearestDateResponse = await fetch(`${edgeUrl}/graphql`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    query:
      'query($input: SearchTripsInput!) { searchTrips(input: $input) { trips { id } nearestTravelDates } }',
    variables: {
      input: {
        originLocationId: '00000000-0000-4000-8000-000000000001',
        destinationLocationId: '00000000-0000-4000-8000-000000000002',
        travelDate: '2030-06-19',
      },
    },
  }),
});
const nearestDateBody = await nearestDateResponse.json();
assert(
  !nearestDateBody.errors,
  `Nearest-date search failed: ${JSON.stringify(nearestDateBody.errors)}`,
);
assert(
  nearestDateBody.data.searchTrips.trips.length === 0,
  'No-result search unexpectedly returned trips',
);
assert(
  nearestDateBody.data.searchTrips.nearestTravelDates.join(',') === '2030-06-20,2030-06-21',
  'Nearest travel dates are incorrect',
);

invalidateTripSearchCache();
const analyticsSearchSessionId = randomUUID();
const analyticsSearchBody = {
  query:
    'query($input: SearchTripsInput!) { searchTrips(input: $input) { trips { id } nearestTravelDates } }',
  variables: {
    input: {
      originLocationId: '00000000-0000-4000-8000-000000000001',
      destinationLocationId: '00000000-0000-4000-8000-000000000002',
      travelDate: '2030-06-20',
      operatorCodes: ['PT-DEMO'],
      vehicleTypeCodes: ['SLEEPER-34'],
      sort: 'DURATION_SHORTEST',
    },
  },
};
for (let attempt = 0; attempt < 2; attempt += 1) {
  const response = await fetch(`${edgeUrl}/graphql`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-search-session-id': analyticsSearchSessionId,
    },
    body: JSON.stringify(analyticsSearchBody),
  });
  const body = await response.json();
  assert(!body.errors, `Repeated analytics search failed: ${JSON.stringify(body.errors)}`);
}

const searchEvents = await waitForSearchEvents(analyticsSearchSessionId, 2);
assert(
  searchEvents.map((event) => event.payload.cacheStatus).join(',') === 'MISS,HIT',
  `Repeated search did not produce MISS,HIT events: ${JSON.stringify(searchEvents)}`,
);
assert(
  searchEvents.every((event) => event.traceId !== 'unavailable'),
  'Search analytics events did not carry an active trace ID',
);

const unauthenticatedAdminTool = await fetch(`${edgeUrl}/mcp`, {
  method: 'POST',
  headers: { accept: 'application/json, text/event-stream', 'content-type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 30,
    method: 'tools/call',
    params: {
      name: 'get_revenue_summary',
      arguments: { fromDate: smokeLocalDate, toDate: smokeLocalDate },
    },
  }),
});
assert(unauthenticatedAdminTool.status === 401, 'MCP admin tool accepted missing credentials');

const mcpCustomerLogin = await graphql(loginMutation, {
  input: { email: 'customer.demo@benviet.vn', password: 'Customer123!' },
});
assert(!mcpCustomerLogin.body.errors, 'Could not create MCP CUSTOMER session');
const mcpCustomerSession = mcpCustomerLogin.body.data.login;
const forbiddenMcpAdminTool = await fetch(`${edgeUrl}/mcp`, {
  method: 'POST',
  headers: {
    accept: 'application/json, text/event-stream',
    authorization: `Bearer ${mcpCustomerSession.accessToken}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 31,
    method: 'tools/call',
    params: {
      name: 'get_popular_routes',
      arguments: { fromDate: smokeLocalDate, toDate: smokeLocalDate, limit: 5 },
    },
  }),
});
assert(forbiddenMcpAdminTool.status === 403, 'MCP admin tool accepted CUSTOMER credentials');
await graphql('mutation($input: LogoutInput!) { logout(input: $input) { revoked } }', {
  input: { refreshToken: mcpCustomerSession.refreshToken },
});

const mcpAdminLogin = await graphql(loginMutation, {
  input: { email: 'admin.demo@benviet.vn', password: 'Admin123!' },
});
assert(!mcpAdminLogin.body.errors, 'Could not create MCP ADMIN session');
const mcpAdminSession = mcpAdminLogin.body.data.login;
const mcpRevenue = await callMcp(
  32,
  'tools/call',
  {
    name: 'get_revenue_summary',
    arguments: { fromDate: smokeLocalDate, toDate: smokeLocalDate },
  },
  mcpAdminSession.accessToken,
);
assert(mcpRevenue.includes('totalRevenueVnd'), 'MCP revenue summary omitted total revenue');
assert(mcpRevenue.includes('Asia/Ho_Chi_Minh'), 'MCP revenue summary omitted timezone');
const mcpPopularRoutes = await callMcp(
  33,
  'tools/call',
  {
    name: 'get_popular_routes',
    arguments: { fromDate: smokeLocalDate, toDate: smokeLocalDate, limit: 5 },
  },
  mcpAdminSession.accessToken,
);
assert(mcpPopularRoutes.includes('HCM-DLI'), 'MCP popular routes omitted the searched route');
await graphql('mutation($input: LogoutInput!) { logout(input: $input) { revoked } }', {
  input: { refreshToken: mcpAdminSession.refreshToken },
});
const revokedMcpAdminTool = await fetch(`${edgeUrl}/mcp`, {
  method: 'POST',
  headers: {
    accept: 'application/json, text/event-stream',
    authorization: `Bearer ${mcpAdminSession.accessToken}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 34,
    method: 'tools/call',
    params: {
      name: 'get_revenue_summary',
      arguments: { fromDate: smokeLocalDate, toDate: smokeLocalDate },
    },
  }),
});
assert(revokedMcpAdminTool.status === 401, 'MCP accepted a revoked ADMIN access token');

async function callMcp(id, method, params = {}, accessToken) {
  const response = await fetch(`${edgeUrl}/mcp`, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  const body = await response.text();
  assert(response.ok, `MCP ${method} returned HTTP ${response.status}`);
  return body;
}

const mcpTools = await callMcp(2, 'tools/list');
assert(mcpTools.includes('system_health'), 'MCP tools/list did not include system_health');
assert(mcpTools.includes('search_trips'), 'MCP tools/list did not include search_trips');
assert(mcpTools.includes('get_trip_detail'), 'MCP tools/list did not include get_trip_detail');
const mcpResources = await callMcp(3, 'resources/list');
assert(mcpResources.includes('bus://policy/cancellation'), 'MCP cancellation resource is missing');
assert(mcpResources.includes('bus://policy/checkin'), 'MCP check-in resource is missing');
assert(mcpResources.includes('bus://routes/popular'), 'MCP popular-routes resource is missing');
assert(mcpResources.includes('bus://system/health'), 'MCP system-health resource is missing');
const mcpPopularRoutesResource = await callMcp(35, 'resources/read', {
  uri: 'bus://routes/popular',
});
assert(
  mcpPopularRoutesResource.includes('HCM-DLI'),
  'MCP popular-routes resource omitted seeded route',
);
assert(
  !mcpPopularRoutesResource.includes('paidBookingCount'),
  'MCP public route resource exposed paid data',
);
assert(
  !mcpPopularRoutesResource.includes('conversionRate'),
  'MCP public route resource exposed conversion',
);
const mcpSystemHealth = await callMcp(36, 'resources/read', {
  uri: 'bus://system/health',
});
assert(mcpSystemHealth.includes('intercity-bus-platform'), 'MCP system-health resource is invalid');
assert(!mcpSystemHealth.includes('localhost'), 'MCP system-health exposed an internal hostname');
assert(!mcpSystemHealth.includes('5005'), 'MCP system-health exposed an internal service port');
const mcpSearch = await callMcp(4, 'tools/call', {
  name: 'search_trips',
  arguments: { origin: 'TP.HCM', destination: 'Đà Lạt', travelDate: '2030-06-21' },
});
assert(
  mcpSearch.includes('00000000-0000-4000-8000-000000000704'),
  'MCP search did not return the seeded trip',
);
assert(mcpSearch.includes('280000'), 'MCP search did not return integer VND fare');
const mcpTrip = await callMcp(5, 'tools/call', {
  name: 'get_trip_detail',
  arguments: { tripId: '00000000-0000-4000-8000-000000000704' },
});
assert(mcpTrip.includes('HCM-DLI'), 'MCP trip detail did not return the seeded route');

const subscriptionUrl = edgeUrl.replace(/^http/, 'ws') + '/graphql';
let markSubscriptionConnected;
const subscriptionConnected = new Promise((resolve) => {
  markSubscriptionConnected = resolve;
});
const client = createClient({
  url: subscriptionUrl,
  webSocketImpl: WebSocket,
  connectionAckWaitTimeout: 5_000,
  on: { connected: () => markSubscriptionConnected() },
});

const seatEvents = [];
let seatSubscriptionError;
const unsubscribeSeatEvents = client.subscribe(
  {
    query:
      'subscription($tripId: ID!) { seatStatusChanged(tripId: $tripId) { tripId seatIds status expiresAt version occurredAt } }',
    variables: { tripId: '00000000-0000-4000-8000-000000000701' },
  },
  {
    next: (value) => {
      const event = value.data?.seatStatusChanged;
      if (event?.seatIds?.includes('A04')) seatEvents.push(event);
    },
    error: (error) => {
      seatSubscriptionError = error;
    },
    complete: () => undefined,
  },
);
await subscriptionConnected;
await new Promise((resolve) => setTimeout(resolve, 100));

const realtimeCheckoutSessionId = randomUUID();
const realtimeHoldResponse = await fetch(`${edgeUrl}/graphql`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-checkout-session-id': realtimeCheckoutSessionId,
  },
  body: JSON.stringify({
    query:
      'mutation($input: HoldSeatsInput!) { holdSeats(input: $input) { token seatIds status } }',
    variables: {
      input: {
        tripId: '00000000-0000-4000-8000-000000000701',
        seatIds: ['A04'],
        idempotencyKey: randomUUID(),
        ttlSeconds: 1,
      },
    },
  }),
});
const realtimeHoldBody = await realtimeHoldResponse.json();
assert(
  !realtimeHoldBody.errors,
  `Realtime seat hold failed: ${JSON.stringify(realtimeHoldBody.errors)}`,
);
const heldEvent = await waitForSeatEvent(seatEvents, 'HELD');
const realtimeHeldMap = await querySeatStatus('A04', realtimeHoldBody.data.holdSeats.token);
assert(
  realtimeHeldMap.status === 'HELD' && realtimeHeldMap.heldByRequester,
  'HELD notification was not followed by authoritative HELD state',
);

const availableEvent = await waitForSeatEvent(seatEvents, 'AVAILABLE', 6_000);
const realtimeAvailableMap = await querySeatStatus('A04');
assert(
  realtimeAvailableMap.status === 'AVAILABLE' && !realtimeAvailableMap.heldByRequester,
  'AVAILABLE notification was not followed by authoritative AVAILABLE state',
);
assert(availableEvent.version > heldEvent.version, 'Seat event version did not increase');
assert(
  !/token|owner|checkout/i.test(JSON.stringify(seatEvents)),
  'Seat subscription leaked checkout ownership data',
);
unsubscribeSeatEvents();

const pulse = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Subscription timed out')), 8_000);
  const unsubscribe = client.subscribe(
    { query: 'subscription { platformPulse { sequence service status emittedAt } }' },
    {
      next: (value) => {
        clearTimeout(timer);
        unsubscribe();
        resolve(value);
      },
      error: (error) => {
        clearTimeout(timer);
        reject(error);
      },
      complete: () => undefined,
    },
  );
});

assert(pulse.data?.platformPulse?.status === 'UP', 'GraphQL subscription did not emit UP');
await client.dispose();

console.log(
  'Foundation smoke passed: HTTP, GraphQL, Catalog/Seat/Booking/Payment/Ticket gRPC, guest booking, simulated payment, durable seat confirmation, ticket PDF/HTML, notification log, Redis, PostgreSQL, RabbitMQ, Kafka, MCP and WebSocket.',
);

function invalidateTripSearchCache() {
  const result = spawnSync(
    'docker',
    [
      'compose',
      '-f',
      'infra/docker-compose.yml',
      'exec',
      '-T',
      'redis',
      'redis-cli',
      'INCR',
      'catalog:trip-search:v1:generation',
    ],
    { encoding: 'utf8', shell: process.platform === 'win32' },
  );
  assert(result.status === 0, `Could not invalidate trip search cache: ${result.stderr}`);
}

function clearMcpRateLimits() {
  const script =
    "local keys=redis.call('KEYS',ARGV[1]); if #keys>0 then return redis.call('DEL',unpack(keys)) end; return 0";
  const result = spawnSync(
    'docker',
    [
      'compose',
      '-f',
      'infra/docker-compose.yml',
      'exec',
      '-T',
      'redis',
      'redis-cli',
      'EVAL',
      script,
      '0',
      'mcp:rate-limit:v1:*',
    ],
    { encoding: 'utf8', shell: process.platform === 'win32' },
  );
  assert(result.status === 0, `Could not clear MCP rate limits: ${result.stderr}`);
}

function deleteSmokeBooking(bookingId) {
  assert(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(bookingId),
    'Smoke booking ID was not a UUID',
  );
  const result = spawnSync(
    'docker',
    [
      'compose',
      '-f',
      'infra/docker-compose.yml',
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      process.env.POSTGRES_USER ?? 'bus',
      '-d',
      process.env.POSTGRES_DB ?? 'bus_platform',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    {
      encoding: 'utf8',
      input: `DELETE FROM ticket.inbox_events WHERE booking_id = '${bookingId}'::uuid;
DELETE FROM ticket.tickets WHERE booking_id = '${bookingId}'::uuid;
DELETE FROM notification.inbox_events WHERE booking_id = '${bookingId}'::uuid;
DELETE FROM notification.email_delivery_logs WHERE booking_id = '${bookingId}'::uuid;
DELETE FROM booking.outbox_events WHERE aggregate_id = '${bookingId}'::uuid;
DELETE FROM payment.outbox_events WHERE aggregate_id = '${bookingId}'::uuid;
DELETE FROM seat_inventory.trip_seat_states WHERE booking_id = '${bookingId}'::uuid;
DELETE FROM seat_inventory.confirmation_requests WHERE booking_id = '${bookingId}'::uuid;
DELETE FROM payment.attempts WHERE booking_id = '${bookingId}'::uuid;
DELETE FROM booking.bookings WHERE id = '${bookingId}'::uuid;\n`,
      shell: process.platform === 'win32',
    },
  );
  assert(result.status === 0, `Could not clean up smoke booking: ${result.stderr}`);
}

async function waitForTicketDelivery(bookingId, checkoutSessionId) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${edgeUrl}/graphql`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-checkout-session-id': checkoutSessionId,
      },
      body: JSON.stringify({
        query:
          'query($bookingId: ID!) { bookingTickets(bookingId: $bookingId) { ready tickets { ticketCode htmlContent pdfBase64 } } }',
        variables: { bookingId },
      }),
    });
    const body = await response.json();
    assert(!body.errors, `Ticket lookup failed: ${JSON.stringify(body.errors)}`);
    if (body.data.bookingTickets.ready) return body.data.bookingTickets;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Timed out waiting for ticket documents.');
}

function notificationLogCount(bookingId) {
  const result = spawnSync(
    'docker',
    [
      'compose',
      '-f',
      'infra/docker-compose.yml',
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      process.env.POSTGRES_USER ?? 'bus',
      '-d',
      process.env.POSTGRES_DB ?? 'bus_platform',
      '-At',
      '-c',
      `SELECT count(*) FROM notification.email_delivery_logs WHERE booking_id = '${bookingId}'::uuid`,
    ],
    { encoding: 'utf8' },
  );
  assert(result.status === 0, `Could not inspect notification log: ${result.stderr}`);
  return Number(result.stdout.trim());
}

async function waitForNotificationLog(bookingId) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (notificationLogCount(bookingId) === 1) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Timed out waiting for the simulated notification email.');
}

async function waitForSearchEvents(searchSessionId, expectedCount) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const result = spawnSync(
      'docker',
      [
        'compose',
        '-f',
        'infra/docker-compose.yml',
        'exec',
        '-T',
        'kafka',
        '/opt/kafka/bin/kafka-console-consumer.sh',
        '--bootstrap-server',
        'localhost:9092',
        '--topic',
        'search-events',
        '--from-beginning',
        '--timeout-ms',
        '5000',
      ],
      { encoding: 'utf8', shell: process.platform === 'win32' },
    );
    const events = result.stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((event) => event.searchSessionId === searchSessionId);
    if (events.length >= expectedCount) return events.slice(0, expectedCount);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${expectedCount} search analytics events.`);
}

async function waitForSeatEvent(events, status, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (seatSubscriptionError) {
      throw new Error(`Seat status subscription failed: ${JSON.stringify(seatSubscriptionError)}`);
    }
    const event = events.find((candidate) => candidate.status === status);
    if (event) return event;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${status} seat notification.`);
}

async function querySeatStatus(seatId, holdToken) {
  const response = await fetch(`${edgeUrl}/graphql`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-checkout-session-id': realtimeCheckoutSessionId,
    },
    body: JSON.stringify({
      query:
        'query($tripId: ID!, $holdToken: String) { seatMap(tripId: $tripId, holdToken: $holdToken) { seats { id status heldByRequester } } }',
      variables: {
        tripId: '00000000-0000-4000-8000-000000000701',
        holdToken: holdToken ?? null,
      },
    }),
  });
  const body = await response.json();
  assert(!body.errors, `Realtime seat map failed: ${JSON.stringify(body.errors)}`);
  return body.data.seatMap.seats.find((seat) => seat.id === seatId);
}
