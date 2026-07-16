BEGIN;

CREATE SCHEMA IF NOT EXISTS identity;

CREATE TABLE IF NOT EXISTS identity.users (
  id uuid PRIMARY KEY,
  email text NOT NULL,
  normalized_email text NOT NULL UNIQUE,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('CUSTOMER', 'STAFF', 'ADMIN')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS identity.refresh_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  family_id uuid NOT NULL,
  token_hash char(64) NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  rotated_to_session_id uuid REFERENCES identity.refresh_sessions(id),
  created_at timestamptz NOT NULL,
  last_used_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS identity_refresh_token_hash_key
ON identity.refresh_sessions (token_hash);

CREATE INDEX IF NOT EXISTS identity_refresh_user_active_idx
ON identity.refresh_sessions (user_id, expires_at)
WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS identity_refresh_family_idx
ON identity.refresh_sessions (family_id, created_at);

INSERT INTO platform.schema_migrations (version)
VALUES ('014_identity_foundation')
ON CONFLICT (version) DO NOTHING;

COMMIT;
