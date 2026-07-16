BEGIN;

INSERT INTO seat_inventory.trip_seat_states (
  trip_id,
  seat_id,
  status,
  booking_id,
  reason,
  updated_by_actor
)
VALUES
  (
    '00000000-0000-4000-8000-000000000701',
    'A01',
    'BOOKED',
    '00000000-0000-4000-8000-000000001001',
    NULL,
    'seed-system'
  ),
  (
    '00000000-0000-4000-8000-000000000701',
    'A02',
    'BLOCKED',
    NULL,
    'Ghế bảo trì demo',
    'seed-system'
  )
ON CONFLICT (trip_id, seat_id) DO UPDATE
SET status = EXCLUDED.status,
    booking_id = EXCLUDED.booking_id,
    reason = EXCLUDED.reason,
    updated_by_actor = EXCLUDED.updated_by_actor,
    updated_at = now();

COMMIT;
