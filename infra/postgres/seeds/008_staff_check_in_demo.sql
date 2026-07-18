BEGIN;

DELETE FROM booking.ticket_check_ins
WHERE ticket_id = '00000000-0000-4000-8000-000000001103';

DELETE FROM booking.operational_audit
WHERE target_id IN (
  '00000000-0000-4000-8000-000000001101',
  '00000000-0000-4000-8000-000000001103'
);

INSERT INTO booking.bookings (
  id,
  booking_code,
  status,
  checkout_owner_type,
  checkout_owner_id,
  idempotency_key,
  request_fingerprint,
  hold_token,
  hold_expires_at,
  contact_full_name,
  contact_email,
  normalized_email,
  contact_phone,
  trip_id,
  route_id,
  route_code,
  operator_name,
  vehicle_type_name,
  vehicle_code,
  vehicle_plate,
  origin_name,
  destination_name,
  pickup_name,
  dropoff_name,
  departure_at,
  arrival_at,
  timezone,
  unit_price_vnd,
  seat_count,
  total_price_vnd,
  paid_payment_attempt_id,
  payment_idempotency_key,
  paid_at,
  created_at,
  updated_at
)
VALUES (
  '00000000-0000-4000-8000-000000001101',
  'BV-STAFF-DEMO-01',
  'TICKET_ISSUED',
  'GUEST_SESSION',
  '00000000-0000-4000-8000-000000001104',
  'seed-staff-demo-booking-01',
  '1111111111111111111111111111111111111111111111111111111111111111',
  'staff-demo-hold-token-0001',
  '2030-06-20 06:55:00+07',
  'Staff Seed Contact',
  'staff.seed@example.test',
  'staff.seed@example.test',
  '0900000001',
  '00000000-0000-4000-8000-000000000701',
  '00000000-0000-4000-8000-000000000501',
  'HCM-DLI',
  'Phuong Trang Demo',
  'Sleeper 34',
  'PT-S34-01',
  '51B-120.01',
  'TP.HCM',
  'Da Lat',
  'Ben xe Mien Dong',
  'Ben xe Lien tinh Da Lat',
  '2030-06-20 07:00:00+07',
  '2030-06-20 14:00:00+07',
  'Asia/Ho_Chi_Minh',
  280000,
  1,
  280000,
  '00000000-0000-4000-8000-000000001105',
  'seed-staff-demo-payment-01',
  '2030-06-20 06:50:00+07',
  '2030-06-20 06:45:00+07',
  '2030-06-20 06:52:00+07'
)
ON CONFLICT (id) DO UPDATE
SET booking_code = EXCLUDED.booking_code,
    status = EXCLUDED.status,
    checkout_owner_type = EXCLUDED.checkout_owner_type,
    checkout_owner_id = EXCLUDED.checkout_owner_id,
    idempotency_key = EXCLUDED.idempotency_key,
    request_fingerprint = EXCLUDED.request_fingerprint,
    hold_token = EXCLUDED.hold_token,
    hold_expires_at = EXCLUDED.hold_expires_at,
    contact_full_name = EXCLUDED.contact_full_name,
    contact_email = EXCLUDED.contact_email,
    normalized_email = EXCLUDED.normalized_email,
    contact_phone = EXCLUDED.contact_phone,
    trip_id = EXCLUDED.trip_id,
    route_id = EXCLUDED.route_id,
    route_code = EXCLUDED.route_code,
    operator_name = EXCLUDED.operator_name,
    vehicle_type_name = EXCLUDED.vehicle_type_name,
    vehicle_code = EXCLUDED.vehicle_code,
    vehicle_plate = EXCLUDED.vehicle_plate,
    origin_name = EXCLUDED.origin_name,
    destination_name = EXCLUDED.destination_name,
    pickup_name = EXCLUDED.pickup_name,
    dropoff_name = EXCLUDED.dropoff_name,
    departure_at = EXCLUDED.departure_at,
    arrival_at = EXCLUDED.arrival_at,
    timezone = EXCLUDED.timezone,
    unit_price_vnd = EXCLUDED.unit_price_vnd,
    seat_count = EXCLUDED.seat_count,
    total_price_vnd = EXCLUDED.total_price_vnd,
    paid_payment_attempt_id = EXCLUDED.paid_payment_attempt_id,
    payment_idempotency_key = EXCLUDED.payment_idempotency_key,
    paid_at = EXCLUDED.paid_at,
    created_at = EXCLUDED.created_at,
    updated_at = EXCLUDED.updated_at;

INSERT INTO booking.passengers (
  id,
  booking_id,
  seat_id,
  full_name,
  phone,
  created_at
)
VALUES (
  '00000000-0000-4000-8000-000000001102',
  '00000000-0000-4000-8000-000000001101',
  'A03',
  'Staff Seed Passenger',
  '0900000001',
  '2030-06-20 06:45:00+07'
)
ON CONFLICT (id) DO UPDATE
SET booking_id = EXCLUDED.booking_id,
    seat_id = EXCLUDED.seat_id,
    full_name = EXCLUDED.full_name,
    phone = EXCLUDED.phone,
    created_at = EXCLUDED.created_at;

DELETE FROM booking.status_history
WHERE booking_id = '00000000-0000-4000-8000-000000001101';

INSERT INTO booking.status_history (
  id,
  booking_id,
  from_status,
  to_status,
  actor_type,
  actor_id,
  occurred_at
)
VALUES (
  '00000000-0000-4000-8000-000000001106',
  '00000000-0000-4000-8000-000000001101',
  'PAID',
  'TICKET_ISSUED',
  'SYSTEM',
  '00000000-0000-4000-8000-000000000001',
  '2030-06-20 06:52:00+07'
);

INSERT INTO booking.issued_ticket_refs (
  ticket_id,
  booking_id,
  passenger_id,
  ticket_code,
  qr_payload_hash,
  issued_at
)
VALUES (
  '00000000-0000-4000-8000-000000001103',
  '00000000-0000-4000-8000-000000001101',
  '00000000-0000-4000-8000-000000001102',
  'VT-DEMO-STAFF-01',
  '714e78cf7bcf86bebf5767f620ae68250e8e2767a0be5b3f52134d6dcb737c8a',
  '2030-06-20 06:52:00+07'
)
ON CONFLICT (ticket_id) DO UPDATE
SET booking_id = EXCLUDED.booking_id,
    passenger_id = EXCLUDED.passenger_id,
    ticket_code = EXCLUDED.ticket_code,
    qr_payload_hash = EXCLUDED.qr_payload_hash,
    issued_at = EXCLUDED.issued_at;

INSERT INTO seat_inventory.trip_seat_states (
  trip_id,
  seat_id,
  status,
  booking_id,
  reason,
  updated_by_actor,
  updated_at
)
VALUES (
  '00000000-0000-4000-8000-000000000701',
  'A03',
  'BOOKED',
  '00000000-0000-4000-8000-000000001101',
  NULL,
  'seed-staff-check-in-demo',
  '2030-06-20 06:50:00+07'
)
ON CONFLICT (trip_id, seat_id) DO UPDATE
SET status = EXCLUDED.status,
    booking_id = EXCLUDED.booking_id,
    reason = EXCLUDED.reason,
    updated_by_actor = EXCLUDED.updated_by_actor,
    updated_at = EXCLUDED.updated_at;

COMMIT;
