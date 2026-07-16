BEGIN;

ALTER TABLE analytics.paid_route_facts
ADD COLUMN revenue_vnd bigint NOT NULL DEFAULT 0 CHECK (revenue_vnd >= 0);

CREATE TABLE analytics.payment_attempt_facts (
  event_id uuid PRIMARY KEY,
  local_date date NOT NULL,
  payment_attempt_id uuid NOT NULL,
  booking_id uuid NOT NULL,
  requested_outcome text NOT NULL CHECK (requested_outcome IN ('SUCCESS', 'FAILURE')),
  status text NOT NULL CHECK (status IN ('SUCCEEDED', 'FAILED')),
  amount_vnd bigint NOT NULL CHECK (amount_vnd >= 0)
);

CREATE INDEX analytics_payment_attempt_date_idx
ON analytics.payment_attempt_facts (local_date, status);

INSERT INTO platform.schema_migrations (version)
VALUES ('027_analytics_payments_ticket_sales')
ON CONFLICT (version) DO NOTHING;

COMMIT;
