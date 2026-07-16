BEGIN;

CREATE SCHEMA IF NOT EXISTS analytics;

CREATE TABLE analytics.processed_events (
  event_id uuid PRIMARY KEY,
  topic text NOT NULL,
  event_type text NOT NULL,
  occurred_at timestamptz NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE analytics.daily_revenue (
  local_date date PRIMARY KEY,
  revenue_vnd bigint NOT NULL CHECK (revenue_vnd >= 0),
  paid_booking_count integer NOT NULL CHECK (paid_booking_count >= 0),
  ticket_count integer NOT NULL CHECK (ticket_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO platform.schema_migrations (version)
VALUES ('025_analytics_daily_revenue')
ON CONFLICT (version) DO NOTHING;

COMMIT;
