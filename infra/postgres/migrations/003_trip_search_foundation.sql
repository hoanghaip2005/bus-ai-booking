BEGIN;

CREATE TABLE IF NOT EXISTS catalog.operators (
  id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS catalog.vehicle_types (
  id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  seat_capacity smallint NOT NULL CHECK (seat_capacity > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS catalog.vehicles (
  id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE,
  plate text NOT NULL UNIQUE,
  operator_id uuid NOT NULL REFERENCES catalog.operators (id),
  vehicle_type_id uuid NOT NULL REFERENCES catalog.vehicle_types (id),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS catalog.routes (
  id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE,
  origin_location_id uuid NOT NULL REFERENCES catalog.locations (id),
  destination_location_id uuid NOT NULL REFERENCES catalog.locations (id),
  duration_minutes integer NOT NULL CHECK (duration_minutes > 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (origin_location_id <> destination_location_id)
);

CREATE TABLE IF NOT EXISTS catalog.route_stops (
  id uuid PRIMARY KEY,
  route_id uuid NOT NULL REFERENCES catalog.routes (id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES catalog.locations (id),
  stop_order smallint NOT NULL CHECK (stop_order > 0),
  stop_kind text NOT NULL CHECK (stop_kind IN ('PICKUP', 'DROPOFF', 'BOTH')),
  offset_minutes integer NOT NULL CHECK (offset_minutes >= 0),
  UNIQUE (route_id, stop_order)
);

CREATE TABLE IF NOT EXISTS catalog.trips (
  id uuid PRIMARY KEY,
  route_id uuid NOT NULL REFERENCES catalog.routes (id),
  vehicle_id uuid NOT NULL REFERENCES catalog.vehicles (id),
  departure_at timestamptz NOT NULL,
  arrival_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('DRAFT', 'SCHEDULED', 'BOARDING', 'DEPARTED', 'COMPLETED', 'CANCELLED')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (arrival_at > departure_at)
);

CREATE TABLE IF NOT EXISTS catalog.fares (
  id uuid PRIMARY KEY,
  trip_id uuid NOT NULL UNIQUE REFERENCES catalog.trips (id) ON DELETE CASCADE,
  price_vnd integer NOT NULL CHECK (price_vnd > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trips_active_departure_idx
ON catalog.trips (departure_at, route_id)
WHERE is_active AND status IN ('SCHEDULED', 'BOARDING');

CREATE INDEX IF NOT EXISTS routes_active_endpoints_idx
ON catalog.routes (origin_location_id, destination_location_id)
WHERE is_active;

INSERT INTO platform.schema_migrations (version)
VALUES ('003_trip_search_foundation')
ON CONFLICT (version) DO NOTHING;

COMMIT;
