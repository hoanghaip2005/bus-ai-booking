BEGIN;

INSERT INTO catalog.locations (id, code, name, normalized_name, kind)
VALUES
  ('00000000-0000-4000-8000-000000000001', 'HCM', 'TP.HCM', 'tp hcm', 'CITY'),
  ('00000000-0000-4000-8000-000000000002', 'DLI', 'Đà Lạt', 'da lat', 'CITY'),
  ('00000000-0000-4000-8000-000000000003', 'NTR', 'Nha Trang', 'nha trang', 'CITY'),
  ('00000000-0000-4000-8000-000000000004', 'CTO', 'Cần Thơ', 'can tho', 'CITY'),
  ('00000000-0000-4000-8000-000000000005', 'DAD', 'Đà Nẵng', 'da nang', 'CITY'),
  ('00000000-0000-4000-8000-000000000006', 'HAN', 'Hà Nội', 'ha noi', 'CITY')
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    normalized_name = EXCLUDED.normalized_name,
    is_active = true;

COMMIT;

