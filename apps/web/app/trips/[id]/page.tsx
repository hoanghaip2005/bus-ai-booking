import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { CatalogApiError, getSeatMap, getTripDetail, type TripDetail } from '../../lib/catalog-api';
import { SeatSelector } from './seat-selector';

interface TripDetailPageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: TripDetailPageProps): Promise<Metadata> {
  const { id } = await params;
  if (!isUuid(id)) return { title: 'Chuyến xe không tồn tại', robots: { index: false } };
  try {
    const trip = await getTripDetail(id);
    return {
      title: `${trip.originName} đi ${trip.destinationName} · ${formatDateTime(trip.departureAt)}`,
      description: `${trip.operatorName}, ${trip.vehicleTypeName}, khởi hành ${formatDateTime(trip.departureAt)}, giá ${formatMoney(trip.priceVnd)}.`,
    };
  } catch {
    return { title: 'Chuyến xe không tồn tại', robots: { index: false, follow: false } };
  }
}

export default async function TripDetailPage({ params }: TripDetailPageProps) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  try {
    const [trip, seatMap] = await Promise.all([getTripDetail(id), getSeatMap(id)]);
    return (
      <main className="trip-detail-page">
        <header className="results-header trip-detail-header">
          <Brand />
          <Link className="back-link" href="/#search">
            Tìm chuyến khác
          </Link>
        </header>

        <section className="trip-detail-hero" aria-labelledby="trip-detail-title">
          <div>
            <p className="eyebrow">
              {trip.operatorName} · {trip.status}
            </p>
            <h1 id="trip-detail-title">
              {trip.originName} <span aria-hidden="true">→</span> {trip.destinationName}
            </h1>
            <p>
              {trip.vehicleTypeName} · Mã xe {trip.vehicleCode} · Biển số {trip.vehiclePlate}
            </p>
          </div>
          <aside className="trip-detail-price" aria-label="Giá vé và chỗ còn lại">
            <span>Giá một hành khách</span>
            <strong>{formatMoney(trip.priceVnd)}</strong>
            <small>{trip.remainingSeats} chỗ đang mở bán</small>
            <a href="#seat-preview-title">Chọn ghế</a>
          </aside>
        </section>

        <section className="trip-facts" aria-label="Thông tin hành trình">
          <Fact label="Khởi hành" value={formatDateTime(trip.departureAt)} />
          <Fact label="Dự kiến đến" value={formatDateTime(trip.arrivalAt)} />
          <Fact label="Thời gian chạy" value={formatDuration(trip.durationMinutes)} />
          <Fact label="Múi giờ" value="Asia/Ho_Chi_Minh" />
        </section>

        <div className="trip-detail-grid">
          <section className="detail-panel" aria-labelledby="schedule-title">
            <p className="eyebrow">Lịch trình</p>
            <h2 id="schedule-title">Điểm đón và trả khách</h2>
            <ol className="stop-list">
              {trip.stops.map((stop) => (
                <li key={stop.id}>
                  <time dateTime={stop.scheduledAt}>{formatTime(stop.scheduledAt)}</time>
                  <div>
                    <strong>{stop.name}</strong>
                    <span>
                      {stopLabel(stop.kind)} · thứ tự {stop.stopOrder}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section className="detail-panel" aria-labelledby="seat-preview-title">
            <p className="eyebrow">Chọn chỗ</p>
            <h2 id="seat-preview-title">{seatMap.layoutName}</h2>
            <p className="panel-note">
              Bản sơ đồ v{seatMap.layoutVersion}. Mỗi lần giữ tối đa 10 ghế trong 5 phút; tải lại
              trang vẫn khôi phục hold của checkout session này.
            </p>
            <SeatSelector tripId={trip.id} initialSeatMap={seatMap} unitPriceVnd={trip.priceVnd} />
          </section>
        </div>

        <section className="policy-section" aria-labelledby="policy-title">
          <p className="eyebrow">Trước khi lên xe</p>
          <h2 id="policy-title">Chính sách áp dụng</h2>
          <div className="policy-list">
            {trip.policies.map((policy) => (
              <article key={policy.code}>
                <span>{policy.code}</span>
                <h3>{policy.title}</h3>
                <p>{policy.summary}</p>
                <small>{policy.resourceUri}</small>
              </article>
            ))}
          </div>
        </section>
      </main>
    );
  } catch (error) {
    if (error instanceof CatalogApiError && error.code === 'NOT_FOUND') notFound();
    throw error;
  }
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Brand() {
  return (
    <Link className="brand" href="/" aria-label="Bến Việt - về trang tìm chuyến">
      <span className="brand-mark" aria-hidden="true">
        BV
      </span>
      <span>
        <strong>Bến Việt</strong>
        <small>Đi xa, nhẹ đầu.</small>
      </span>
    </Link>
  );
}

const dateTimeFormatter = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const timeFormatter = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const moneyFormatter = new Intl.NumberFormat('vi-VN', {
  style: 'currency',
  currency: 'VND',
  maximumFractionDigits: 0,
});

function formatDateTime(value: string): string {
  return dateTimeFormatter.format(new Date(value));
}
function formatTime(value: string): string {
  return timeFormatter.format(new Date(value));
}
function formatMoney(value: number): string {
  return moneyFormatter.format(value);
}
function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours} giờ ${remainder} phút` : `${hours} giờ`;
}
function stopLabel(kind: TripDetail['stops'][number]['kind']): string {
  if (kind === 'PICKUP') return 'Điểm đón';
  if (kind === 'DROPOFF') return 'Điểm trả';
  return 'Điểm đón/trả';
}
function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
