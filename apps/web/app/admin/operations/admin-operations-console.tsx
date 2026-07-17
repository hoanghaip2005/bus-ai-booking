'use client';

import { useEffect, useState } from 'react';

import { authStorageKey } from '../../lib/auth-session';

interface Session {
  accessToken: string;
  user: { displayName: string; role: 'CUSTOMER' | 'STAFF' | 'ADMIN' };
}

interface BookingView {
  id: string;
  bookingCode: string;
  status: string;
  totalPriceVnd: number;
  createdAt: string;
  trip: { tripId: string; routeCode: string; originName: string; destinationName: string };
  passengers: Array<{ id: string }>;
}

interface OperationsView {
  bookings: BookingView[];
  summary: {
    bookingCount: number;
    passengerCount: number;
    revenueVnd: number;
    statusCounts: Array<{ status: string; count: number }>;
  };
  auditEvents: Array<{
    id: string;
    action: string;
    targetType: string;
    targetId: string;
    actorRole: string;
    occurredAt: string;
    traceId: string;
  }>;
}

interface RevenueSummaryView {
  days: Array<{
    localDate: string;
    revenueVnd: number;
    paidBookingCount: number;
    ticketCount: number;
  }>;
  totalRevenueVnd: number;
  paidBookingCount: number;
  ticketCount: number;
  lastProcessedAt?: string | null;
  timezone: string;
}

interface PopularRoutesView {
  routes: Array<{
    routeId: string;
    routeCode: string;
    routeLabel: string;
    searchCount: number;
    paidBookingCount: number;
    conversionRate: number;
  }>;
}

interface SearchConversionView {
  searchCount: number;
  paidBookingCount: number;
  conversionRate: number;
  lastProcessedAt?: string | null;
}

interface TicketSalesView {
  routes: Array<{
    routeId: string;
    routeCode: string;
    routeLabel: string;
    paidBookingCount: number;
    ticketCount: number;
    revenueVnd: number;
  }>;
}

interface PaymentSummaryView {
  attemptCount: number;
  succeededCount: number;
  failedCount: number;
  successRate: number;
  succeededAmountVnd: number;
  consumerLag: {
    available: boolean;
    totalLag: number;
    topics: Array<{ topic: string; lag: number }>;
  };
}

const operationsQuery = `query AdminOperations($input: AdminOperationsInput!, $analyticsInput: AnalyticsDateRangeInput!, $popularInput: PopularRoutesInput!) {
  adminOperations(input: $input) {
    summary { bookingCount passengerCount revenueVnd statusCounts { status count } }
    bookings {
      id bookingCode status totalPriceVnd createdAt
      trip { tripId routeCode originName destinationName }
      passengers { id }
    }
    auditEvents { id action targetType targetId actorRole occurredAt traceId }
  }
  adminRevenueSummary(input: $analyticsInput) {
    totalRevenueVnd paidBookingCount ticketCount lastProcessedAt timezone
    days { localDate revenueVnd paidBookingCount ticketCount }
  }
  adminPopularRoutes(input: $popularInput) {
    routes { routeId routeCode routeLabel searchCount paidBookingCount conversionRate }
  }
  adminSearchConversion(input: $analyticsInput) {
    searchCount paidBookingCount conversionRate lastProcessedAt
  }
  adminTicketSalesByRoute(input: $popularInput) {
    routes { routeId routeCode routeLabel paidBookingCount ticketCount revenueVnd }
  }
  adminPaymentSummary(input: $analyticsInput) {
    attemptCount succeededCount failedCount successRate succeededAmountVnd
    consumerLag { available totalLag topics { topic lag } }
  }
}`;

export function AdminOperationsConsole() {
  const [session, setSession] = useState<Session | null>(null);
  const [tripId, setTripId] = useState('');
  const [data, setData] = useState<OperationsView | null>(null);
  const [revenue, setRevenue] = useState<RevenueSummaryView | null>(null);
  const [popularRoutes, setPopularRoutes] = useState<PopularRoutesView | null>(null);
  const [conversion, setConversion] = useState<SearchConversionView | null>(null);
  const [ticketSales, setTicketSales] = useState<TicketSalesView | null>(null);
  const [payment, setPayment] = useState<PaymentSummaryView | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Đăng nhập quản trị để xem báo cáo và hoạt động gần đây.');

  useEffect(() => {
    const raw = sessionStorage.getItem(authStorageKey);
    if (!raw) return;
    try {
      const stored = JSON.parse(raw) as Session;
      if (stored.user.role !== 'ADMIN') return;
      setSession(stored);
      void loadOperations(stored, '');
    } catch {
      sessionStorage.removeItem(authStorageKey);
    }
  }, []);

  async function loadOperations(activeSession: Session, selectedTripId: string) {
    setBusy(true);
    try {
      const range = lastThirtyDays();
      const result = await adminGraphql<{
        adminOperations: OperationsView;
        adminRevenueSummary: RevenueSummaryView;
        adminPopularRoutes: PopularRoutesView;
        adminSearchConversion: SearchConversionView;
        adminTicketSalesByRoute: TicketSalesView;
        adminPaymentSummary: PaymentSummaryView;
      }>(
        operationsQuery,
        {
          input: {
            ...(selectedTripId.trim() && { tripId: selectedTripId.trim() }),
            bookingLimit: 50,
            auditLimit: 50,
          },
          analyticsInput: range,
          popularInput: { ...range, limit: 5 },
        },
        activeSession.accessToken,
      );
      setData(result.adminOperations);
      setRevenue(result.adminRevenueSummary);
      setPopularRoutes(result.adminPopularRoutes);
      setConversion(result.adminSearchConversion);
      setTicketSales(result.adminTicketSalesByRoute);
      setPayment(result.adminPaymentSummary);
      setMessage(
        selectedTripId.trim()
          ? `Đang lọc theo chuyến ${selectedTripId.trim()}.`
          : 'Số liệu vận hành đã được cập nhật.',
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể tải dữ liệu vận hành.');
    } finally {
      setBusy(false);
    }
  }

  if (!session) {
    return (
      <section className="operations-shell" aria-labelledby="operations-title">
        <div className="operations-heading">
          <div>
            <p className="eyebrow">Tổng quan kinh doanh</p>
            <h1 id="operations-title">Theo dõi đặt vé và doanh thu trong một màn hình.</h1>
          </div>
          <span>Chưa đăng nhập</span>
        </div>
        <div className="account-access-state">
          <strong>Đăng nhập để xem báo cáo vận hành</strong>
          <p>{message}</p>
          <a href="/login">Đăng nhập quản trị</a>
        </div>
      </section>
    );
  }

  return (
    <section className="operations-shell" aria-labelledby="operations-title">
      <div className="operations-heading">
        <div>
          <p className="eyebrow">Tổng quan kinh doanh</p>
          <h1 id="operations-title">Theo dõi đặt vé và doanh thu trong một màn hình.</h1>
        </div>
        <span>{session?.user.displayName ?? 'Chưa đăng nhập'}</span>
      </div>

      <form
        className="operations-filter"
        onSubmit={(event) => {
          event.preventDefault();
          if (session) void loadOperations(session, tripId);
        }}
      >
        <label htmlFor="operations-trip-id">Lọc theo mã chuyến</label>
        <input
          id="operations-trip-id"
          value={tripId}
          onChange={(event) => setTripId(event.target.value)}
          placeholder="Nhập mã chuyến cần xem"
        />
        <button type="submit" disabled={!session || busy}>
          {busy ? 'Đang tải…' : 'Áp dụng'}
        </button>
      </form>

      <p className="operations-message" role="status" aria-live="polite">
        {message}
      </p>

      {data && (
        <>
          <div className="operations-metrics" aria-label="Tổng quan đặt vé">
            <Metric label="Đơn đặt vé" value={data.summary.bookingCount.toLocaleString('vi-VN')} />
            <Metric
              label="Hành khách"
              value={data.summary.passengerCount.toLocaleString('vi-VN')}
            />
            <Metric
              label="Doanh thu ghi nhận"
              value={`${data.summary.revenueVnd.toLocaleString('vi-VN')} ₫`}
            />
            {revenue && (
              <Metric
                label="Doanh thu 30 ngày"
                value={`${revenue.totalRevenueVnd.toLocaleString('vi-VN')} ₫`}
              />
            )}
            {conversion && (
              <Metric
                label="Tỷ lệ đặt vé thành công"
                value={`${conversion.conversionRate.toFixed(2)}%`}
              />
            )}
            {payment && (
              <Metric label="Thanh toán thành công" value={`${payment.successRate.toFixed(2)}%`} />
            )}
          </div>

          {revenue && (
            <p className="operations-message">
              {revenue.paidBookingCount.toLocaleString('vi-VN')} đặt vé đã thanh toán ·{' '}
              {revenue.ticketCount.toLocaleString('vi-VN')} vé đã phát hành · cập nhật{' '}
              {revenue.lastProcessedAt
                ? formatDateTime(revenue.lastProcessedAt)
                : 'chưa có dữ liệu'}
              .
            </p>
          )}

          {popularRoutes && (
            <section className="operations-ledger" aria-labelledby="popular-routes-title">
              <div className="operations-section-heading">
                <span>NHU CẦU</span>
                <h2 id="popular-routes-title">Tuyến được quan tâm nhiều</h2>
              </div>
              {popularRoutes.routes.length === 0 ? (
                <p>Chưa có dữ liệu tìm kiếm trong khoảng thời gian này.</p>
              ) : (
                popularRoutes.routes.map((route) => (
                  <article key={route.routeId} className="operations-row">
                    <div>
                      <strong>{route.routeLabel}</strong>
                      <span>{route.routeCode || 'Chưa có mã tuyến'}</span>
                    </div>
                    <div>
                      <strong>{route.searchCount.toLocaleString('vi-VN')} lượt tìm</strong>
                      <span>
                        {route.paidBookingCount.toLocaleString('vi-VN')} đặt vé · chuyển đổi{' '}
                        {route.conversionRate.toFixed(2)}%
                      </span>
                    </div>
                  </article>
                ))
              )}
            </section>
          )}

          {ticketSales && (
            <section className="operations-ledger" aria-labelledby="ticket-sales-title">
              <div className="operations-section-heading">
                <span>DOANH SỐ</span>
                <h2 id="ticket-sales-title">Vé bán theo tuyến</h2>
              </div>
              {ticketSales.routes.length === 0 ? (
                <p>Chưa có vé bán trong cửa sổ thống kê.</p>
              ) : (
                ticketSales.routes.map((route) => (
                  <article key={route.routeId} className="operations-row">
                    <div>
                      <strong>{route.routeLabel}</strong>
                      <span>{route.routeCode}</span>
                    </div>
                    <div>
                      <strong>{route.ticketCount.toLocaleString('vi-VN')} vé</strong>
                      <span>
                        {route.paidBookingCount.toLocaleString('vi-VN')} đơn đặt vé ·{' '}
                        {route.revenueVnd.toLocaleString('vi-VN')} ₫
                      </span>
                    </div>
                  </article>
                ))
              )}
            </section>
          )}

          <div className="operations-ledger-grid">
            <section className="operations-ledger" aria-labelledby="booking-ledger-title">
              <div className="operations-section-heading">
                <span>ĐẶT VÉ</span>
                <h2 id="booking-ledger-title">Đơn đặt vé gần nhất</h2>
              </div>
              {data.bookings.length === 0 ? (
                <p>Không có đơn đặt vé phù hợp.</p>
              ) : (
                data.bookings.map((booking) => (
                  <article key={booking.id} className="operations-row">
                    <div>
                      <strong>{booking.bookingCode}</strong>
                      <span>
                        {booking.trip.routeCode} · {booking.trip.originName} →{' '}
                        {booking.trip.destinationName}
                      </span>
                    </div>
                    <div>
                      <strong>{bookingStatusLabel(booking.status)}</strong>
                      <span>
                        {booking.passengers.length} khách ·{' '}
                        {booking.totalPriceVnd.toLocaleString('vi-VN')} ₫
                      </span>
                    </div>
                  </article>
                ))
              )}
            </section>

            <section className="operations-ledger" aria-labelledby="audit-ledger-title">
              <div className="operations-section-heading">
                <span>HOẠT ĐỘNG</span>
                <h2 id="audit-ledger-title">Thao tác gần đây</h2>
              </div>
              {data.auditEvents.length === 0 ? (
                <p>Chưa có hoạt động nào.</p>
              ) : (
                data.auditEvents.map((event) => (
                  <article key={event.id} className="operations-row">
                    <div>
                      <strong>{actionLabel(event.action)}</strong>
                      <span>{targetTypeLabel(event.targetType)}</span>
                    </div>
                    <div>
                      <strong>{roleLabel(event.actorRole)}</strong>
                      <span>{formatDateTime(event.occurredAt)}</span>
                    </div>
                  </article>
                ))
              )}
            </section>
          </div>
        </>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <article>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function bookingStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    DRAFT: 'Nháp',
    PENDING_PAYMENT: 'Chờ thanh toán',
    PAID: 'Đã thanh toán',
    TICKET_ISSUED: 'Đã có vé',
    CHECKED_IN: 'Đã lên xe',
    COMPLETED: 'Hoàn tất',
    CANCELLED: 'Đã hủy',
    EXPIRED: 'Hết hạn',
  };
  return labels[status] ?? status;
}

function roleLabel(role: string): string {
  if (role === 'ADMIN') return 'Quản trị viên';
  if (role === 'STAFF') return 'Nhân viên';
  if (role === 'CUSTOMER') return 'Khách hàng';
  if (role === 'SYSTEM') return 'Hệ thống';
  return 'Không xác định';
}

function targetTypeLabel(type: string): string {
  if (type === 'LOCATION') return 'Điểm đón/trả';
  if (type === 'ROUTE') return 'Tuyến xe';
  if (type === 'VEHICLE') return 'Xe';
  if (type === 'SEAT_LAYOUT') return 'Sơ đồ ghế';
  if (type === 'TRIP') return 'Chuyến xe';
  if (type === 'BOOKING') return 'Đơn đặt vé';
  if (type === 'TICKET') return 'Vé';
  return 'Bản ghi vận hành';
}

function actionLabel(action: string): string {
  const labels: Record<string, string> = {
    BOOKING_PAID: 'Đặt vé đã thanh toán',
    BOOKING_CANCELLED: 'Đặt vé đã hủy',
    TICKET_CHECKED_IN: 'Hành khách đã check-in',
    TRIP_CREATED: 'Đã tạo chuyến xe',
  };
  return labels[action] ?? 'Đã cập nhật dữ liệu vận hành';
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

async function adminGraphql<T>(
  query: string,
  variables: Record<string, unknown>,
  token: string,
): Promise<T> {
  const response = await fetch('/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
  });
  const body = (await response.json()) as {
    data?: T;
    errors?: Array<{ message: string }>;
  };
  if (!response.ok || body.errors?.[0] || body.data === undefined) {
    throw new Error(body.errors?.[0]?.message ?? 'Không thể tải dữ liệu vận hành.');
  }
  return body.data;
}

function lastThirtyDays(): { fromDate: string; toDate: string } {
  const today = new Date();
  const from = new Date(today);
  from.setDate(from.getDate() - 29);
  return { fromDate: localDate(from), toDate: localDate(today) };
}

function localDate(value: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}
