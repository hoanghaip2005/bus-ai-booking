BEGIN;

ALTER TABLE booking.passengers
ADD CONSTRAINT booking_passengers_id_booking_key UNIQUE (id, booking_id);

ALTER TABLE booking.issued_ticket_refs
ADD CONSTRAINT booking_ticket_refs_ticket_booking_passenger_key
UNIQUE (ticket_id, booking_id, passenger_id);

ALTER TABLE booking.issued_ticket_refs
ADD CONSTRAINT booking_ticket_refs_passenger_booking_fk
FOREIGN KEY (passenger_id, booking_id)
REFERENCES booking.passengers (id, booking_id)
ON DELETE CASCADE;

ALTER TABLE booking.ticket_check_ins
ADD CONSTRAINT booking_check_ins_ticket_booking_passenger_fk
FOREIGN KEY (ticket_id, booking_id, passenger_id)
REFERENCES booking.issued_ticket_refs (ticket_id, booking_id, passenger_id)
ON DELETE CASCADE;

INSERT INTO platform.schema_migrations (version)
VALUES ('021_booking_check_in_integrity')
ON CONFLICT (version) DO NOTHING;

COMMIT;
