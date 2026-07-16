BEGIN;

CREATE SCHEMA IF NOT EXISTS platform;
CREATE SCHEMA IF NOT EXISTS catalog;

CREATE TABLE IF NOT EXISTS platform.schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS catalog.locations (
  id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  normalized_name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('CITY', 'STATION')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO platform.schema_migrations (version)
VALUES ('001_foundation')
ON CONFLICT (version) DO NOTHING;

COMMIT;

