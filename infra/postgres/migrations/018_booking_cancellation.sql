BEGIN;

ALTER TABLE booking.bookings
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancellation_idempotency_key text,
  ADD COLUMN IF NOT EXISTS cancellation_policy_code text,
  ADD COLUMN IF NOT EXISTS cancellation_seats_released_at timestamptz;

ALTER TABLE booking.bookings
  DROP CONSTRAINT IF EXISTS bookings_cancellation_fields_check;

ALTER TABLE booking.bookings
  ADD CONSTRAINT bookings_cancellation_fields_check CHECK (
    (status <> 'CANCELLED' AND cancelled_at IS NULL
      AND cancellation_idempotency_key IS NULL
      AND cancellation_policy_code IS NULL)
    OR
    (status = 'CANCELLED' AND cancelled_at IS NOT NULL
      AND cancellation_idempotency_key ~ '^[A-Za-z0-9._-]{16,128}$'
      AND cancellation_policy_code = 'BEFORE_DEPARTURE_FULL_RELEASE')
  );

CREATE INDEX IF NOT EXISTS booking_cancellation_release_pending_idx
ON booking.bookings (cancelled_at, id)
WHERE status = 'CANCELLED' AND cancellation_seats_released_at IS NULL;

INSERT INTO platform.schema_migrations (version)
VALUES ('018_booking_cancellation')
ON CONFLICT (version) DO NOTHING;

COMMIT;
