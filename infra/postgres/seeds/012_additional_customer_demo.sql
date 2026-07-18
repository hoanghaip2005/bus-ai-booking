BEGIN;

INSERT INTO identity.users (
  id, email, normalized_email, display_name, password_hash, role, is_active
)
VALUES (
  '00000000-0000-4000-8000-000000001404',
  'customer2.demo@benviet.vn',
  'customer2.demo@benviet.vn',
  'Khach hang Demo 2',
  'scrypt$143e1413d941da3ea96f5d738c2f67f9$91637fce7938f83ef5859a8a88461fe11f2eaaefa7427bec81fcb33175c02a6cf3bbf21a3b7465610d5f173fff8c8e3c3e52f1cd98ab2ab95412d722df02ca03',
  'CUSTOMER',
  true
)
ON CONFLICT (normalized_email) DO UPDATE
SET email = EXCLUDED.email,
    display_name = EXCLUDED.display_name,
    password_hash = EXCLUDED.password_hash,
    role = EXCLUDED.role,
    is_active = true,
    updated_at = now();

COMMIT;
