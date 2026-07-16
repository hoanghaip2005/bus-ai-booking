BEGIN;

CREATE TABLE IF NOT EXISTS catalog.seat_layout_versions (
  id uuid PRIMARY KEY,
  vehicle_type_id uuid NOT NULL REFERENCES catalog.vehicle_types (id),
  version integer NOT NULL CHECK (version > 0),
  name text NOT NULL,
  deck_count smallint NOT NULL CHECK (deck_count > 0),
  layout jsonb NOT NULL CHECK (jsonb_typeof(layout) = 'object'),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vehicle_type_id, version)
);

ALTER TABLE catalog.vehicles
ADD COLUMN IF NOT EXISTS seat_layout_version_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'vehicles_seat_layout_version_fk'
      AND conrelid = 'catalog.vehicles'::regclass
  ) THEN
    ALTER TABLE catalog.vehicles
    ADD CONSTRAINT vehicles_seat_layout_version_fk
    FOREIGN KEY (seat_layout_version_id) REFERENCES catalog.seat_layout_versions (id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS seat_layout_versions_active_vehicle_type_idx
ON catalog.seat_layout_versions (vehicle_type_id, version DESC)
WHERE is_active;

INSERT INTO platform.schema_migrations (version)
VALUES ('004_trip_detail_and_seat_layout')
ON CONFLICT (version) DO NOTHING;

COMMIT;
