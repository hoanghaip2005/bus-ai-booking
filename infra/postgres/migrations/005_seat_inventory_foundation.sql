BEGIN;

CREATE SCHEMA IF NOT EXISTS seat_inventory;

CREATE TABLE IF NOT EXISTS seat_inventory.trip_seat_states (
  trip_id uuid NOT NULL,
  seat_id text NOT NULL CHECK (seat_id ~ '^[A-Z][0-9]{2}$'),
  status text NOT NULL CHECK (status IN ('BOOKED', 'BLOCKED')),
  booking_id uuid,
  reason text,
  updated_by_actor text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (trip_id, seat_id),
  CHECK (
    (status = 'BOOKED' AND booking_id IS NOT NULL)
    OR (status = 'BLOCKED' AND booking_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS trip_seat_states_booking_idx
ON seat_inventory.trip_seat_states (booking_id)
WHERE booking_id IS NOT NULL;

INSERT INTO platform.schema_migrations (version)
VALUES ('005_seat_inventory_foundation')
ON CONFLICT (version) DO NOTHING;

COMMIT;
