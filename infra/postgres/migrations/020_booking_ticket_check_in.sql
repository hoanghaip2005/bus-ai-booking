BEGIN;

CREATE TABLE booking.issued_ticket_refs (
  ticket_id uuid PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES booking.bookings (id) ON DELETE CASCADE,
  passenger_id uuid NOT NULL REFERENCES booking.passengers (id) ON DELETE CASCADE,
  ticket_code text NOT NULL UNIQUE,
  qr_payload_hash char(64) NOT NULL UNIQUE,
  issued_at timestamptz NOT NULL,
  UNIQUE (booking_id, passenger_id)
);

CREATE TABLE booking.ticket_check_ins (
  ticket_id uuid PRIMARY KEY REFERENCES booking.issued_ticket_refs (ticket_id) ON DELETE CASCADE,
  booking_id uuid NOT NULL REFERENCES booking.bookings (id) ON DELETE CASCADE,
  passenger_id uuid NOT NULL REFERENCES booking.passengers (id) ON DELETE CASCADE,
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9._-]{16,128}$'),
  actor_id uuid NOT NULL,
  actor_role text NOT NULL CHECK (actor_role IN ('STAFF', 'ADMIN')),
  request_id text NOT NULL,
  trace_id text NOT NULL,
  checked_in_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (actor_id, idempotency_key)
);

CREATE INDEX booking_ticket_refs_booking_idx
ON booking.issued_ticket_refs (booking_id, passenger_id);

CREATE INDEX booking_ticket_check_ins_booking_idx
ON booking.ticket_check_ins (booking_id, checked_in_at);

INSERT INTO platform.schema_migrations (version)
VALUES ('020_booking_ticket_check_in')
ON CONFLICT (version) DO NOTHING;

COMMIT;
