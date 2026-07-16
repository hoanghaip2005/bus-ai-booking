BEGIN;

CREATE TABLE catalog.admin_audit (
  id uuid PRIMARY KEY,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  actor_role text NOT NULL CHECK (actor_role = 'ADMIN'),
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL,
  request_id text NOT NULL,
  trace_id text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (actor_id, idempotency_key)
);

CREATE INDEX catalog_admin_audit_target_time_idx
ON catalog.admin_audit (target_type, target_id, occurred_at DESC);

INSERT INTO platform.schema_migrations (version)
VALUES ('023_catalog_admin_audit')
ON CONFLICT (version) DO NOTHING;

COMMIT;
