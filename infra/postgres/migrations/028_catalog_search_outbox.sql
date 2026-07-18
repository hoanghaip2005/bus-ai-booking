BEGIN;

CREATE TABLE catalog.search_outbox_events (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL UNIQUE,
  channel_name text NOT NULL CHECK (channel_name = 'search-events'),
  message_key uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('SearchPerformedV1', 'SearchPerformedV2')),
  event_version integer NOT NULL CHECK (event_version IN (1, 2)),
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
  CHECK (published_at IS NULL OR dead_lettered_at IS NULL)
);

CREATE INDEX catalog_search_outbox_dispatch_idx
ON catalog.search_outbox_events (available_at, occurred_at)
WHERE published_at IS NULL AND dead_lettered_at IS NULL;

INSERT INTO platform.schema_migrations (version)
VALUES ('028_catalog_search_outbox')
ON CONFLICT (version) DO NOTHING;

COMMIT;
