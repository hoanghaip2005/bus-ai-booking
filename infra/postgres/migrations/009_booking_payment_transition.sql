BEGIN;

ALTER TABLE booking.bookings
ADD COLUMN IF NOT EXISTS paid_payment_attempt_id uuid,
ADD COLUMN IF NOT EXISTS payment_idempotency_key text,
ADD COLUMN IF NOT EXISTS paid_at timestamptz,
ADD COLUMN IF NOT EXISTS expired_at timestamptz;

CREATE INDEX IF NOT EXISTS bookings_paid_payment_attempt_idx
ON booking.bookings (paid_payment_attempt_id)
WHERE paid_payment_attempt_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'bookings_paid_fields_check'
      AND conrelid = 'booking.bookings'::regclass
  ) THEN
    ALTER TABLE booking.bookings
    ADD CONSTRAINT bookings_paid_fields_check CHECK (
      status NOT IN ('PAID', 'TICKET_ISSUED', 'CHECKED_IN', 'COMPLETED')
      OR (
        paid_payment_attempt_id IS NOT NULL
        AND payment_idempotency_key IS NOT NULL
        AND paid_at IS NOT NULL
      )
    );
  END IF;
END $$;

INSERT INTO platform.schema_migrations (version)
VALUES ('009_booking_payment_transition')
ON CONFLICT (version) DO NOTHING;

COMMIT;
