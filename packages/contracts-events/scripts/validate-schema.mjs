import { readFile } from 'node:fs/promises';

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const searchSchema = JSON.parse(
  await readFile(new URL('../schema/search-performed-v1.schema.json', import.meta.url), 'utf8'),
);
const searchV2Schema = await loadSchema('search-performed-v2.schema.json');
const seatSchema = JSON.parse(
  await readFile(new URL('../schema/seat-status-changed-v1.schema.json', import.meta.url), 'utf8'),
);
const bookedSeatSchema = JSON.parse(
  await readFile(new URL('../schema/seat-status-changed-v2.schema.json', import.meta.url), 'utf8'),
);
const bookingCreatedSchema = await loadSchema('booking-created-v1.schema.json');
const bookingPaidSchema = await loadSchema('booking-paid-v1.schema.json');
const bookingExpiredSchema = await loadSchema('booking-expired-v1.schema.json');
const bookingCancelledSchema = await loadSchema('booking-cancelled-v1.schema.json');
const paymentAttemptedSchema = await loadSchema('payment-attempted-v1.schema.json');
const searchFixture = {
  eventId: '00000000-0000-4000-8000-000000000901',
  eventType: 'SearchPerformedV1',
  eventVersion: 1,
  occurredAt: '2030-06-20T00:00:00.000Z',
  traceId: '00000000000000000000000000000001',
  producer: 'catalog-service',
  searchSessionId: '00000000-0000-4000-8000-000000000902',
  actorCategory: 'GUEST',
  payload: {
    originLocationId: '00000000-0000-4000-8000-000000000001',
    destinationLocationId: '00000000-0000-4000-8000-000000000002',
    travelDate: '2030-06-20',
    operatorCodes: [],
    vehicleTypeCodes: [],
    sort: 'DEPARTURE_EARLIEST',
    resultCount: 3,
    nearestDateCount: 0,
    cacheStatus: 'MISS',
  },
};

validateFixture('SearchPerformedV1', searchSchema, searchFixture);
validateFixture('SearchPerformedV2', searchV2Schema, {
  ...searchFixture,
  eventType: 'SearchPerformedV2',
  eventVersion: 2,
  payload: {
    ...searchFixture.payload,
    matchedRoutes: [
      {
        routeId: '00000000-0000-4000-8000-000000000501',
        originName: 'TP.HCM',
        destinationName: 'Đà Lạt',
      },
    ],
  },
});

const seatFixture = {
  eventId: '00000000-0000-4000-8000-000000000903',
  eventType: 'SeatStatusChangedV1',
  eventVersion: 1,
  occurredAt: '2030-06-20T00:00:00.000Z',
  producer: 'seat-inventory-service',
  tripId: '00000000-0000-4000-8000-000000000701',
  seatIds: ['A03', 'A04'],
  status: 'HELD',
  expiresAt: '2030-06-20T00:05:00.000Z',
  version: 1,
};
validateFixture('SeatStatusChangedV1', seatSchema, seatFixture);
validateFixture('SeatStatusChangedV2', bookedSeatSchema, {
  eventId: '00000000-0000-4000-8000-000000000904',
  eventType: 'SeatStatusChangedV2',
  eventVersion: 2,
  occurredAt: '2030-06-20T00:01:00.000Z',
  producer: 'seat-inventory-service',
  tripId: seatFixture.tripId,
  seatIds: seatFixture.seatIds,
  status: 'BOOKED',
  version: 2,
});

const validateSeat = ajv.compile(seatSchema);
if (validateSeat({ ...seatFixture, holdToken: 'must-not-leak' })) {
  console.error('SeatStatusChangedV1 schema accepted a hold token.');
  process.exit(1);
}
const validateBookedSeat = ajv.compile(bookedSeatSchema);
if (
  validateBookedSeat({
    eventId: '00000000-0000-4000-8000-000000000904',
    eventType: 'SeatStatusChangedV2',
    eventVersion: 2,
    occurredAt: '2030-06-20T00:01:00.000Z',
    producer: 'seat-inventory-service',
    tripId: seatFixture.tripId,
    seatIds: seatFixture.seatIds,
    status: 'BOOKED',
    version: 2,
    holdToken: 'must-not-leak',
  })
) {
  console.error('SeatStatusChangedV2 schema accepted a hold token.');
  process.exit(1);
}

const bookingEnvelope = {
  eventId: '00000000-0000-4000-8000-000000000905',
  eventVersion: 1,
  occurredAt: '2030-06-20T00:02:00.000Z',
  traceId: '00000000000000000000000000000001',
  requestId: 'request-event-contract',
  producer: 'booking-service',
  aggregateId: '00000000-0000-4000-8000-000000001101',
  actorCategory: 'GUEST',
  checkoutSessionId: '00000000-0000-4000-8000-000000000902',
};
const bookingPayload = {
  bookingId: bookingEnvelope.aggregateId,
  tripId: '00000000-0000-4000-8000-000000000701',
  routeId: '00000000-0000-4000-8000-000000000501',
  routeCode: 'HCM-DLI',
  seatIds: ['A03'],
  passengerCount: 1,
  totalPriceVnd: 280000,
};
const bookingCreatedFixture = {
  ...bookingEnvelope,
  eventType: 'BookingCreatedV1',
  payload: { ...bookingPayload, status: 'PENDING_PAYMENT' },
};
const bookingPaidFixture = {
  ...bookingEnvelope,
  eventId: '00000000-0000-4000-8000-000000000906',
  eventType: 'BookingPaidV1',
  payload: {
    ...bookingPayload,
    paymentAttemptId: '00000000-0000-4000-8000-000000001301',
    paidAt: '2030-06-20T00:02:00.000Z',
    status: 'PAID',
  },
};
const bookingExpiredFixture = {
  ...bookingEnvelope,
  eventId: '00000000-0000-4000-8000-000000000907',
  eventType: 'BookingExpiredV1',
  actorCategory: 'SYSTEM',
  payload: {
    ...bookingPayload,
    expiredAt: '2030-06-20T00:05:00.000Z',
    reason: 'HOLD_EXPIRED',
    status: 'EXPIRED',
  },
};
const customerBookingEnvelope = { ...bookingEnvelope };
delete customerBookingEnvelope.checkoutSessionId;
const bookingCancelledFixture = {
  ...customerBookingEnvelope,
  eventId: '00000000-0000-4000-8000-000000000909',
  eventType: 'BookingCancelledV1',
  actorCategory: 'CUSTOMER',
  payload: {
    ...bookingPayload,
    cancelledAt: '2030-06-20T01:00:00.000Z',
    policyCode: 'BEFORE_DEPARTURE_FULL_RELEASE',
    status: 'CANCELLED',
  },
};
const paymentAttemptedFixture = {
  eventId: '00000000-0000-4000-8000-000000000908',
  eventType: 'PaymentAttemptedV1',
  eventVersion: 1,
  occurredAt: '2030-06-20T00:02:00.000Z',
  traceId: bookingEnvelope.traceId,
  requestId: bookingEnvelope.requestId,
  producer: 'payment-service',
  aggregateId: bookingEnvelope.aggregateId,
  actorCategory: 'GUEST',
  checkoutSessionId: bookingEnvelope.checkoutSessionId,
  payload: {
    paymentAttemptId: '00000000-0000-4000-8000-000000001301',
    bookingId: bookingEnvelope.aggregateId,
    requestedOutcome: 'SUCCESS',
    status: 'SUCCEEDED',
    amountVnd: 280000,
  },
};

validateFixture('BookingCreatedV1', bookingCreatedSchema, bookingCreatedFixture);
validateFixture('BookingPaidV1', bookingPaidSchema, bookingPaidFixture);
validateFixture('BookingExpiredV1', bookingExpiredSchema, bookingExpiredFixture);
validateFixture('BookingCancelledV1', bookingCancelledSchema, bookingCancelledFixture);
validateFixture('PaymentAttemptedV1', paymentAttemptedSchema, paymentAttemptedFixture);
assertRejectedPrivacyField('BookingCreatedV1', bookingCreatedSchema, bookingCreatedFixture);
assertRejectedPrivacyField('BookingPaidV1', bookingPaidSchema, bookingPaidFixture);
assertRejectedPrivacyField('BookingExpiredV1', bookingExpiredSchema, bookingExpiredFixture);
assertRejectedPrivacyField('BookingCancelledV1', bookingCancelledSchema, bookingCancelledFixture);
assertRejectedPrivacyField('PaymentAttemptedV1', paymentAttemptedSchema, paymentAttemptedFixture);

console.log('Event JSON Schemas are valid.');

function validateFixture(name, schema, fixture) {
  const validate = ajv.compile(schema);
  if (!validate(fixture)) {
    console.error(`${name} fixture is invalid.`, validate.errors);
    process.exit(1);
  }
}

async function loadSchema(fileName) {
  return JSON.parse(await readFile(new URL(`../schema/${fileName}`, import.meta.url), 'utf8'));
}

function assertRejectedPrivacyField(name, schema, fixture) {
  const validate = ajv.compile(schema);
  const unsafe = {
    ...fixture,
    payload: { ...fixture.payload, contactEmail: 'must-not-leak@example.com', holdToken: 'secret' },
  };
  if (validate(unsafe)) {
    console.error(`${name} schema accepted contact PII or a hold token.`);
    process.exit(1);
  }
}
