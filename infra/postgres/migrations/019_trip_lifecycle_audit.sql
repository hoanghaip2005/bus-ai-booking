BEGIN;

CREATE TABLE catalog.trip_lifecycle_audit (
  id uuid PRIMARY KEY,
  trip_id uuid NOT NULL REFERENCES catalog.trips (id),
  from_status text NOT NULL,
  to_status text NOT NULL,
  actor_id uuid NOT NULL,
  actor_role text NOT NULL CHECK (actor_role = 'ADMIN'),
  idempotency_key text NOT NULL,
  request_id text NOT NULL,
  trace_id text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (actor_id, idempotency_key)
);

CREATE INDEX trip_lifecycle_audit_trip_time_idx
ON catalog.trip_lifecycle_audit (trip_id, occurred_at DESC);

INSERT INTO platform.schema_migrations (version)
VALUES ('019_trip_lifecycle_audit')
ON CONFLICT (version) DO NOTHING;

COMMIT;
