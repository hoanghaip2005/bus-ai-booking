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
  const [message, setMessage] = useState('Đăng nhập ADMIN để đọc sổ vận hành Booking.');

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
          ? `Đang lọc theo trip ${selectedTripId.trim()}.`
          : 'Dữ liệu được đọc trực tiếp từ Booking Service, không join chéo database.',
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể tải dữ liệu vận hành.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="operations-shell" aria-labelledby="operations-title">
      <div className="operations-heading">
        <div>
          <p className="eyebrow">Milestone 5 · Operational read model</p>
          <h1 id="operations-title">Booking và audit trên cùng một bàn điều hành.</h1>
        </div>
        <span>{session?.user.displayName ?? 'Chưa xác thực ADMIN'}</span>
      </div>

      <form
        className="operations-filter"
        onSubmit={(event) => {
          event.preventDefault();
          if (session) void loadOperations(session, tripId);
        }}
      >
        <label htmlFor="operations-trip-id">Trip ID tùy chọn</label>
        <input
          id="operations-trip-id"
          value={tripId}
          onChange={(event) => setTripId(event.target.value)}
          placeholder="Lọc booking và audit theo chuyến"
        />
        <button type="submit" disabled={!session || busy}>
          {busy ? 'Đang tải…' : 'Áp dụng'}
        </button>
        {!session && <a href="/login">Đăng nhập ADMIN</a>}
      </form>

      <p className="operations-message" role="status" aria-live="polite">
        {message}
      </p>

      {data && (
        <>
          <div className="operations-metrics" aria-label="Tổng quan booking">
            <Metric label="Booking" value={data.summary.bookingCount.toLocaleString('vi-VN')} />
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
                label="Kafka · 30 ngày"
                value={`${revenue.totalRevenueVnd.toLocaleString('vi-VN')} ₫`}
              />
            )}
            {conversion && (
              <Metric label="Search → paid" value={`${conversion.conversionRate.toFixed(2)}%`} />
            )}
            {payment && (
              <Metric label="Payment success" value={`${payment.successRate.toFixed(2)}%`} />
            )}
            {payment && (
              <Metric
                label="Kafka consumer lag"
                value={
                  payment.consumerLag.available
                    ? payment.consumerLag.totalLag.toLocaleString('vi-VN')
                    : 'N/A'
                }
              />
            )}
          </div>

          {revenue && (
            <p className="operations-message">
              Analytics projection: {revenue.paidBookingCount.toLocaleString('vi-VN')} booking ·{' '}
              {revenue.ticketCount.toLocaleString('vi-VN')} vé · cập nhật{' '}
              {revenue.lastProcessedAt ? formatDateTime(revenue.lastProcessedAt) : 'chưa có event'}.
            </p>
          )}

          {popularRoutes && (
            <section className="operations-ledger" aria-labelledby="popular-routes-title">
              <div className="operations-section-heading">
                <span>ANALYTICS / ROUTES</span>
                <h2 id="popular-routes-title">Tuyến được quan tâm nhiều</h2>
              </div>
              {popularRoutes.routes.length === 0 ? (
                <p>Chưa có route match trong cửa sổ thống kê.</p>
              ) : (
                popularRoutes.routes.map((route) => (
                  <article key={route.routeId} className="operations-row">
                    <div>
                      <strong>{route.routeLabel}</strong>
                      <span>{route.routeCode || route.routeId}</span>
                    </div>
                    <div>
                      <strong>{route.searchCount.toLocaleString('vi-VN')} lượt tìm</strong>
                      <span>
                        {route.paidBookingCount.toLocaleString('vi-VN')} paid ·{' '}
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
                <span>ANALYTICS / TICKET SALES</span>
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
                        {route.paidBookingCount.toLocaleString('vi-VN')} booking ·{' '}
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
                <span>OPS / BOOKINGS</span>
                <h2 id="booking-ledger-title">Booking gần nhất</h2>
              </div>
              {data.bookings.length === 0 ? (
                <p>Không có booking phù hợp.</p>
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
                      <strong>{booking.status}</strong>
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
                <span>OPS / AUDIT</span>
                <h2 id="audit-ledger-title">Dấu vết thao tác</h2>
              </div>
              {data.auditEvents.length === 0 ? (
                <p>Chưa có audit event.</p>
              ) : (
                data.auditEvents.map((event) => (
                  <article key={event.id} className="operations-row">
                    <div>
                      <strong>{event.action}</strong>
                      <span>
                        {event.targetType} · {event.targetId}
                      </span>
                    </div>
                    <div>
                      <strong>{event.actorRole}</strong>
                      <span>
                        {formatDateTime(event.occurredAt)} · trace {event.traceId.slice(0, 8)}
                      </span>
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
