BEGIN;

CREATE SCHEMA IF NOT EXISTS notification;

CREATE TABLE IF NOT EXISTS notification.inbox_events (
  event_id uuid PRIMARY KEY,
  event_type text NOT NULL,
  booking_id uuid NOT NULL,
  trace_id text NOT NULL,
  request_id text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notification.email_delivery_logs (
  id uuid PRIMARY KEY,
  booking_id uuid NOT NULL UNIQUE,
  recipient_email text NOT NULL,
  subject text NOT NULL,
  template_name text NOT NULL,
  status text NOT NULL CHECK (status = 'SENT_SIMULATED'),
  sent_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO platform.schema_migrations (version)
VALUES ('013_notification_worker')
ON CONFLICT (version) DO NOTHING;

COMMIT;
