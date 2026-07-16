BEGIN;

CREATE SCHEMA IF NOT EXISTS ticket;

CREATE TABLE IF NOT EXISTS ticket.inbox_events (
  event_id uuid PRIMARY KEY,
  event_type text NOT NULL,
  booking_id uuid NOT NULL,
  trace_id text NOT NULL,
  request_id text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  fulfilled_at timestamptz,
  last_error_code text
);

CREATE TABLE IF NOT EXISTS ticket.tickets (
  id uuid PRIMARY KEY,
  booking_id uuid NOT NULL,
  passenger_id uuid NOT NULL,
  checkout_owner_type text NOT NULL CHECK (checkout_owner_type IN ('GUEST_SESSION', 'CUSTOMER')),
  checkout_owner_id uuid NOT NULL,
  ticket_code text NOT NULL UNIQUE,
  booking_code text NOT NULL,
  passenger_name text NOT NULL,
  seat_id text NOT NULL,
  route_label text NOT NULL,
  pickup_name text NOT NULL,
  dropoff_name text NOT NULL,
  departure_at timestamptz NOT NULL,
  vehicle_label text NOT NULL,
  qr_payload text NOT NULL,
  html_content text NOT NULL,
  pdf_document bytea NOT NULL,
  issued_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ticket_booking_passenger_key UNIQUE (booking_id, passenger_id)
);

CREATE INDEX IF NOT EXISTS ticket_booking_owner_idx
ON ticket.tickets (booking_id, checkout_owner_type, checkout_owner_id, seat_id);

INSERT INTO platform.schema_migrations (version)
VALUES ('012_ticket_worker')
ON CONFLICT (version) DO NOTHING;

COMMIT;
