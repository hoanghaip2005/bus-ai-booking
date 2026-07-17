'use client';

import { useEffect, useState } from 'react';

import { getCheckoutSessionId } from './checkout-session';
import { getBookingTickets, type BookingTicketDelivery } from './ticket-client';

export function TicketDeliveryPanel({ bookingId }: { bookingId: string }) {
  const [delivery, setDelivery] = useState<BookingTicketDelivery>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    const poll = async () => {
      attempts += 1;
      try {
        const next = await getBookingTickets(bookingId, getCheckoutSessionId());
        if (cancelled) return;
        setDelivery(next);
        setError(undefined);
        if (!next.ready && attempts < 20) timer = setTimeout(() => void poll(), 600);
      } catch (ticketError) {
        if (cancelled) return;
        setError(ticketError instanceof Error ? ticketError.message : 'Không thể tải vé điện tử.');
        if (attempts < 20) timer = setTimeout(() => void poll(), 900);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [bookingId]);

  if (delivery?.ready) {
    return (
      <div className="ticket-delivery" aria-live="polite">
        <div className="ticket-delivery-heading">
          <div>
            <span>Vé đã phát hành</span>
            <strong>{delivery.tickets.length} vé điện tử sẵn sàng</strong>
          </div>
          <span className="ticket-ready-dot" aria-hidden="true" />
        </div>
        <div className="ticket-document-list">
          {delivery.tickets.map((ticket) => (
            <article key={ticket.id} className="ticket-document-card">
              <div>
                <span>Ghế {ticket.seatId}</span>
                <strong>{ticket.passengerName}</strong>
                <small>{ticket.ticketCode}</small>
              </div>
              <div className="ticket-document-actions">
                <a
                  href={`data:application/pdf;base64,${ticket.pdfBase64}`}
                  download={`${ticket.ticketCode}.pdf`}
                >
                  Tải PDF
                </a>
                <a
                  href={`data:text/html;charset=utf-8,${encodeURIComponent(ticket.htmlContent)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Mở vé HTML
                </a>
              </div>
            </article>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="ticket-delivery ticket-delivery-pending" role="status">
      <span className="ticket-pulse" aria-hidden="true" />
      <p>
        {error
          ? 'Vé đang được tải lại. Bạn vui lòng chờ thêm một chút.'
          : 'Vé điện tử đang được chuẩn bị…'}
      </p>
    </div>
  );
}
