BEGIN;

CREATE TABLE IF NOT EXISTS seat_inventory.confirmation_requests (
  booking_id uuid NOT NULL,
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9._-]{16,128}$'),
  request_fingerprint char(64) NOT NULL,
  hold_token_hash char(64) NOT NULL,
  trip_id uuid NOT NULL,
  seat_ids text[] NOT NULL CHECK (cardinality(seat_ids) BETWEEN 1 AND 10),
  confirmed_at timestamptz NOT NULL,
  PRIMARY KEY (booking_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS confirmation_requests_trip_idx
ON seat_inventory.confirmation_requests (trip_id, confirmed_at DESC);

INSERT INTO platform.schema_migrations (version)
VALUES ('007_seat_confirmation')
ON CONFLICT (version) DO NOTHING;

COMMIT;
