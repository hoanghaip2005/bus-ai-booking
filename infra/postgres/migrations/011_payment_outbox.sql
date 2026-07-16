BEGIN;

CREATE TABLE IF NOT EXISTS payment.outbox_events (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL,
  destination text NOT NULL CHECK (destination = 'KAFKA'),
  channel_name text NOT NULL CHECK (length(channel_name) BETWEEN 1 AND 128),
  message_key text NOT NULL CHECK (length(message_key) BETWEEN 1 AND 256),
  event_type text NOT NULL CHECK (event_type ~ '^[A-Za-z0-9]+V[0-9]+$'),
  event_version integer NOT NULL CHECK (event_version > 0),
  aggregate_id uuid NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  headers jsonb NOT NULL CHECK (jsonb_typeof(headers) = 'object'),
  occurred_at timestamptz NOT NULL,
  available_at timestamptz NOT NULL DEFAULT now(),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  locked_at timestamptz,
  lock_owner uuid,
  published_at timestamptz,
  dead_lettered_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_outbox_event_destination_key UNIQUE (event_id, destination),
  CHECK (published_at IS NULL OR dead_lettered_at IS NULL)
);

CREATE INDEX IF NOT EXISTS payment_outbox_dispatch_idx
ON payment.outbox_events (available_at, occurred_at)
WHERE published_at IS NULL AND dead_lettered_at IS NULL;

CREATE INDEX IF NOT EXISTS payment_outbox_aggregate_idx
ON payment.outbox_events (aggregate_id, occurred_at);

INSERT INTO platform.schema_migrations (version)
VALUES ('011_payment_outbox')
ON CONFLICT (version) DO NOTHING;

COMMIT;
