BEGIN;

CREATE TABLE booking.operational_audit (
  id uuid PRIMARY KEY,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id uuid NOT NULL,
  trip_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  actor_role text NOT NULL CHECK (actor_role IN ('GUEST_SESSION', 'CUSTOMER', 'STAFF', 'ADMIN', 'SYSTEM')),
  request_id text NOT NULL,
  trace_id text NOT NULL,
  occurred_at timestamptz NOT NULL
);

CREATE INDEX booking_operational_audit_trip_time_idx
ON booking.operational_audit (trip_id, occurred_at DESC, id DESC);

CREATE INDEX booking_operational_audit_time_idx
ON booking.operational_audit (occurred_at DESC, id DESC);

INSERT INTO platform.schema_migrations (version)
VALUES ('024_booking_operational_audit')
ON CONFLICT (version) DO NOTHING;

COMMIT;
