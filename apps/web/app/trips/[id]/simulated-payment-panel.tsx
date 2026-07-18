'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';

import { getStoredAuthSession } from '../../lib/auth-session';
import { BookingClientError, type GuestBooking } from './booking-client';
import { getCheckoutSessionId } from './checkout-session';
import { simulatePayment } from './payment-client';
import { TicketDeliveryPanel } from './ticket-delivery-panel';

interface SimulatedPaymentPanelProps {
  booking: GuestBooking;
  onBookingUpdated: (booking: GuestBooking) => void;
  onStartNewBooking: () => void;
}

export function SimulatedPaymentPanel({
  booking,
  onBookingUpdated,
  onStartNewBooking,
}: SimulatedPaymentPanelProps) {
  const [processing, setProcessing] = useState<'SUCCESS' | 'FAILURE'>();
  const [failureMessage, setFailureMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const attemptRef = useRef<{ outcome: 'SUCCESS' | 'FAILURE'; key: string } | null>(null);

  async function processPayment(outcome: 'SUCCESS' | 'FAILURE'): Promise<void> {
    if (processing || booking.status !== 'PENDING_PAYMENT') return;
    if (!attemptRef.current || attemptRef.current.outcome !== outcome) {
      attemptRef.current = { outcome, key: crypto.randomUUID() };
    }
    setProcessing(outcome);
    setFailureMessage(undefined);
    setError(undefined);
    try {
      const result = await simulatePayment(
        {
          bookingId: booking.id,
          outcome,
          idempotencyKey: attemptRef.current.key,
        },
        getCheckoutSessionId(),
      );
      onBookingUpdated(result.booking);
      if (result.status === 'FAILED') {
        setFailureMessage(
          'Thanh toán mô phỏng thất bại. Ghế chưa được bán và bạn có thể thử lại trước khi hold hết hạn.',
        );
        attemptRef.current = null;
      }
    } catch (paymentError) {
      setError(paymentErrorMessage(paymentError));
    } finally {
      setProcessing(undefined);
    }
  }

  if (booking.status === 'PAID' || booking.status === 'TICKET_ISSUED') {
    return (
      <section className="booking-confirmation payment-confirmed" aria-labelledby="payment-title">
        <p className="eyebrow">Thanh toán hoàn tất</p>
        <h3 id="payment-title">{booking.bookingCode}</h3>
        <p role="status">
          Thanh toán thành công. Ghế của bạn đã được xác nhận và không thể bị người khác chọn.
        </p>
        <BookingSummary booking={booking} />
        <TicketDeliveryPanel bookingId={booking.id} />
        <div className="booking-completion-actions">
          {getStoredAuthSession()?.user.role === 'CUSTOMER' && (
            <Link className="booking-reset-action" href="/account/bookings">
              Mở Vé của tôi
            </Link>
          )}
          <button className="booking-reset-action" type="button" onClick={onStartNewBooking}>
            Đặt thêm vé
          </button>
        </div>
      </section>
    );
  }

  if (booking.status === 'EXPIRED') {
    return (
      <section className="booking-confirmation payment-expired" aria-labelledby="payment-title">
        <p className="eyebrow">Đơn đặt vé hết hạn</p>
        <h3 id="payment-title">{booking.bookingCode}</h3>
        <p role="status">Thời gian giữ ghế đã hết. Vui lòng chọn lại ghế để tạo đơn mới.</p>
        <button className="booking-reset-action" type="button" onClick={onStartNewBooking}>
          Chọn lại ghế
        </button>
      </section>
    );
  }

  return (
    <section className="booking-confirmation payment-pending" aria-labelledby="payment-title">
      <div className="payment-heading">
        <div>
          <p className="eyebrow">Thanh toán mô phỏng</p>
          <h3 id="payment-title">{booking.bookingCode}</h3>
        </div>
        <span>Chờ thanh toán</span>
      </div>
      <p>
        Đây là bước thanh toán mô phỏng, không phát sinh giao dịch thật. Giá vé và ghế được hệ thống
        kiểm tra lại trước khi xác nhận.
      </p>
      <BookingSummary booking={booking} />
      <div className="payment-actions" aria-busy={Boolean(processing)}>
        <button
          type="button"
          data-variant="failure"
          disabled={Boolean(processing)}
          onClick={() => void processPayment('FAILURE')}
        >
          {processing === 'FAILURE' ? 'Đang mô phỏng…' : 'Thanh toán thất bại'}
        </button>
        <button
          type="button"
          data-variant="success"
          disabled={Boolean(processing)}
          onClick={() => void processPayment('SUCCESS')}
        >
          {processing === 'SUCCESS' ? 'Đang xác nhận ghế…' : 'Thanh toán thành công'}
        </button>
      </div>
      {failureMessage ? (
        <p className="payment-feedback" role="status">
          {failureMessage}
        </p>
      ) : null}
      {error ? (
        <p className="seat-hold-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function BookingSummary({ booking }: { booking: GuestBooking }) {
  return (
    <dl>
      <div>
        <dt>Ghế</dt>
        <dd>{booking.passengers.map((passenger) => passenger.seatId).join(', ')}</dd>
      </div>
      <div>
        <dt>Hành khách</dt>
        <dd>{booking.passengers.length}</dd>
      </div>
      <div>
        <dt>Tổng tiền</dt>
        <dd>{formatMoney(booking.totalPriceVnd)}</dd>
      </div>
    </dl>
  );
}

function paymentErrorMessage(error: unknown): string {
  if (error instanceof BookingClientError && error.code === 'HOLD_EXPIRED') {
    return 'Thời gian giữ ghế đã hết. Đơn đặt vé không thể thanh toán.';
  }
  if (error instanceof BookingClientError && error.code === 'SEAT_UNAVAILABLE') {
    return 'Ghế không còn khả dụng để xác nhận. Vui lòng tạo đơn mới.';
  }
  if (error instanceof BookingClientError && error.code === 'INVALID_STATE_TRANSITION') {
    return 'Đơn đặt vé không còn ở trạng thái có thể thanh toán.';
  }
  return error instanceof Error ? error.message : 'Không thể xử lý thanh toán mô phỏng.';
}

const moneyFormatter = new Intl.NumberFormat('vi-VN', {
  style: 'currency',
  currency: 'VND',
  maximumFractionDigits: 0,
});

function formatMoney(value: number): string {
  return moneyFormatter.format(value);
}
