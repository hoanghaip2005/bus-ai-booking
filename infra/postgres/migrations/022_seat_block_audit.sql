BEGIN;

CREATE TABLE seat_inventory.seat_block_commands (
  id uuid PRIMARY KEY,
  actor_id uuid NOT NULL,
  actor_role text NOT NULL CHECK (actor_role = 'ADMIN'),
  idempotency_key text NOT NULL,
  request_fingerprint char(64) NOT NULL,
  trip_id uuid NOT NULL,
  seat_ids text[] NOT NULL,
  blocked boolean NOT NULL,
  reason text NOT NULL,
  changed boolean NOT NULL,
  request_id text NOT NULL,
  trace_id text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (actor_id, idempotency_key)
);

CREATE INDEX seat_block_commands_trip_time_idx
ON seat_inventory.seat_block_commands (trip_id, updated_at DESC);

INSERT INTO platform.schema_migrations (version)
VALUES ('022_seat_block_audit')
ON CONFLICT (version) DO NOTHING;

COMMIT;
