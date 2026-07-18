'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { type StoredAuthSession } from '../../lib/auth-session';
import { AdminClientError, authorizedGraphql, loadAuthorizedSession } from '../admin-client';
import { AdminPagination, AdminSearch, normalizeAdminSearch, pageItems } from '../admin-ui';

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

interface TripFilterCatalog {
  routes: Array<{ id: string; code: string }>;
  trips: Array<{
    id: string;
    routeId: string;
    departureAt: string;
    status: string;
    isActive: boolean;
  }>;
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
  adminCatalog {
    routes { id code }
    trips { id routeId departureAt status isActive }
  }
}`;

export function AdminOperationsConsole() {
  const searchParams = useSearchParams();
  const requestedTripId = searchParams.get('tripId')?.trim() ?? '';
  const [session, setSession] = useState<StoredAuthSession | null>(null);
  const [tripId, setTripId] = useState(requestedTripId);
  const [tripFilterCatalog, setTripFilterCatalog] = useState<TripFilterCatalog>({
    routes: [],
    trips: [],
  });
  const [data, setData] = useState<OperationsView | null>(null);
  const [revenue, setRevenue] = useState<RevenueSummaryView | null>(null);
  const [popularRoutes, setPopularRoutes] = useState<PopularRoutesView | null>(null);
  const [conversion, setConversion] = useState<SearchConversionView | null>(null);
  const [ticketSales, setTicketSales] = useState<TicketSalesView | null>(null);
  const [payment, setPayment] = useState<PaymentSummaryView | null>(null);
  const [bookingQuery, setBookingQuery] = useState('');
  const [bookingPage, setBookingPage] = useState(1);
  const [auditQuery, setAuditQuery] = useState('');
  const [auditPage, setAuditPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Đăng nhập quản trị để xem báo cáo và hoạt động gần đây.');

  useEffect(() => {
    void loadAuthorizedSession().then((stored) => {
      if (!stored) return;
      setSession(stored);
      void loadOperations(requestedTripId);
    });
  }, []);

  async function loadOperations(selectedTripId: string) {
    setBusy(true);
    try {
      const range = lastThirtyDays();
      const response = await authorizedGraphql<{
        adminOperations: OperationsView;
        adminRevenueSummary: RevenueSummaryView;
        adminPopularRoutes: PopularRoutesView;
        adminSearchConversion: SearchConversionView;
        adminTicketSalesByRoute: TicketSalesView;
        adminPaymentSummary: PaymentSummaryView;
        adminCatalog: TripFilterCatalog;
      }>(operationsQuery, {
        input: {
          ...(selectedTripId.trim() && { tripId: selectedTripId.trim() }),
          bookingLimit: 100,
          auditLimit: 100,
        },
        analyticsInput: range,
        popularInput: { ...range, limit: 5 },
      });
      const result = response.data;
      setSession(response.session);
      setData(result.adminOperations);
      setRevenue(result.adminRevenueSummary);
      setPopularRoutes(result.adminPopularRoutes);
      setConversion(result.adminSearchConversion);
      setTicketSales(result.adminTicketSalesByRoute);
      setPayment(result.adminPaymentSummary);
      setTripFilterCatalog(result.adminCatalog);
      setBookingPage(1);
      setAuditPage(1);
      setMessage(
        selectedTripId.trim()
          ? `Đang lọc theo chuyến ${selectedTripId.trim()}.`
          : 'Số liệu vận hành đã được cập nhật.',
      );
    } catch (error) {
      if (error instanceof AdminClientError && error.code === 'UNAUTHENTICATED') setSession(null);
      setMessage(error instanceof Error ? error.message : 'Không thể tải dữ liệu vận hành.');
    } finally {
      setBusy(false);
    }
  }

  const filteredBookings = useMemo(() => {
    const query = normalizeAdminSearch(bookingQuery);
    if (!data || !query) return data?.bookings ?? [];
    return data.bookings.filter((booking) =>
      normalizeAdminSearch(
        `${booking.bookingCode} ${booking.status} ${booking.trip.routeCode} ${booking.trip.originName} ${booking.trip.destinationName}`,
      ).includes(query),
    );
  }, [bookingQuery, data]);
  const filteredAuditEvents = useMemo(() => {
    const query = normalizeAdminSearch(auditQuery);
    if (!data || !query) return data?.auditEvents ?? [];
    return data.auditEvents.filter((event) =>
      normalizeAdminSearch(`${event.action} ${event.targetType} ${event.actorRole}`).includes(
        query,
      ),
    );
  }, [auditQuery, data]);
  const bookingPageItems = pageItems(filteredBookings, bookingPage);
  const auditPageItems = pageItems(filteredAuditEvents, auditPage);

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
          if (session) void loadOperations(tripId);
        }}
      >
        <label htmlFor="operations-trip-id">Lọc theo chuyến</label>
        <select
          id="operations-trip-id"
          value={tripId}
          onChange={(event) => setTripId(event.target.value)}
        >
          <option value="">Tất cả chuyến</option>
          {tripFilterOptions(tripFilterCatalog).map((trip) => (
            <option key={trip.id} value={trip.id}>
              {trip.label}
            </option>
          ))}
        </select>
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

          {revenue && (
            <section className="operations-ledger" aria-labelledby="daily-revenue-title">
              <div className="operations-section-heading">
                <span>DOANH THU</span>
                <h2 id="daily-revenue-title">Doanh thu theo ngày</h2>
              </div>
              {revenue.days.length === 0 ? (
                <p>Chưa có doanh thu trong khoảng thời gian này.</p>
              ) : (
                <div className="daily-revenue-list">
                  {revenue.days.map((day) => (
                    <article className="operations-row daily-revenue-row" key={day.localDate}>
                      <div>
                        <strong>{formatLocalDate(day.localDate)}</strong>
                        <span>{day.localDate}</span>
                      </div>
                      <div>
                        <strong>{day.revenueVnd.toLocaleString('vi-VN')} ₫</strong>
                        <span>
                          {day.paidBookingCount.toLocaleString('vi-VN')} đơn đã thanh toán ·{' '}
                          {day.ticketCount.toLocaleString('vi-VN')} vé
                        </span>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
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
              <AdminSearch
                label="Tìm booking, tuyến hoặc trạng thái"
                value={bookingQuery}
                onChange={(value) => {
                  setBookingQuery(value);
                  setBookingPage(1);
                }}
                resultCount={filteredBookings.length}
              />
              {filteredBookings.length === 0 ? (
                <p>Không có đơn đặt vé phù hợp.</p>
              ) : (
                bookingPageItems.map((booking) => (
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
              <AdminPagination
                page={bookingPage}
                totalItems={filteredBookings.length}
                onChange={setBookingPage}
              />
            </section>

            <section className="operations-ledger" aria-labelledby="audit-ledger-title">
              <div className="operations-section-heading">
                <span>HOẠT ĐỘNG</span>
                <h2 id="audit-ledger-title">Thao tác gần đây</h2>
              </div>
              <AdminSearch
                label="Tìm hành động, đối tượng hoặc vai trò"
                value={auditQuery}
                onChange={(value) => {
                  setAuditQuery(value);
                  setAuditPage(1);
                }}
                resultCount={filteredAuditEvents.length}
              />
              {filteredAuditEvents.length === 0 ? (
                <p>Chưa có hoạt động nào.</p>
              ) : (
                auditPageItems.map((event) => (
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
              <AdminPagination
                page={auditPage}
                totalItems={filteredAuditEvents.length}
                onChange={setAuditPage}
              />
            </section>
          </div>
        </>
      )}
    </section>
  );
}

function tripFilterOptions(catalog: TripFilterCatalog): Array<{ id: string; label: string }> {
  const routeCodes = new Map(catalog.routes.map((route) => [route.id, route.code]));
  return [...catalog.trips]
    .sort((left, right) => Date.parse(right.departureAt) - Date.parse(left.departureAt))
    .map((trip) => ({
      id: trip.id,
      label: `${routeCodes.get(trip.routeId) ?? 'Chuyến xe'} · ${formatDateTime(trip.departureAt)} · #${trip.id.slice(0, 8).toUpperCase()}${trip.isActive ? '' : ' · Tạm ngừng'}`,
    }));
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

function formatLocalDate(value: string): string {
  const [year, month, day] = value.split('-');
  return year && month && day ? `${day}/${month}/${year}` : value;
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
