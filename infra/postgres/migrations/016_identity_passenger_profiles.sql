BEGIN;

CREATE TABLE IF NOT EXISTS identity.passenger_profiles (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  label text NOT NULL,
  full_name text NOT NULL,
  phone text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT passenger_profiles_label_length CHECK (char_length(label) BETWEEN 1 AND 40),
  CONSTRAINT passenger_profiles_name_length CHECK (char_length(full_name) BETWEEN 2 AND 100)
);

CREATE UNIQUE INDEX IF NOT EXISTS identity_passenger_profiles_user_label_key
ON identity.passenger_profiles (user_id, lower(label));

CREATE INDEX IF NOT EXISTS identity_passenger_profiles_user_updated_idx
ON identity.passenger_profiles (user_id, updated_at DESC, id);

INSERT INTO platform.schema_migrations (version)
VALUES ('016_identity_passenger_profiles')
ON CONFLICT (version) DO NOTHING;

COMMIT;
