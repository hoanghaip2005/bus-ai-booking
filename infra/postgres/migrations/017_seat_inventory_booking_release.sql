BEGIN;

CREATE TABLE IF NOT EXISTS seat_inventory.release_requests (
  booking_id uuid PRIMARY KEY,
  idempotency_key text NOT NULL,
  request_fingerprint char(64) NOT NULL,
  trip_id uuid NOT NULL,
  seat_ids text[] NOT NULL,
  released_at timestamptz NOT NULL,
  CONSTRAINT seat_release_idempotency_key_format
    CHECK (idempotency_key ~ '^[A-Za-z0-9._-]{16,128}$'),
  CONSTRAINT seat_release_seat_count CHECK (cardinality(seat_ids) BETWEEN 1 AND 10)
);

INSERT INTO platform.schema_migrations (version)
VALUES ('017_seat_inventory_booking_release')
ON CONFLICT (version) DO NOTHING;

COMMIT;
