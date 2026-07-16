BEGIN;

CREATE TABLE analytics.search_facts (
  event_id uuid PRIMARY KEY,
  local_date date NOT NULL,
  search_session_id uuid NOT NULL,
  result_count integer NOT NULL CHECK (result_count >= 0)
);

CREATE INDEX analytics_search_facts_date_idx
ON analytics.search_facts (local_date);

CREATE TABLE analytics.search_route_matches (
  event_id uuid NOT NULL REFERENCES analytics.search_facts(event_id) ON DELETE CASCADE,
  route_id uuid NOT NULL,
  route_label text NOT NULL,
  PRIMARY KEY (event_id, route_id)
);

CREATE INDEX analytics_search_route_date_idx
ON analytics.search_route_matches (route_id, event_id);

CREATE TABLE analytics.paid_route_facts (
  event_id uuid PRIMARY KEY,
  local_date date NOT NULL,
  booking_id uuid NOT NULL,
  route_id uuid NOT NULL,
  route_code text NOT NULL,
  ticket_count integer NOT NULL CHECK (ticket_count > 0)
);

CREATE INDEX analytics_paid_route_date_idx
ON analytics.paid_route_facts (local_date, route_id);

INSERT INTO platform.schema_migrations (version)
VALUES ('026_analytics_routes_conversion')
ON CONFLICT (version) DO NOTHING;

COMMIT;
