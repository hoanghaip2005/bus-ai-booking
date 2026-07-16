'use client';

import { useEffect, useState } from 'react';

import { authenticatedHeaders, authStorageKey, getStoredAccessToken } from '../../lib/auth-session';

interface BookingHistoryItem {
  id: string;
  bookingCode: string;
  status: string;
  totalPriceVnd: number;
  createdAt: string;
  trip: {
    originName: string;
    destinationName: string;
    departureAt: string;
    operatorName: string;
  };
  passengers: Array<{ seatId: string; fullName: string }>;
}

interface BookingPage {
  nodes: BookingHistoryItem[];
  pageInfo: { endCursor?: string | null; hasNextPage: boolean };
}

export function BookingHistory() {
  const [bookings, setBookings] = useState<BookingHistoryItem[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [hasNextPage, setHasNextPage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [cancellingId, setCancellingId] = useState<string>();
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!getStoredAccessToken()) {
      setLoading(false);
      setMessage('Đăng nhập tài khoản CUSTOMER để xem lịch sử đặt vé.');
      return;
    }
    void loadPage();
  }, []);

  async function loadPage(after?: string) {
    setLoading(true);
    try {
      const page = await fetchMyBookings(after);
      setBookings((current) => (after ? [...current, ...page.nodes] : page.nodes));
      setCursor(page.pageInfo.endCursor ?? undefined);
      setHasNextPage(page.pageInfo.hasNextPage);
      setMessage(page.nodes.length === 0 && !after ? 'Bạn chưa có booking nào.' : '');
    } catch (error) {
      const failure = error as { code?: string; message?: string };
      if (failure.code === 'UNAUTHENTICATED') sessionStorage.removeItem(authStorageKey);
      setMessage(failure.message ?? 'Không thể tải lịch sử booking lúc này.');
    } finally {
      setLoading(false);
    }
  }

  async function cancel(booking: BookingHistoryItem) {
    setCancellingId(booking.id);
    setMessage('');
    try {
      const result = await cancelMyBooking(booking.id);
      setBookings((current) =>
        current.map((item) => (item.id === booking.id ? result.booking : item)),
      );
      setMessage(
        result.seatsReleased
          ? 'Đã hủy vé. Ghế đã được mở bán lại.'
          : 'Đã ghi nhận hủy vé; hệ thống đang đồng bộ lại ghế.',
      );
    } catch (error) {
      const failure = error as { code?: string; message?: string };
      if (failure.code === 'UNAUTHENTICATED') sessionStorage.removeItem(authStorageKey);
      setMessage(failure.message ?? 'Không thể hủy booking lúc này.');
    } finally {
      setCancellingId(undefined);
    }
  }

  return (
    <section className="booking-history" aria-live="polite">
      <div className="booking-history-heading">
        <div>
          <p className="eyebrow">Customer ownership · cancellation policy</p>
          <h1>Những hành trình thuộc về bạn.</h1>
        </div>
        <span>{bookings.length.toString().padStart(2, '0')} booking</span>
      </div>

      {bookings.length > 0 && (
        <div className="booking-history-list">
          {bookings.map((booking) => (
            <article className="booking-history-card" key={booking.id}>
              <div>
                <span className="booking-history-code">{booking.bookingCode}</span>
                <h2>
                  {booking.trip.originName} → {booking.trip.destinationName}
                </h2>
                <p>
                  {booking.trip.operatorName} ·{' '}
                  {new Date(booking.trip.departureAt).toLocaleString('vi-VN', {
                    timeZone: 'Asia/Ho_Chi_Minh',
                  })}
                </p>
              </div>
              <dl>
                <div>
                  <dt>Ghế</dt>
                  <dd>{booking.passengers.map((passenger) => passenger.seatId).join(', ')}</dd>
                </div>
                <div>
                  <dt>Trạng thái</dt>
                  <dd>{booking.status}</dd>
                </div>
                <div>
                  <dt>Tổng tiền</dt>
                  <dd>{booking.totalPriceVnd.toLocaleString('vi-VN')} ₫</dd>
                </div>
              </dl>
              {canCancel(booking) && (
                <div className="booking-cancellation">
                  <p>Được hủy trước giờ khởi hành; ghế sẽ được mở bán lại.</p>
                  <button
                    disabled={cancellingId === booking.id}
                    onClick={() => void cancel(booking)}
                    type="button"
                  >
                    {cancellingId === booking.id ? 'Đang hủy…' : 'Hủy booking'}
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      {message && <p className="booking-history-message">{message}</p>}
      {hasNextPage && cursor && (
        <button disabled={loading} onClick={() => void loadPage(cursor)} type="button">
          {loading ? 'Đang tải…' : 'Xem thêm booking'}
        </button>
      )}
      {!hasNextPage && bookings.length > 0 && (
        <p className="booking-history-end">Đã hết lịch sử.</p>
      )}
    </section>
  );
}

function canCancel(booking: BookingHistoryItem): boolean {
  return (
    (booking.status === 'PAID' || booking.status === 'TICKET_ISSUED') &&
    Date.parse(booking.trip.departureAt) > Date.now()
  );
}

async function fetchMyBookings(after?: string): Promise<BookingPage> {
  const response = await fetch('/graphql', {
    method: 'POST',
    headers: authenticatedHeaders(),
    body: JSON.stringify({
      query: `query MyBookings($first: Int!, $after: String) {
        myBookings(first: $first, after: $after) {
          nodes {
            id bookingCode status totalPriceVnd createdAt
            trip { originName destinationName departureAt operatorName }
            passengers { seatId fullName }
          }
          pageInfo { endCursor hasNextPage }
        }
      }`,
      variables: { first: 5, after: after ?? null },
    }),
  });
  const body = (await response.json()) as {
    data?: { myBookings: BookingPage };
    errors?: Array<{ message: string; extensions?: { code?: string } }>;
  };
  const error = body.errors?.[0];
  if (!response.ok || error || !body.data) {
    throw Object.assign(new Error(error?.message ?? 'Không thể tải lịch sử booking lúc này.'), {
      code: error?.extensions?.code,
    });
  }
  return body.data.myBookings;
}

async function cancelMyBooking(bookingId: string): Promise<{
  booking: BookingHistoryItem;
  cancelledAt: string;
  policyCode: string;
  seatsReleased: boolean;
}> {
  const response = await fetch('/graphql', {
    method: 'POST',
    headers: authenticatedHeaders(),
    body: JSON.stringify({
      query: `mutation CancelBooking($input: CancelBookingInput!) {
        cancelBooking(input: $input) {
          booking {
            id bookingCode status totalPriceVnd createdAt
            trip { originName destinationName departureAt operatorName }
            passengers { seatId fullName }
          }
          cancelledAt policyCode seatsReleased
        }
      }`,
      variables: { input: { bookingId, idempotencyKey: crypto.randomUUID() } },
    }),
  });
  const body = (await response.json()) as {
    data?: {
      cancelBooking: {
        booking: BookingHistoryItem;
        cancelledAt: string;
        policyCode: string;
        seatsReleased: boolean;
      };
    };
    errors?: Array<{ message: string; extensions?: { code?: string } }>;
  };
  const error = body.errors?.[0];
  if (!response.ok || error || !body.data) {
    throw Object.assign(new Error(error?.message ?? 'Không thể hủy booking lúc này.'), {
      code: error?.extensions?.code,
    });
  }
  return body.data.cancelBooking;
}
