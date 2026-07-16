BEGIN;

CREATE SCHEMA IF NOT EXISTS payment;

CREATE TABLE IF NOT EXISTS payment.attempts (
  id uuid PRIMARY KEY,
  booking_id uuid NOT NULL,
  owner_type text NOT NULL CHECK (owner_type IN ('GUEST_SESSION', 'CUSTOMER')),
  owner_id uuid NOT NULL,
  amount_vnd integer NOT NULL CHECK (amount_vnd > 0),
  requested_outcome text NOT NULL CHECK (requested_outcome IN ('SUCCESS', 'FAILURE')),
  status text NOT NULL CHECK (status IN ('SUCCEEDED', 'FAILED')),
  failure_code text,
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9._-]{16,128}$'),
  request_fingerprint char(64) NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT payment_attempts_booking_idempotency_key UNIQUE (booking_id, idempotency_key),
  CHECK (
    (status = 'SUCCEEDED' AND failure_code IS NULL)
    OR (status = 'FAILED' AND failure_code IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_attempts_one_success_idx
ON payment.attempts (booking_id)
WHERE status = 'SUCCEEDED';

CREATE INDEX IF NOT EXISTS payment_attempts_owner_created_idx
ON payment.attempts (owner_type, owner_id, created_at DESC);

INSERT INTO platform.schema_migrations (version)
VALUES ('008_payment_foundation')
ON CONFLICT (version) DO NOTHING;

COMMIT;
