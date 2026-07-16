BEGIN;

WITH layout_source (
  id,
  vehicle_type_id,
  version,
  name,
  capacity,
  deck_count,
  seats_per_deck
) AS (
  VALUES
    ('00000000-0000-4000-8000-000000000901'::uuid, '00000000-0000-4000-8000-000000000301'::uuid, 1, 'Sơ đồ ghế ngồi 29 chỗ', 29, 1, 29),
    ('00000000-0000-4000-8000-000000000902'::uuid, '00000000-0000-4000-8000-000000000302'::uuid, 1, 'Sơ đồ giường nằm 34 chỗ', 34, 2, 17),
    ('00000000-0000-4000-8000-000000000903'::uuid, '00000000-0000-4000-8000-000000000303'::uuid, 1, 'Sơ đồ limousine 22 chỗ', 22, 1, 22)
)
INSERT INTO catalog.seat_layout_versions (
  id,
  vehicle_type_id,
  version,
  name,
  deck_count,
  layout
)
SELECT
  source.id,
  source.vehicle_type_id,
  source.version,
  source.name,
  source.deck_count,
  jsonb_build_object(
    'seats',
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', chr(65 + ((seat.number - 1) / source.seats_per_deck)) || lpad((((seat.number - 1) % source.seats_per_deck) + 1)::text, 2, '0'),
          'label', chr(65 + ((seat.number - 1) / source.seats_per_deck)) || lpad((((seat.number - 1) % source.seats_per_deck) + 1)::text, 2, '0'),
          'deck', ((seat.number - 1) / source.seats_per_deck) + 1,
          'row', ((((seat.number - 1) % source.seats_per_deck)) / 3) + 1,
          'column', CASE ((seat.number - 1) % 3) WHEN 2 THEN 4 ELSE ((seat.number - 1) % 3) + 1 END
        )
        ORDER BY seat.number
      )
      FROM generate_series(1, source.capacity) AS seat(number)
    )
  )
FROM layout_source AS source
ON CONFLICT (vehicle_type_id, version) DO UPDATE
SET name = EXCLUDED.name,
    deck_count = EXCLUDED.deck_count,
    layout = EXCLUDED.layout,
    is_active = true;

UPDATE catalog.vehicles AS vehicle
SET seat_layout_version_id = layout.id
FROM catalog.seat_layout_versions AS layout
WHERE layout.vehicle_type_id = vehicle.vehicle_type_id
  AND layout.version = 1
  AND layout.is_active;

INSERT INTO catalog.trips (
  id,
  route_id,
  vehicle_id,
  departure_at,
  arrival_at,
  status,
  is_active
)
VALUES (
  '00000000-0000-4000-8000-000000000799',
  '00000000-0000-4000-8000-000000000501',
  '00000000-0000-4000-8000-000000000401',
  '2030-06-22 07:00:00+07',
  '2030-06-22 14:00:00+07',
  'SCHEDULED',
  false
)
ON CONFLICT (id) DO UPDATE
SET route_id = EXCLUDED.route_id,
    vehicle_id = EXCLUDED.vehicle_id,
    departure_at = EXCLUDED.departure_at,
    arrival_at = EXCLUDED.arrival_at,
    status = EXCLUDED.status,
    is_active = false;

INSERT INTO catalog.fares (id, trip_id, price_vnd)
VALUES (
  '00000000-0000-4000-8000-000000000899',
  '00000000-0000-4000-8000-000000000799',
  280000
)
ON CONFLICT (trip_id) DO UPDATE
SET price_vnd = EXCLUDED.price_vnd;

COMMIT;
