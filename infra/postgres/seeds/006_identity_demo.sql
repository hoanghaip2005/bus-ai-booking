BEGIN;

INSERT INTO identity.users (
  id, email, normalized_email, display_name, password_hash, role, is_active
)
VALUES
  (
    '00000000-0000-4000-8000-000000001401',
    'customer.demo@benviet.vn',
    'customer.demo@benviet.vn',
    'Khách hàng Demo',
    'scrypt$11111111111111111111111111111111$7ab5eea4549840ef632deaf5ab7bbd8024bb820f85b88882043649c34d630cef1640482b51412632503aedd80921651e9b73c52529ff4d9ecc96f6dfca7bc182',
    'CUSTOMER',
    true
  ),
  (
    '00000000-0000-4000-8000-000000001402',
    'staff.demo@benviet.vn',
    'staff.demo@benviet.vn',
    'Nhân viên Demo',
    'scrypt$22222222222222222222222222222222$0b939f8fc287364bdd8434e29e3d76ce77fca9326aa5218057c4dd1916bd5e0531a87e4764dd7a23525cc1cc3a09e55f93b19fa0a084a38f9734f44701517329',
    'STAFF',
    true
  ),
  (
    '00000000-0000-4000-8000-000000001403',
    'admin.demo@benviet.vn',
    'admin.demo@benviet.vn',
    'Quản trị Demo',
    'scrypt$33333333333333333333333333333333$99ebbd57ad26649399b83728b36c2ff6fcba6306658f1bd8147313ee8342a45ed962a70e8b54665e474ea0d68b56f0aa39731306013fcff465f1c6e32a27d1b0',
    'ADMIN',
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
