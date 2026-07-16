'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';

import { getStoredAuthSession } from '../../lib/auth-session';
import { listPassengerProfiles, type PassengerProfile } from '../../lib/passenger-profiles';
import {
  BookingClientError,
  createGuestBooking,
  type GuestBooking,
  type GuestBookingInput,
} from './booking-client';
import { getCheckoutSessionId } from './checkout-session';
import { SimulatedPaymentPanel } from './simulated-payment-panel';
import type { SeatHold } from './seat-hold-client';

interface GuestBookingFormProps {
  hold: SeatHold | null;
  booking: GuestBooking | null;
  onBookingUpdated: (booking: GuestBooking) => void;
}

export function GuestBookingForm({ hold, booking, onBookingUpdated }: GuestBookingFormProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const [profiles, setProfiles] = useState<PassengerProfile[]>([]);
  const formRef = useRef<HTMLFormElement>(null);
  const idempotencyKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (getStoredAuthSession()?.user.role !== 'CUSTOMER') return;
    void listPassengerProfiles()
      .then(setProfiles)
      .catch(() => undefined);
  }, []);

  function applyProfile(profileId: string): void {
    const profile = profiles.find((candidate) => candidate.id === profileId);
    const form = formRef.current;
    if (!profile || !form || !hold) return;
    setInputValue(form, 'contactFullName', profile.fullName);
    setInputValue(form, 'contactPhone', profile.phone ?? '');
    setInputValue(form, 'contactEmail', getStoredAuthSession()?.user.email ?? '');
    const firstSeat = hold.seatIds[0];
    if (firstSeat) {
      setInputValue(form, `passengerName:${firstSeat}`, profile.fullName);
      setInputValue(form, `passengerPhone:${firstSeat}`, profile.phone ?? '');
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!hold || booking || submitting) return;
    const form = new FormData(event.currentTarget);
    idempotencyKeyRef.current ??= crypto.randomUUID();
    const input: GuestBookingInput = {
      holdToken: hold.token,
      idempotencyKey: idempotencyKeyRef.current,
      contact: {
        fullName: formValue(form, 'contactFullName'),
        email: formValue(form, 'contactEmail'),
        phone: formValue(form, 'contactPhone'),
      },
      passengers: hold.seatIds.map((seatId) => ({
        seatId,
        fullName: formValue(form, `passengerName:${seatId}`),
        ...optionalFormValue(form, `passengerPhone:${seatId}`, 'phone'),
        ...optionalFormValue(form, `passengerDocument:${seatId}`, 'documentNumber'),
      })),
    };
    setSubmitting(true);
    setError(undefined);
    try {
      const created = await createGuestBooking(input, getCheckoutSessionId());
      onBookingUpdated(created);
    } catch (bookingError) {
      setError(messageForBookingError(bookingError));
    } finally {
      setSubmitting(false);
    }
  }

  if (booking) {
    return <SimulatedPaymentPanel booking={booking} onBookingUpdated={onBookingUpdated} />;
  }

  if (!hold) return null;

  return (
    <form className="guest-booking-form" ref={formRef} onSubmit={(event) => void submit(event)}>
      <div className="booking-form-heading">
        <div>
          <p className="eyebrow">Bước tiếp theo</p>
          <h3>Thông tin đặt vé</h3>
        </div>
        <span>{hold.seatIds.length} hành khách</span>
      </div>

      {profiles.length > 0 && (
        <label className="profile-prefill">
          <span>Điền nhanh từ hành khách thường dùng</span>
          <select defaultValue="" onChange={(event) => applyProfile(event.target.value)}>
            <option value="" disabled>
              Chọn một hồ sơ…
            </option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.label} · {profile.fullName}
              </option>
            ))}
          </select>
        </label>
      )}

      <fieldset>
        <legend>Thông tin liên hệ</legend>
        <div className="booking-field-grid">
          <label>
            <span>Họ tên liên hệ</span>
            <input
              name="contactFullName"
              autoComplete="name"
              required
              minLength={2}
              maxLength={100}
            />
          </label>
          <label>
            <span>Email nhận vé</span>
            <input name="contactEmail" type="email" autoComplete="email" required maxLength={254} />
          </label>
          <label>
            <span>Số điện thoại liên hệ</span>
            <input
              name="contactPhone"
              type="tel"
              autoComplete="tel"
              required
              minLength={8}
              maxLength={24}
            />
          </label>
        </div>
      </fieldset>

      {hold.seatIds.map((seatId, index) => (
        <fieldset key={seatId}>
          <legend>
            Hành khách {index + 1} · Ghế {seatId}
          </legend>
          <div className="booking-field-grid">
            <label>
              <span>Họ tên hành khách ghế {seatId}</span>
              <input
                name={`passengerName:${seatId}`}
                autoComplete="name"
                required
                minLength={2}
                maxLength={100}
              />
            </label>
            <label>
              <span>Số điện thoại (tùy chọn)</span>
              <input name={`passengerPhone:${seatId}`} type="tel" maxLength={24} />
            </label>
            <label>
              <span>Số giấy tờ (tùy chọn)</span>
              <input name={`passengerDocument:${seatId}`} maxLength={32} autoComplete="off" />
            </label>
          </div>
        </fieldset>
      ))}

      <div className="booking-submit-row">
        <p>
          Thông tin giấy tờ không được trả lại qua API. Booking hiện chỉ ở trạng thái chờ thanh
          toán.
        </p>
        <button type="submit" disabled={submitting}>
          {submitting ? 'Đang tạo booking…' : 'Tạo booking'}
        </button>
      </div>
      {error ? (
        <p className="seat-hold-error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}

function formValue(form: FormData, name: string): string {
  return String(form.get(name) ?? '').trim();
}

function optionalFormValue(
  form: FormData,
  name: string,
  key: 'phone' | 'documentNumber',
): { phone?: string; documentNumber?: string } {
  const value = formValue(form, name);
  return value ? { [key]: value } : {};
}

function setInputValue(form: HTMLFormElement, name: string, value: string): void {
  const control = form.elements.namedItem(name);
  if (control instanceof HTMLInputElement) {
    control.value = value;
    control.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

function messageForBookingError(error: unknown): string {
  if (error instanceof BookingClientError && error.code === 'HOLD_EXPIRED') {
    return 'Thời gian giữ ghế đã hết. Vui lòng chọn lại ghế.';
  }
  if (error instanceof BookingClientError && error.code === 'IDEMPOTENCY_CONFLICT') {
    return 'Yêu cầu này khác với lần gửi trước. Vui lòng tải lại trang.';
  }
  return error instanceof Error ? error.message : 'Không thể tạo booking lúc này.';
}
