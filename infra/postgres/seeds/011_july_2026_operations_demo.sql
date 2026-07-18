BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.seed_uuid(seed_value text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT (
    substr(hash_value, 1, 8) || '-' ||
    substr(hash_value, 9, 4) || '-4' ||
    substr(hash_value, 14, 3) || '-8' ||
    substr(hash_value, 18, 3) || '-' ||
    substr(hash_value, 21, 12)
  )::uuid
  FROM (SELECT md5(seed_value) AS hash_value) AS hashed;
$$;

CREATE TEMP TABLE july_2026_operations_seed ON COMMIT DROP AS
WITH calendar AS (
  SELECT day_value::date AS travel_date,
         row_number() OVER (ORDER BY day_value)::integer AS day_index
  FROM generate_series('2026-07-18'::date, '2026-07-30'::date, interval '1 day') day_value
),
trip_pool AS (
  SELECT
    (trip.departure_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS travel_date,
    row_number() OVER (
      PARTITION BY (trip.departure_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
      ORDER BY route.code, trip.departure_at, trip.id
    )::integer AS trip_index,
    trip.id AS trip_id,
    route.id AS route_id,
    route.code AS route_code,
    origin.name AS origin_name,
    destination.name AS destination_name,
    operator.name AS operator_name,
    vehicle_type.name AS vehicle_type_name,
    vehicle.code AS vehicle_code,
    vehicle.plate AS vehicle_plate,
    trip.departure_at,
    trip.arrival_at,
    fare.price_vnd
  FROM catalog.trips trip
  JOIN catalog.routes route ON route.id = trip.route_id
  JOIN catalog.locations origin ON origin.id = route.origin_location_id
  JOIN catalog.locations destination ON destination.id = route.destination_location_id
  JOIN catalog.vehicles vehicle ON vehicle.id = trip.vehicle_id
  JOIN catalog.operators operator ON operator.id = vehicle.operator_id
  JOIN catalog.vehicle_types vehicle_type ON vehicle_type.id = vehicle.vehicle_type_id
  JOIN catalog.fares fare ON fare.trip_id = trip.id
  WHERE (trip.departure_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
        BETWEEN DATE '2026-07-18' AND DATE '2026-07-30'
),
source AS (
  SELECT
    calendar.travel_date,
    calendar.day_index,
    slot.slot_no,
    pool.trip_id,
    pool.route_id,
    pool.route_code,
    pool.origin_name,
    pool.destination_name,
    pool.operator_name,
    pool.vehicle_type_name,
    pool.vehicle_code,
    pool.vehicle_plate,
    pool.departure_at,
    pool.arrival_at,
    pool.price_vnd
  FROM calendar
  CROSS JOIN (VALUES (1), (2)) AS slot(slot_no)
  JOIN trip_pool pool
    ON pool.travel_date = calendar.travel_date
   AND pool.trip_index = (((calendar.day_index - 1) * 2 + slot.slot_no - 1) % 14) + 1
),
classified AS (
  SELECT source.*,
         CASE
           WHEN slot_no = 1 THEN 'TICKET_ISSUED'
           WHEN day_index % 4 = 0 THEN 'CANCELLED'
           WHEN day_index % 4 = 1 THEN 'PAID'
           WHEN day_index % 4 = 2 THEN 'PENDING_PAYMENT'
           ELSE 'TICKET_ISSUED'
         END AS booking_status
  FROM source
)
SELECT
  pg_temp.seed_uuid('july-ops-booking|' || travel_date || '|' || slot_no) AS booking_id,
  pg_temp.seed_uuid('july-ops-owner|' || travel_date || '|' || slot_no) AS owner_id,
  pg_temp.seed_uuid('july-ops-passenger|' || travel_date || '|' || slot_no) AS passenger_id,
  pg_temp.seed_uuid('july-ops-payment|' || travel_date || '|' || slot_no) AS payment_id,
  pg_temp.seed_uuid('july-ops-ticket|' || travel_date || '|' || slot_no) AS ticket_id,
  pg_temp.seed_uuid('july-ops-booking-event|' || travel_date || '|' || slot_no) AS booking_event_id,
  pg_temp.seed_uuid('july-ops-payment-event|' || travel_date || '|' || slot_no) AS payment_event_id,
  'BV-2026-' || upper(substr(md5('july-ops-code|' || travel_date || '|' || slot_no), 1, 10)) AS booking_code,
  'VT-JUL26-' || to_char(travel_date, 'MMDD') || '-' || slot_no AS ticket_code,
  CASE WHEN slot_no = 1 THEN 'A11' ELSE 'A12' END AS seat_id,
  booking_status,
  booking_status IN ('PAID', 'TICKET_ISSUED', 'CANCELLED') AS is_paid,
  trip_id,
  route_id,
  route_code,
  origin_name,
  destination_name,
  operator_name,
  vehicle_type_name,
  vehicle_code,
  vehicle_plate,
  departure_at,
  arrival_at,
  price_vnd,
  travel_date,
  slot_no,
  ((travel_date + time '04:00') AT TIME ZONE 'Asia/Ho_Chi_Minh') +
    make_interval(mins => slot_no * 10) AS created_at,
  ((travel_date + time '04:20') AT TIME ZONE 'Asia/Ho_Chi_Minh') +
    make_interval(mins => slot_no * 10) AS paid_at
FROM classified;

INSERT INTO booking.bookings (
  id, booking_code, status, checkout_owner_type, checkout_owner_id,
  idempotency_key, request_fingerprint, hold_token, hold_expires_at,
  contact_full_name, contact_email, normalized_email, contact_phone,
  trip_id, route_id, route_code, operator_name, vehicle_type_name,
  vehicle_code, vehicle_plate, origin_name, destination_name, pickup_name,
  dropoff_name, departure_at, arrival_at, timezone, unit_price_vnd,
  seat_count, total_price_vnd, paid_payment_attempt_id,
  payment_idempotency_key, paid_at, expired_at, cancelled_at,
  cancellation_idempotency_key, cancellation_policy_code,
  cancellation_seats_released_at, created_at, updated_at
)
SELECT
  booking_id,
  booking_code,
  booking_status,
  'GUEST_SESSION',
  owner_id,
  'seed-july-ops-booking-' || to_char(travel_date, 'YYYYMMDD') || '-' || slot_no,
  repeat(md5('fingerprint|' || booking_id), 2),
  'seed-july-ops-hold-' || to_char(travel_date, 'YYYYMMDD') || '-' || slot_no,
  departure_at - interval '1 hour',
  'Khách demo ' || to_char(travel_date, 'DD/MM') || '-' || slot_no,
  'july.demo+' || to_char(travel_date, 'YYYYMMDD') || '-' || slot_no || '@example.test',
  'july.demo+' || to_char(travel_date, 'YYYYMMDD') || '-' || slot_no || '@example.test',
  '0908' || to_char(travel_date, 'MMDD') || lpad(slot_no::text, 2, '0'),
  trip_id,
  route_id,
  route_code,
  operator_name,
  vehicle_type_name,
  vehicle_code,
  vehicle_plate,
  origin_name,
  destination_name,
  origin_name,
  destination_name,
  departure_at,
  arrival_at,
  'Asia/Ho_Chi_Minh',
  price_vnd,
  1,
  price_vnd,
  CASE WHEN is_paid THEN payment_id END,
  CASE WHEN is_paid THEN 'seed-july-ops-payment-' || to_char(travel_date, 'YYYYMMDD') || '-' || slot_no END,
  CASE WHEN is_paid THEN paid_at END,
  NULL,
  CASE WHEN booking_status = 'CANCELLED' THEN paid_at + interval '30 minutes' END,
  CASE WHEN booking_status = 'CANCELLED' THEN 'seed-july-ops-cancel-' || to_char(travel_date, 'YYYYMMDD') || '-' || slot_no END,
  CASE WHEN booking_status = 'CANCELLED' THEN 'BEFORE_DEPARTURE_FULL_RELEASE' END,
  CASE WHEN booking_status = 'CANCELLED' THEN paid_at + interval '31 minutes' END,
  created_at,
  GREATEST(created_at, COALESCE(paid_at, created_at))
FROM july_2026_operations_seed
ON CONFLICT (id) DO UPDATE
SET booking_code = EXCLUDED.booking_code,
    status = EXCLUDED.status,
    contact_full_name = EXCLUDED.contact_full_name,
    contact_email = EXCLUDED.contact_email,
    normalized_email = EXCLUDED.normalized_email,
    trip_id = EXCLUDED.trip_id,
    route_id = EXCLUDED.route_id,
    route_code = EXCLUDED.route_code,
    operator_name = EXCLUDED.operator_name,
    vehicle_type_name = EXCLUDED.vehicle_type_name,
    vehicle_code = EXCLUDED.vehicle_code,
    vehicle_plate = EXCLUDED.vehicle_plate,
    origin_name = EXCLUDED.origin_name,
    destination_name = EXCLUDED.destination_name,
    departure_at = EXCLUDED.departure_at,
    arrival_at = EXCLUDED.arrival_at,
    unit_price_vnd = EXCLUDED.unit_price_vnd,
    total_price_vnd = EXCLUDED.total_price_vnd,
    paid_payment_attempt_id = EXCLUDED.paid_payment_attempt_id,
    payment_idempotency_key = EXCLUDED.payment_idempotency_key,
    paid_at = EXCLUDED.paid_at,
    cancelled_at = EXCLUDED.cancelled_at,
    cancellation_idempotency_key = EXCLUDED.cancellation_idempotency_key,
    cancellation_policy_code = EXCLUDED.cancellation_policy_code,
    cancellation_seats_released_at = EXCLUDED.cancellation_seats_released_at,
    updated_at = EXCLUDED.updated_at;

INSERT INTO booking.passengers (id, booking_id, seat_id, full_name, phone, created_at)
SELECT passenger_id, booking_id, seat_id,
       'Hành khách demo ' || to_char(travel_date, 'DD/MM') || '-' || slot_no,
       '0908' || to_char(travel_date, 'MMDD') || lpad(slot_no::text, 2, '0'),
       created_at
FROM july_2026_operations_seed
ON CONFLICT (id) DO UPDATE
SET booking_id = EXCLUDED.booking_id,
    seat_id = EXCLUDED.seat_id,
    full_name = EXCLUDED.full_name,
    phone = EXCLUDED.phone,
    created_at = EXCLUDED.created_at;

DELETE FROM booking.status_history
WHERE booking_id IN (SELECT booking_id FROM july_2026_operations_seed);

INSERT INTO booking.status_history (
  id, booking_id, from_status, to_status, actor_type, actor_id, occurred_at
)
SELECT
  pg_temp.seed_uuid('july-ops-history|' || travel_date || '|' || slot_no),
  booking_id,
  CASE booking_status
    WHEN 'PENDING_PAYMENT' THEN NULL
    WHEN 'CANCELLED' THEN 'PAID'
    WHEN 'PAID' THEN 'PENDING_PAYMENT'
    ELSE 'PAID'
  END,
  booking_status,
  'SYSTEM',
  '00000000-0000-4000-8000-000000000001',
  CASE WHEN booking_status = 'CANCELLED' THEN paid_at + interval '30 minutes' ELSE created_at END
FROM july_2026_operations_seed;

INSERT INTO payment.attempts (
  id, booking_id, owner_type, owner_id, amount_vnd, requested_outcome,
  status, failure_code, idempotency_key, request_fingerprint, created_at
)
SELECT
  payment_id,
  booking_id,
  'GUEST_SESSION',
  owner_id,
  price_vnd,
  CASE WHEN is_paid THEN 'SUCCESS' ELSE 'FAILURE' END,
  CASE WHEN is_paid THEN 'SUCCEEDED' ELSE 'FAILED' END,
  CASE WHEN is_paid THEN NULL ELSE 'SIMULATED_DECLINED' END,
  'seed-july-ops-payment-' || to_char(travel_date, 'YYYYMMDD') || '-' || slot_no,
  repeat(md5('payment-fingerprint|' || booking_id), 2),
  paid_at
FROM july_2026_operations_seed
ON CONFLICT (id) DO UPDATE
SET booking_id = EXCLUDED.booking_id,
    amount_vnd = EXCLUDED.amount_vnd,
    requested_outcome = EXCLUDED.requested_outcome,
    status = EXCLUDED.status,
    failure_code = EXCLUDED.failure_code,
    created_at = EXCLUDED.created_at;

INSERT INTO booking.issued_ticket_refs (
  ticket_id, booking_id, passenger_id, ticket_code, qr_payload_hash, issued_at
)
SELECT
  ticket_id,
  booking_id,
  passenger_id,
  ticket_code,
  repeat(md5(booking_code || '-' || ticket_code), 2),
  paid_at + interval '5 minutes'
FROM july_2026_operations_seed
WHERE booking_status = 'TICKET_ISSUED'
ON CONFLICT (ticket_id) DO UPDATE
SET booking_id = EXCLUDED.booking_id,
    passenger_id = EXCLUDED.passenger_id,
    ticket_code = EXCLUDED.ticket_code,
    qr_payload_hash = EXCLUDED.qr_payload_hash,
    issued_at = EXCLUDED.issued_at;

INSERT INTO ticket.tickets (
  id, booking_id, passenger_id, checkout_owner_type, checkout_owner_id,
  ticket_code, booking_code, passenger_name, seat_id, route_label,
  pickup_name, dropoff_name, departure_at, vehicle_label, qr_payload,
  html_content, pdf_document, issued_at, created_at
)
SELECT
  ticket_id,
  booking_id,
  passenger_id,
  'GUEST_SESSION',
  owner_id,
  ticket_code,
  booking_code,
  'Hành khách demo ' || to_char(travel_date, 'DD/MM') || '-' || slot_no,
  seat_id,
  origin_name || ' → ' || destination_name,
  origin_name,
  destination_name,
  departure_at,
  vehicle_code || ' - ' || vehicle_plate,
  booking_code || '-' || ticket_code,
  '<!doctype html><html lang="vi"><meta charset="utf-8"><title>' || ticket_code ||
    '</title><body><h1>Bến Việt - Vé điện tử demo</h1><p>' || booking_code ||
    '</p><p>' || origin_name || ' → ' || destination_name || '</p><p>Ghế ' || seat_id ||
    '</p></body></html>',
  decode('JVBERi0xLjMK', 'base64'),
  paid_at + interval '5 minutes',
  paid_at + interval '5 minutes'
FROM july_2026_operations_seed
WHERE booking_status = 'TICKET_ISSUED'
ON CONFLICT (id) DO UPDATE
SET ticket_code = EXCLUDED.ticket_code,
    booking_code = EXCLUDED.booking_code,
    route_label = EXCLUDED.route_label,
    departure_at = EXCLUDED.departure_at,
    vehicle_label = EXCLUDED.vehicle_label,
    qr_payload = EXCLUDED.qr_payload,
    html_content = EXCLUDED.html_content,
    issued_at = EXCLUDED.issued_at;

INSERT INTO notification.email_delivery_logs (
  id, booking_id, recipient_email, subject, template_name, status, sent_at, created_at
)
SELECT
  pg_temp.seed_uuid('july-ops-notification|' || travel_date || '|' || slot_no),
  booking_id,
  'july.demo+' || to_char(travel_date, 'YYYYMMDD') || '-' || slot_no || '@example.test',
  'Vé điện tử ' || booking_code,
  'ticket-issued-v1',
  'SENT_SIMULATED',
  paid_at + interval '6 minutes',
  paid_at + interval '6 minutes'
FROM july_2026_operations_seed
WHERE booking_status = 'TICKET_ISSUED'
ON CONFLICT (booking_id) DO UPDATE
SET recipient_email = EXCLUDED.recipient_email,
    subject = EXCLUDED.subject,
    status = EXCLUDED.status,
    sent_at = EXCLUDED.sent_at;

INSERT INTO seat_inventory.trip_seat_states (
  trip_id, seat_id, status, booking_id, reason, updated_by_actor, updated_at
)
SELECT trip_id, seat_id, 'BOOKED', booking_id, NULL, 'seed-july-operations', paid_at
FROM july_2026_operations_seed
WHERE booking_status IN ('PAID', 'TICKET_ISSUED')
ON CONFLICT (trip_id, seat_id) DO UPDATE
SET status = EXCLUDED.status,
    booking_id = EXCLUDED.booking_id,
    reason = EXCLUDED.reason,
    updated_by_actor = EXCLUDED.updated_by_actor,
    updated_at = EXCLUDED.updated_at;

DELETE FROM booking.operational_audit
WHERE id IN (
  SELECT pg_temp.seed_uuid('july-ops-audit|' || travel_date || '|' || slot_no)
  FROM july_2026_operations_seed
);

INSERT INTO booking.operational_audit (
  id, action, target_type, target_id, trip_id, actor_id, actor_role,
  request_id, trace_id, occurred_at
)
SELECT
  pg_temp.seed_uuid('july-ops-audit|' || travel_date || '|' || slot_no),
  CASE WHEN booking_status = 'CANCELLED' THEN 'BOOKING_CANCELLED' ELSE 'BOOKING_PAID' END,
  'BOOKING',
  booking_id,
  trip_id,
  owner_id,
  'GUEST_SESSION',
  'seed-july-ops-request-' || to_char(travel_date, 'YYYYMMDD') || '-' || slot_no,
  'seed-july-ops-trace-' || to_char(travel_date, 'YYYYMMDD') || '-' || slot_no,
  CASE WHEN booking_status = 'CANCELLED' THEN paid_at + interval '30 minutes' ELSE paid_at END
FROM july_2026_operations_seed
WHERE is_paid;

INSERT INTO booking.outbox_events (
  id, event_id, destination, channel_name, message_key, event_type,
  event_version, aggregate_id, payload, headers, occurred_at
)
SELECT
  pg_temp.seed_uuid('july-ops-booking-outbox|' || travel_date || '|' || slot_no),
  booking_event_id,
  'KAFKA',
  'booking-events',
  booking_id::text,
  'BookingPaidV1',
  1,
  booking_id,
  jsonb_build_object(
    'eventId', booking_event_id,
    'eventType', 'BookingPaidV1',
    'eventVersion', 1,
    'occurredAt', paid_at,
    'traceId', 'seed-july-ops-trace-' || to_char(travel_date, 'YYYYMMDD') || '-' || slot_no,
    'requestId', 'seed-july-ops-request-' || to_char(travel_date, 'YYYYMMDD') || '-' || slot_no,
    'aggregateId', booking_id,
    'actorCategory', 'GUEST',
    'checkoutSessionId', owner_id,
    'producer', 'booking-service',
    'payload', jsonb_build_object(
      'bookingId', booking_id,
      'tripId', trip_id,
      'routeId', route_id,
      'routeCode', route_code,
      'seatIds', jsonb_build_array(seat_id),
      'passengerCount', 1,
      'totalPriceVnd', price_vnd,
      'paymentAttemptId', payment_id,
      'paidAt', paid_at,
      'status', 'PAID'
    )
  ),
  jsonb_build_object(
    'eventType', 'BookingPaidV1',
    'eventVersion', '1',
    'traceId', 'seed-july-ops-trace-' || to_char(travel_date, 'YYYYMMDD') || '-' || slot_no,
    'requestId', 'seed-july-ops-request-' || to_char(travel_date, 'YYYYMMDD') || '-' || slot_no
  ),
  paid_at
FROM july_2026_operations_seed
WHERE is_paid
ON CONFLICT ON CONSTRAINT booking_outbox_event_destination_key DO NOTHING;

INSERT INTO payment.outbox_events (
  id, event_id, destination, channel_name, message_key, event_type,
  event_version, aggregate_id, payload, headers, occurred_at
)
SELECT
  pg_temp.seed_uuid('july-ops-payment-outbox|' || travel_date || '|' || slot_no),
  payment_event_id,
  'KAFKA',
  'payment-events',
  booking_id::text,
  'PaymentAttemptedV1',
  1,
  booking_id,
  jsonb_strip_nulls(jsonb_build_object(
    'eventId', payment_event_id,
    'eventType', 'PaymentAttemptedV1',
    'eventVersion', 1,
    'occurredAt', paid_at,
    'traceId', 'seed-july-payment-trace-' || to_char(travel_date, 'YYYYMMDD') || '-' || slot_no,
    'requestId', 'seed-july-payment-request-' || to_char(travel_date, 'YYYYMMDD') || '-' || slot_no,
    'aggregateId', booking_id,
    'actorCategory', 'GUEST',
    'checkoutSessionId', owner_id,
    'producer', 'payment-service',
    'payload', jsonb_strip_nulls(jsonb_build_object(
      'paymentAttemptId', payment_id,
      'bookingId', booking_id,
      'requestedOutcome', CASE WHEN is_paid THEN 'SUCCESS' ELSE 'FAILURE' END,
      'status', CASE WHEN is_paid THEN 'SUCCEEDED' ELSE 'FAILED' END,
      'amountVnd', price_vnd,
      'failureCode', CASE WHEN is_paid THEN NULL ELSE 'SIMULATED_DECLINED' END
    ))
  )),
  jsonb_build_object(
    'eventType', 'PaymentAttemptedV1',
    'eventVersion', '1',
    'traceId', 'seed-july-payment-trace-' || to_char(travel_date, 'YYYYMMDD') || '-' || slot_no,
    'requestId', 'seed-july-payment-request-' || to_char(travel_date, 'YYYYMMDD') || '-' || slot_no
  ),
  paid_at
FROM july_2026_operations_seed
ON CONFLICT ON CONSTRAINT payment_outbox_event_destination_key DO NOTHING;

CREATE TEMP TABLE july_2026_search_seed ON COMMIT DROP AS
SELECT
  pg_temp.seed_uuid('july-search-event|' || day_value::date || '|' || route.id || '|' || attempt_no) AS event_id,
  pg_temp.seed_uuid('july-search-session|' || day_value::date || '|' || route.id || '|' || attempt_no) AS search_session_id,
  route.id AS route_id,
  route.code AS route_code,
  route.origin_location_id,
  route.destination_location_id,
  origin.name AS origin_name,
  destination.name AS destination_name,
  day_value::date AS travel_date,
  attempt_no,
  ((day_value::date + time '03:00') AT TIME ZONE 'Asia/Ho_Chi_Minh') +
    make_interval(mins => attempt_no * 5) AS occurred_at,
  (
    SELECT count(*)::integer
    FROM catalog.trips trip
    WHERE trip.route_id = route.id
      AND (trip.departure_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = day_value::date
      AND trip.is_active
  ) AS result_count
FROM generate_series('2026-07-18'::date, '2026-07-30'::date, interval '1 day') day_value
CROSS JOIN catalog.routes route
CROSS JOIN (VALUES (1), (2)) attempt(attempt_no)
JOIN catalog.locations origin ON origin.id = route.origin_location_id
JOIN catalog.locations destination ON destination.id = route.destination_location_id
WHERE route.code IN (
  'HCM-DLI', 'DLI-HCM', 'HCM-NTR', 'NTR-HCM', 'HCM-CTO',
  'CTO-HCM', 'DAD-HAN', 'HAN-DAD', 'DLI-NTR', 'NTR-DLI'
);

INSERT INTO catalog.search_outbox_events (
  id, event_id, channel_name, message_key, event_type, event_version,
  payload, headers, occurred_at
)
SELECT
  pg_temp.seed_uuid('july-search-outbox|' || event_id),
  event_id,
  'search-events',
  search_session_id,
  'SearchPerformedV2',
  2,
  jsonb_build_object(
    'eventId', event_id,
    'eventType', 'SearchPerformedV2',
    'eventVersion', 2,
    'occurredAt', occurred_at,
    'traceId', 'seed-july-search-trace-' || event_id,
    'producer', 'catalog-service',
    'searchSessionId', search_session_id,
    'actorCategory', 'GUEST',
    'payload', jsonb_build_object(
      'originLocationId', origin_location_id,
      'destinationLocationId', destination_location_id,
      'travelDate', travel_date,
      'operatorCodes', jsonb_build_array(),
      'vehicleTypeCodes', jsonb_build_array(),
      'sort', 'DEPARTURE_EARLIEST',
      'resultCount', result_count,
      'nearestDateCount', 0,
      'cacheStatus', CASE WHEN attempt_no = 1 THEN 'MISS' ELSE 'HIT' END,
      'matchedRoutes', jsonb_build_array(jsonb_build_object(
        'routeId', route_id,
        'originName', origin_name,
        'destinationName', destination_name
      ))
    )
  ),
  jsonb_build_object(
    'eventType', 'SearchPerformedV2',
    'eventVersion', '2',
    'traceId', 'seed-july-search-trace-' || event_id
  ),
  occurred_at
FROM july_2026_search_seed
ON CONFLICT (event_id) DO NOTHING;

COMMIT;
