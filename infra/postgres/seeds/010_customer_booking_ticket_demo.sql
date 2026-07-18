BEGIN;

DELETE FROM booking.ticket_check_ins
WHERE ticket_id = '00000000-0000-4000-8000-000000001203';

DELETE FROM booking.operational_audit
WHERE target_id IN (
  '00000000-0000-4000-8000-000000001201',
  '00000000-0000-4000-8000-000000001203',
  '00000000-0000-4000-8000-000000001211',
  '00000000-0000-4000-8000-000000001221'
);

INSERT INTO booking.bookings (
  id,
  booking_code,
  status,
  checkout_owner_type,
  checkout_owner_id,
  idempotency_key,
  request_fingerprint,
  hold_token,
  hold_expires_at,
  contact_full_name,
  contact_email,
  normalized_email,
  contact_phone,
  trip_id,
  route_id,
  route_code,
  operator_name,
  vehicle_type_name,
  vehicle_code,
  vehicle_plate,
  origin_name,
  destination_name,
  pickup_name,
  dropoff_name,
  departure_at,
  arrival_at,
  timezone,
  unit_price_vnd,
  seat_count,
  total_price_vnd,
  paid_payment_attempt_id,
  payment_idempotency_key,
  paid_at,
  created_at,
  updated_at
)
VALUES
  (
    '00000000-0000-4000-8000-000000001201',
    'BV-CUSTOMER-JULY-01',
    'TICKET_ISSUED',
    'CUSTOMER',
    '00000000-0000-4000-8000-000000001401',
    'seed-customer-july-booking-01',
    '2012012012012012012012012012012012012012012012012012012012012012',
    'customer-july-hold-token-0001',
    '2026-07-25 06:55:00+07',
    'Khach hang Demo',
    'customer.demo@benviet.vn',
    'customer.demo@benviet.vn',
    '0901234567',
    'e316cd2c-acc6-44b5-8456-c03929a35eca',
    '00000000-0000-4000-8000-000000000501',
    'HCM-DLI',
    'Phuong Trang Demo',
    'Giuong nam 34 cho',
    'PT-S34-01',
    '51B-120.01',
    'TP.HCM',
    'Da Lat',
    'Ben xe Mien Dong',
    'Ben xe Lien tinh Da Lat',
    '2026-07-25 07:00:00+07',
    '2026-07-25 14:00:00+07',
    'Asia/Ho_Chi_Minh',
    280000,
    1,
    280000,
    '00000000-0000-4000-8000-000000001205',
    'seed-customer-july-payment-01',
    '2026-07-25 06:50:00+07',
    '2026-07-18 09:00:00+07',
    '2026-07-18 09:05:00+07'
  ),
  (
    '00000000-0000-4000-8000-000000001211',
    'BV-CUSTOMER-JULY-02',
    'PAID',
    'CUSTOMER',
    '00000000-0000-4000-8000-000000001401',
    'seed-customer-july-booking-02',
    '2112112112112112112112112112112112112112112112112112112112112112',
    'customer-july-hold-token-0002',
    '2026-07-28 19:55:00+07',
    'Khach hang Demo',
    'customer.demo@benviet.vn',
    'customer.demo@benviet.vn',
    '0901234567',
    '69048ba4-847d-413b-86c7-70b71a00368a',
    '00000000-0000-4000-8000-000000000503',
    'HCM-NTR',
    'Phuong Trang Demo',
    'Giuong nam 34 cho',
    'PT-S34-01',
    '51B-120.01',
    'TP.HCM',
    'Nha Trang',
    'Ben xe Mien Dong',
    'Ben xe Nha Trang phia Nam',
    '2026-07-28 20:00:00+07',
    '2026-07-29 05:00:00+07',
    'Asia/Ho_Chi_Minh',
    300000,
    1,
    300000,
    '00000000-0000-4000-8000-000000001215',
    'seed-customer-july-payment-02',
    '2026-07-20 10:00:00+07',
    '2026-07-19 09:00:00+07',
    '2026-07-20 10:00:00+07'
  ),
  (
    '00000000-0000-4000-8000-000000001221',
    'BV-CUSTOMER-JULY-03',
    'PENDING_PAYMENT',
    'CUSTOMER',
    '00000000-0000-4000-8000-000000001401',
    'seed-customer-july-booking-03',
    '2212212212212212212212212212212212212212212212212212212212212212',
    'customer-july-hold-token-0003',
    '2026-07-30 15:55:00+07',
    'Khach hang Demo',
    'customer.demo@benviet.vn',
    'customer.demo@benviet.vn',
    '0901234567',
    '264df8eb-4c87-4eb9-8024-2702764b6d89',
    '00000000-0000-4000-8000-000000000505',
    'HCM-CTO',
    'Kumho Demo',
    'Ghe ngoi 29 cho',
    'KH-C29-01',
    '51B-320.03',
    'TP.HCM',
    'Can Tho',
    'Ben xe Mien Tay',
    'Ben xe Can Tho',
    '2026-07-30 16:00:00+07',
    '2026-07-30 19:30:00+07',
    'Asia/Ho_Chi_Minh',
    160000,
    1,
    160000,
    NULL,
    NULL,
    NULL,
    '2026-07-20 11:00:00+07',
    '2026-07-20 11:00:00+07'
  )
ON CONFLICT (id) DO UPDATE
SET booking_code = EXCLUDED.booking_code,
    status = EXCLUDED.status,
    checkout_owner_type = EXCLUDED.checkout_owner_type,
    checkout_owner_id = EXCLUDED.checkout_owner_id,
    idempotency_key = EXCLUDED.idempotency_key,
    request_fingerprint = EXCLUDED.request_fingerprint,
    hold_token = EXCLUDED.hold_token,
    hold_expires_at = EXCLUDED.hold_expires_at,
    contact_full_name = EXCLUDED.contact_full_name,
    contact_email = EXCLUDED.contact_email,
    normalized_email = EXCLUDED.normalized_email,
    contact_phone = EXCLUDED.contact_phone,
    trip_id = EXCLUDED.trip_id,
    route_id = EXCLUDED.route_id,
    route_code = EXCLUDED.route_code,
    operator_name = EXCLUDED.operator_name,
    vehicle_type_name = EXCLUDED.vehicle_type_name,
    vehicle_code = EXCLUDED.vehicle_code,
    vehicle_plate = EXCLUDED.vehicle_plate,
    origin_name = EXCLUDED.origin_name,
    destination_name = EXCLUDED.destination_name,
    pickup_name = EXCLUDED.pickup_name,
    dropoff_name = EXCLUDED.dropoff_name,
    departure_at = EXCLUDED.departure_at,
    arrival_at = EXCLUDED.arrival_at,
    timezone = EXCLUDED.timezone,
    unit_price_vnd = EXCLUDED.unit_price_vnd,
    seat_count = EXCLUDED.seat_count,
    total_price_vnd = EXCLUDED.total_price_vnd,
    paid_payment_attempt_id = EXCLUDED.paid_payment_attempt_id,
    payment_idempotency_key = EXCLUDED.payment_idempotency_key,
    paid_at = EXCLUDED.paid_at,
    created_at = EXCLUDED.created_at,
    updated_at = EXCLUDED.updated_at;

INSERT INTO booking.passengers (id, booking_id, seat_id, full_name, phone, created_at)
VALUES
  ('00000000-0000-4000-8000-000000001202', '00000000-0000-4000-8000-000000001201', 'A04', 'Khach hang Demo', '0901234567', '2026-07-18 09:00:00+07'),
  ('00000000-0000-4000-8000-000000001212', '00000000-0000-4000-8000-000000001211', 'A05', 'Khach hang Demo', '0901234567', '2026-07-19 09:00:00+07'),
  ('00000000-0000-4000-8000-000000001222', '00000000-0000-4000-8000-000000001221', 'A06', 'Khach hang Demo', '0901234567', '2026-07-20 11:00:00+07')
ON CONFLICT (id) DO UPDATE
SET booking_id = EXCLUDED.booking_id,
    seat_id = EXCLUDED.seat_id,
    full_name = EXCLUDED.full_name,
    phone = EXCLUDED.phone,
    created_at = EXCLUDED.created_at;

DELETE FROM booking.status_history
WHERE booking_id IN (
  '00000000-0000-4000-8000-000000001201',
  '00000000-0000-4000-8000-000000001211',
  '00000000-0000-4000-8000-000000001221'
);

INSERT INTO booking.status_history (id, booking_id, from_status, to_status, actor_type, actor_id, occurred_at)
VALUES
  ('00000000-0000-4000-8000-000000001206', '00000000-0000-4000-8000-000000001201', 'PAID', 'TICKET_ISSUED', 'SYSTEM', '00000000-0000-4000-8000-000000000001', '2026-07-18 09:05:00+07'),
  ('00000000-0000-4000-8000-000000001216', '00000000-0000-4000-8000-000000001211', 'PENDING_PAYMENT', 'PAID', 'CUSTOMER', '00000000-0000-4000-8000-000000001401', '2026-07-20 10:00:00+07'),
  ('00000000-0000-4000-8000-000000001226', '00000000-0000-4000-8000-000000001221', NULL, 'PENDING_PAYMENT', 'CUSTOMER', '00000000-0000-4000-8000-000000001401', '2026-07-20 11:00:00+07');

INSERT INTO booking.issued_ticket_refs (
  ticket_id,
  booking_id,
  passenger_id,
  ticket_code,
  qr_payload_hash,
  issued_at
)
VALUES (
  '00000000-0000-4000-8000-000000001203',
  '00000000-0000-4000-8000-000000001201',
  '00000000-0000-4000-8000-000000001202',
  'VT-CUSTOMER-JULY-01',
  '54e601330289b8d6b6fbdfec67dace6c0611ea44ca74ef42966de85002a55452',
  '2026-07-18 09:05:00+07'
)
ON CONFLICT (ticket_id) DO UPDATE
SET booking_id = EXCLUDED.booking_id,
    passenger_id = EXCLUDED.passenger_id,
    ticket_code = EXCLUDED.ticket_code,
    qr_payload_hash = EXCLUDED.qr_payload_hash,
    issued_at = EXCLUDED.issued_at;

INSERT INTO ticket.tickets (
  id,
  booking_id,
  passenger_id,
  checkout_owner_type,
  checkout_owner_id,
  ticket_code,
  booking_code,
  passenger_name,
  seat_id,
  route_label,
  pickup_name,
  dropoff_name,
  departure_at,
  vehicle_label,
  qr_payload,
  html_content,
  pdf_document,
  issued_at,
  created_at
)
VALUES (
  '00000000-0000-4000-8000-000000001203',
  '00000000-0000-4000-8000-000000001201',
  '00000000-0000-4000-8000-000000001202',
  'CUSTOMER',
  '00000000-0000-4000-8000-000000001401',
  'VT-CUSTOMER-JULY-01',
  'BV-CUSTOMER-JULY-01',
  'Khach hang Demo',
  'A04',
  'TP.HCM -> Da Lat',
  'Ben xe Mien Dong',
  'Ben xe Lien tinh Da Lat',
  '2026-07-25 07:00:00+07',
  'PT-S34-01 - 51B-120.01',
  'BV-CUSTOMER-JULY-01-00000000-0000-4000-8000-000000001203',
  $ticket_html$<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>VT-CUSTOMER-JULY-01</title><style>body{font-family:sans-serif;margin:32px;color:#17352d}main{max-width:720px;margin:auto;border:1px solid #17352d;padding:28px}h1{margin-top:0}.ticket{display:grid;grid-template-columns:1fr 200px;gap:24px}.qr{text-align:center}.qr img{width:180px;height:180px}.qr small{display:block;overflow-wrap:anywhere}</style></head><body><main><h1>Ben Viet - Ve dien tu</h1><div class="ticket"><section><p><strong>Ma ve:</strong> VT-CUSTOMER-JULY-01</p><p><strong>Hanh khach:</strong> Khach hang Demo</p><p><strong>Tuyen:</strong> TP.HCM - Da Lat</p><p><strong>Khoi hanh:</strong> 25/07/2026 07:00</p><p><strong>Ghe:</strong> A04</p><p><strong>Xe:</strong> PT-S34-01 - 51B-120.01</p></section><aside class="qr"><img alt="QR ve mo phong" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAALQAAAC0CAYAAAA9zQYyAAAAAklEQVR4AewaftIAAAXySURBVO3BUYojWRAEwfCH7n9l3/kusqEKSU2TG2b4T6qWOKla5KRqkZOqRU6qFjmpWuSVHwD569S8C8hEzScAuUvNE0Amaq6ATNRMgPx1aq5OqhY5qVrkpGqRk6pFTqoWeeUhNb8NyBNAJmqu1EyA/HVqJkCu1HyCmt8G5K6TqkVOqhY5qVrkpGqRk6pFXvkQIO9S8wlq7gIyUfMEkImaKyATIJ+g5grIRM0nAHmXmnedVC1yUrXISdUiJ1WLnFQt8ko9AuRb1EyATNRMgFyp+T84qVrkpGqRk6pFTqoWOala5JWFgEzUfIuaCZArNRMgEzVPqLkCMlGzyUnVIidVi5xULXJStcgrH6Lmr1AzAfIuNRMgEzVXQCZqJkAmaiZArtR8k5q/4KRqkZOqRU6qFjmpWuSkapFXHgLy1wGZqLkC8gSQiZoJkCs1EyATNRMgEzVXQCZqngDyl51ULXJStchJ1SInVYucVC2C/+R/AsiVmieAPKHmCshEzQTIt6jZ5KRqkZOqRU6qFjmpWuSkapFXfgBkomYCZKJmAuRKzQTIRM27gEzUTNQ8AeRKzQTIE2r+CiBXap4AMlFz10nVIidVi5xULXJStchJ1SKv/EDNBMi3AJmomQB5l5oJkE9QcwVkomYCZKJmAuQuIE+omQD5FjV3nVQtclK1yEnVIidVi5xULfLKQ2p+G5BPUHMF5Ak1EyDvUjMBMlEzAfIuNe8C8gSQd51ULXJStchJ1SInVYucVC3yyocAeZeaTwAyUXOXmgmQiZoJkLuATNRMgEzUXAGZANnkpGqRk6pFTqoWOala5JWF1HyLmgmQd6mZAJmomQC5UjMBMlHzLUAmav51UrXISdUiJ1WLnFQtclK1yCsLAXkXkImaJ9S8S80EyETNFZCJmgmQJ9RcAfkEIBM1VydVi5xULXJStchJ1SInVYu88iFq/go1dwF5AsgTQL5FzQTIlZoJkImab1EzAfKuk6pFTqoWOala5KRqkZOqRV55CMhfB+QuNd8E5ErNBMhEzQTIRM0VkImaCZAn1FypmQCZqJkAueukapGTqkVOqhY5qVrkpGoR/CdVS5xULXJStchJ1SInVYv8B4eSjoGsLt5TAAAAAElFTkSuQmCC"><small>BV-CUSTOMER-JULY-01-00000000-0000-4000-8000-000000001203</small></aside></div></main></body></html>$ticket_html$,
  decode('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', 'base64'),
  '2026-07-18 09:05:00+07',
  '2026-07-18 09:05:00+07'
)
ON CONFLICT (id) DO UPDATE
SET booking_id = EXCLUDED.booking_id,
    passenger_id = EXCLUDED.passenger_id,
    checkout_owner_type = EXCLUDED.checkout_owner_type,
    checkout_owner_id = EXCLUDED.checkout_owner_id,
    ticket_code = EXCLUDED.ticket_code,
    booking_code = EXCLUDED.booking_code,
    passenger_name = EXCLUDED.passenger_name,
    seat_id = EXCLUDED.seat_id,
    route_label = EXCLUDED.route_label,
    pickup_name = EXCLUDED.pickup_name,
    dropoff_name = EXCLUDED.dropoff_name,
    departure_at = EXCLUDED.departure_at,
    vehicle_label = EXCLUDED.vehicle_label,
    qr_payload = EXCLUDED.qr_payload,
    html_content = EXCLUDED.html_content,
    pdf_document = EXCLUDED.pdf_document,
    issued_at = EXCLUDED.issued_at,
    created_at = EXCLUDED.created_at;

INSERT INTO seat_inventory.trip_seat_states (
  trip_id,
  seat_id,
  status,
  booking_id,
  reason,
  updated_by_actor,
  updated_at
)
VALUES
  ('e316cd2c-acc6-44b5-8456-c03929a35eca', 'A04', 'BOOKED', '00000000-0000-4000-8000-000000001201', NULL, 'seed-customer-ticket-demo', '2026-07-18 09:05:00+07'),
  ('69048ba4-847d-413b-86c7-70b71a00368a', 'A05', 'BOOKED', '00000000-0000-4000-8000-000000001211', NULL, 'seed-customer-ticket-demo', '2026-07-20 10:00:00+07')
ON CONFLICT (trip_id, seat_id) DO UPDATE
SET status = EXCLUDED.status,
    booking_id = EXCLUDED.booking_id,
    reason = EXCLUDED.reason,
    updated_by_actor = EXCLUDED.updated_by_actor,
    updated_at = EXCLUDED.updated_at;

COMMIT;
