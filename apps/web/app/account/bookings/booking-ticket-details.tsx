'use client';

import Image from 'next/image';
import { useState } from 'react';

import { authenticatedHeaders } from '../../lib/auth-session';

interface BookingTicket {
  id: string;
  ticketCode: string;
  bookingCode: string;
  passengerName: string;
  seatId: string;
  routeLabel: string;
  pickupName: string;
  dropoffName: string;
  departureAt: string;
  vehicleLabel: string;
  qrPayload: string;
  htmlContent: string;
  pdfBase64: string;
  issuedAt: string;
}

interface BookingTicketDelivery {
  bookingId: string;
  ready: boolean;
  tickets: BookingTicket[];
}

export function BookingTicketDetails({ bookingId }: { bookingId: string }) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [delivery, setDelivery] = useState<BookingTicketDelivery>();
  const [error, setError] = useState<string>();
  const panelId = `booking-ticket-details-${bookingId}`;

  async function toggleDetails() {
    if (expanded) {
      setExpanded(false);
      return;
    }

    setExpanded(true);
    if (delivery || loading) return;
    setLoading(true);
    setError(undefined);
    try {
      setDelivery(await fetchBookingTickets(bookingId));
    } catch (ticketError) {
      setError(
        ticketError instanceof Error ? ticketError.message : 'Không thể tải chi tiết vé lúc này.',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="booking-ticket-access">
      <button
        aria-controls={panelId}
        aria-expanded={expanded}
        className="booking-ticket-toggle"
        onClick={() => void toggleDetails()}
        type="button"
      >
        {expanded ? 'Ẩn chi tiết vé' : 'Xem chi tiết vé'}
      </button>

      {expanded && (
        <div className="booking-ticket-details" id={panelId} aria-live="polite">
          {loading && <p>Đang tải vé điện tử...</p>}
          {error && (
            <div className="booking-ticket-error" role="alert">
              <p>{error}</p>
              <button
                onClick={() => {
                  setExpanded(false);
                  setDelivery(undefined);
                  setError(undefined);
                }}
                type="button"
              >
                Thử lại
              </button>
            </div>
          )}
          {delivery && !delivery.ready && (
            <p>Vé đang được phát hành. Vui lòng quay lại sau ít phút.</p>
          )}
          {delivery?.ready && (
            <div className="booking-ticket-stack">
              {delivery.tickets.map((ticket) => {
                const qrDataUrl = ticketQrDataUrl(ticket.htmlContent);
                return (
                  <article className="booking-ticket-document" key={ticket.id}>
                    <div className="booking-ticket-copy">
                      <span>{ticket.ticketCode}</span>
                      <h3>{ticket.passengerName}</h3>
                      <p>{ticket.routeLabel}</p>
                      <dl>
                        <div>
                          <dt>Ghế</dt>
                          <dd>{ticket.seatId}</dd>
                        </div>
                        <div>
                          <dt>Khởi hành</dt>
                          <dd>{formatDateTime(ticket.departureAt)}</dd>
                        </div>
                        <div>
                          <dt>Phương tiện</dt>
                          <dd>{ticket.vehicleLabel}</dd>
                        </div>
                        <div>
                          <dt>Điểm đón</dt>
                          <dd>{ticket.pickupName}</dd>
                        </div>
                        <div>
                          <dt>Điểm trả</dt>
                          <dd>{ticket.dropoffName}</dd>
                        </div>
                      </dl>
                      <div className="booking-ticket-actions">
                        <a
                          download={`${ticket.ticketCode}.pdf`}
                          href={`data:application/pdf;base64,${ticket.pdfBase64}`}
                        >
                          Tải PDF
                        </a>
                        <a
                          href={`data:text/html;charset=utf-8,${encodeURIComponent(ticket.htmlContent)}`}
                          rel="noreferrer"
                          target="_blank"
                        >
                          Mở vé HTML
                        </a>
                      </div>
                    </div>
                    <div className="booking-ticket-qr">
                      {qrDataUrl ? (
                        <Image
                          alt={`Mã QR vé ${ticket.ticketCode}`}
                          height={180}
                          src={qrDataUrl}
                          unoptimized
                          width={180}
                        />
                      ) : (
                        <div className="booking-ticket-qr-placeholder">QR</div>
                      )}
                      <small>{ticket.qrPayload}</small>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ticketQrDataUrl(htmlContent: string): string | undefined {
  return htmlContent.match(/src=["'](data:image\/png;base64,[^"']+)["']/i)?.[1];
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

async function fetchBookingTickets(bookingId: string): Promise<BookingTicketDelivery> {
  const response = await fetch('/graphql', {
    method: 'POST',
    headers: authenticatedHeaders(),
    body: JSON.stringify({
      query: `query AccountBookingTickets($bookingId: ID!) {
        bookingTickets(bookingId: $bookingId) {
          bookingId ready
          tickets {
            id ticketCode bookingCode passengerName seatId routeLabel
            pickupName dropoffName departureAt vehicleLabel qrPayload
            htmlContent pdfBase64 issuedAt
          }
        }
      }`,
      variables: { bookingId },
    }),
  });
  const body = (await response.json()) as {
    data?: { bookingTickets: BookingTicketDelivery };
    errors?: Array<{ message: string }>;
  };
  const error = body.errors?.[0];
  if (!response.ok || error || !body.data) {
    throw new Error(error?.message ?? 'Không thể tải chi tiết vé lúc này.');
  }
  return body.data.bookingTickets;
}
