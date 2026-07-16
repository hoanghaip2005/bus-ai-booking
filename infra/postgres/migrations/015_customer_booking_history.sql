BEGIN;

CREATE INDEX IF NOT EXISTS booking_customer_history_idx
ON booking.bookings (checkout_owner_id, created_at DESC, id DESC)
WHERE checkout_owner_type = 'CUSTOMER';

INSERT INTO platform.schema_migrations (version)
VALUES ('015_customer_booking_history')
ON CONFLICT (version) DO NOTHING;

COMMIT;
