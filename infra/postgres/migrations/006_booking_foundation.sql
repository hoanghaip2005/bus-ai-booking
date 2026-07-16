BEGIN;

CREATE SCHEMA IF NOT EXISTS booking;

CREATE TABLE IF NOT EXISTS booking.bookings (
  id uuid PRIMARY KEY,
  booking_code text NOT NULL,
  status text NOT NULL CHECK (
    status IN (
      'DRAFT',
      'PENDING_PAYMENT',
      'PAID',
      'TICKET_ISSUED',
      'CHECKED_IN',
      'COMPLETED',
      'EXPIRED',
      'CANCELLED'
    )
  ),
  checkout_owner_type text NOT NULL CHECK (checkout_owner_type IN ('GUEST_SESSION', 'CUSTOMER')),
  checkout_owner_id uuid NOT NULL,
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9._-]{16,128}$'),
  request_fingerprint char(64) NOT NULL,
  hold_token text NOT NULL CHECK (length(hold_token) BETWEEN 16 AND 256),
  hold_expires_at timestamptz NOT NULL,
  contact_full_name text NOT NULL,
  contact_email text NOT NULL,
  normalized_email text NOT NULL,
  contact_phone text NOT NULL,
  trip_id uuid NOT NULL,
  route_id uuid NOT NULL,
  route_code text NOT NULL,
  operator_name text NOT NULL,
  vehicle_type_name text NOT NULL,
  vehicle_code text NOT NULL,
  vehicle_plate text NOT NULL,
  origin_name text NOT NULL,
  destination_name text NOT NULL,
  pickup_name text NOT NULL,
  dropoff_name text NOT NULL,
  departure_at timestamptz NOT NULL,
  arrival_at timestamptz NOT NULL,
  timezone text NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  unit_price_vnd integer NOT NULL CHECK (unit_price_vnd >= 0),
  seat_count integer NOT NULL CHECK (seat_count BETWEEN 1 AND 10),
  total_price_vnd integer NOT NULL CHECK (total_price_vnd >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bookings_booking_code_key UNIQUE (booking_code),
  CONSTRAINT bookings_owner_idempotency_key UNIQUE (
    checkout_owner_type,
    checkout_owner_id,
    idempotency_key
  ),
  CHECK (total_price_vnd = unit_price_vnd * seat_count)
);

CREATE INDEX IF NOT EXISTS bookings_guest_lookup_idx
ON booking.bookings (booking_code, normalized_email);

CREATE INDEX IF NOT EXISTS bookings_trip_status_idx
ON booking.bookings (trip_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS booking.passengers (
  id uuid PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES booking.bookings(id) ON DELETE CASCADE,
  seat_id text NOT NULL CHECK (seat_id ~ '^[A-Za-z0-9._-]{1,64}$'),
  full_name text NOT NULL,
  phone text,
  document_number_hash char(64),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_passengers_seat_key UNIQUE (booking_id, seat_id)
);

CREATE TABLE IF NOT EXISTS booking.status_history (
  id uuid PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES booking.bookings(id) ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL,
  actor_type text NOT NULL,
  actor_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_status IS NULL OR from_status <> to_status)
);

CREATE INDEX IF NOT EXISTS booking_status_history_booking_idx
ON booking.status_history (booking_id, occurred_at);

INSERT INTO platform.schema_migrations (version)
VALUES ('006_booking_foundation')
ON CONFLICT (version) DO NOTHING;

COMMIT;
