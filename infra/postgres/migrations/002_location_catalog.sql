BEGIN;

ALTER TABLE catalog.locations
ADD COLUMN IF NOT EXISTS parent_location_id uuid REFERENCES catalog.locations (id);

CREATE TABLE IF NOT EXISTS catalog.location_aliases (
  location_id uuid NOT NULL REFERENCES catalog.locations (id) ON DELETE CASCADE,
  alias text NOT NULL,
  normalized_alias text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (location_id, normalized_alias)
);

CREATE INDEX IF NOT EXISTS locations_normalized_name_prefix_idx
ON catalog.locations (normalized_name text_pattern_ops)
WHERE is_active;

CREATE INDEX IF NOT EXISTS locations_code_prefix_idx
ON catalog.locations ((lower(code)) text_pattern_ops)
WHERE is_active;

CREATE INDEX IF NOT EXISTS location_aliases_normalized_prefix_idx
ON catalog.location_aliases (normalized_alias text_pattern_ops);

INSERT INTO platform.schema_migrations (version)
VALUES ('002_location_catalog')
ON CONFLICT (version) DO NOTHING;

COMMIT;
