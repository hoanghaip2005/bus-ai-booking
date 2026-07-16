BEGIN;

INSERT INTO catalog.locations (id, code, name, normalized_name, kind, parent_location_id)
VALUES
  ('00000000-0000-4000-8000-000000000101', 'BX-MD', 'Bến xe Miền Đông', 'ben xe mien dong', 'STATION', '00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000102', 'BX-MT', 'Bến xe Miền Tây', 'ben xe mien tay', 'STATION', '00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000103', 'BX-DLI', 'Bến xe Liên tỉnh Đà Lạt', 'ben xe lien tinh da lat', 'STATION', '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000104', 'BX-NTR-S', 'Bến xe Nha Trang phía Nam', 'ben xe nha trang phia nam', 'STATION', '00000000-0000-4000-8000-000000000003')
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    normalized_name = EXCLUDED.normalized_name,
    kind = EXCLUDED.kind,
    parent_location_id = EXCLUDED.parent_location_id,
    is_active = true;

INSERT INTO catalog.location_aliases (location_id, alias, normalized_alias)
VALUES
  ('00000000-0000-4000-8000-000000000001', 'Sài Gòn', 'sai gon'),
  ('00000000-0000-4000-8000-000000000001', 'Ho Chi Minh', 'ho chi minh'),
  ('00000000-0000-4000-8000-000000000001', 'TP HCM', 'tp hcm'),
  ('00000000-0000-4000-8000-000000000002', 'Da Lat', 'da lat'),
  ('00000000-0000-4000-8000-000000000004', 'Can Tho', 'can tho'),
  ('00000000-0000-4000-8000-000000000005', 'Da Nang', 'da nang'),
  ('00000000-0000-4000-8000-000000000006', 'Ha Noi', 'ha noi'),
  ('00000000-0000-4000-8000-000000000101', 'Miền Đông', 'mien dong'),
  ('00000000-0000-4000-8000-000000000102', 'Miền Tây', 'mien tay'),
  ('00000000-0000-4000-8000-000000000103', 'Liên tỉnh Đà Lạt', 'lien tinh da lat'),
  ('00000000-0000-4000-8000-000000000104', 'Nha Trang phía Nam', 'nha trang phia nam')
ON CONFLICT (location_id, normalized_alias) DO UPDATE
SET alias = EXCLUDED.alias;

COMMIT;
