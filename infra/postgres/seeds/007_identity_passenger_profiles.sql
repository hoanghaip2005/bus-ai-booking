BEGIN;

INSERT INTO identity.passenger_profiles (
  id, user_id, label, full_name, phone, created_at, updated_at
)
VALUES (
  '00000000-0000-4000-8000-000000001601',
  '00000000-0000-4000-8000-000000001401',
  'Tôi',
  'Khách hàng Demo',
  '0901234567',
  '2026-07-15T00:00:00.000Z',
  '2026-07-15T00:00:00.000Z'
)
ON CONFLICT (user_id, lower(label)) DO UPDATE
SET full_name = EXCLUDED.full_name,
    phone = EXCLUDED.phone,
    updated_at = EXCLUDED.updated_at;

COMMIT;
