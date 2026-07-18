import Link from 'next/link';

import { getRoutePageData } from '../lib/catalog-api';
import { displayOperatorName } from '../lib/display';
import type { TripSummary } from '../trips/trip-card';
import { PopularRouteLinks } from './popular-route-links';

const popularRoutes = [
  {
    label: 'TP.HCM → Đà Lạt',
    slug: 'hcm-to-dli',
    originCode: 'HCM',
    destinationCode: 'DLI',
  },
  {
    label: 'Đà Lạt → TP.HCM',
    slug: 'dli-to-hcm',
    originCode: 'DLI',
    destinationCode: 'HCM',
  },
  {
    label: 'TP.HCM → Nha Trang',
    slug: 'hcm-to-ntr',
    originCode: 'HCM',
    destinationCode: 'NTR',
  },
] as const;

interface FeaturedTrip {
  routeSlug: string;
  trip: TripSummary;
}

export async function HomeFeaturedTrips() {
  const travelDate = currentTravelDate();
  const featuredTrips = await loadFeaturedTrips(travelDate);

  return (
    <section
      className="route-highlights"
      id="popular-routes"
      aria-labelledby="route-highlights-title"
    >
      <div className="route-highlights-heading">
        <div>
          <p className="eyebrow">Tuyến được yêu thích</p>
          <h2 id="route-highlights-title">Chuyến gần nhất đang mở bán.</h2>
          <p>Lịch chạy ngày {formatLocalDate(travelDate)}, cập nhật từ số ghế còn bán.</p>
        </div>
        <PopularRouteLinks routes={popularRoutes} />
      </div>

      {featuredTrips.length ? (
        <ol className="home-trip-board" aria-label="Các chuyến gần nhất đang mở bán">
          {featuredTrips.map(({ routeSlug, trip }, index) => (
            <li className="home-trip-card" key={trip.id}>
              <span className="home-trip-index" aria-hidden="true">
                {(index + 1).toString().padStart(2, '0')}
              </span>
              <div className="home-trip-route">
                <h3>
                  {trip.originName} <span aria-hidden="true">→</span> {trip.destinationName}
                </h3>
                <p>
                  {displayOperatorName(trip.operatorName)} · {trip.vehicleTypeName}
                </p>
                <Link href={`/routes/${routeSlug}?date=${travelDate}`}>Xem tất cả chuyến</Link>
              </div>
              <div className="home-trip-departure">
                <span>Khởi hành</span>
                <time dateTime={trip.departureAt}>{formatTime(trip.departureAt)}</time>
                <small>{trip.pickupName}</small>
              </div>
              <div className="home-trip-fare">
                <strong>{formatMoney(trip.priceVnd)}</strong>
                <span>{trip.remainingSeats} ghế còn lại</span>
                <Link
                  href={`/trips/${trip.id}`}
                  aria-label={`Chọn chuyến ${trip.originName} đi ${trip.destinationName} lúc ${formatTime(trip.departureAt)}`}
                >
                  Chọn chuyến <span aria-hidden="true">↗</span>
                </Link>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <div className="home-trip-empty" role="status">
          <strong>Lịch chuyến đang được cập nhật.</strong>
          <span>Chọn một tuyến phổ biến để xem ngày gần nhất đang có chuyến.</span>
        </div>
      )}
    </section>
  );
}

async function loadFeaturedTrips(travelDate: string): Promise<FeaturedTrip[]> {
  const featured = await Promise.all(
    popularRoutes.map(async (route): Promise<FeaturedTrip | null> => {
      try {
        const data = await getRoutePageData(route.originCode, route.destinationCode, travelDate);
        const trip = [...data.trips]
          .filter((candidate) => candidate.remainingSeats > 0)
          .sort((left, right) => Date.parse(left.departureAt) - Date.parse(right.departureAt))[0];
        return trip ? { routeSlug: route.slug, trip } : null;
      } catch {
        return null;
      }
    }),
  );
  return featured.filter((item): item is FeaturedTrip => item !== null);
}

const localDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ho_Chi_Minh',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const localDisplayDateFormatter = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
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

function currentTravelDate(): string {
  return localDateFormatter.format(new Date());
}

function formatLocalDate(value: string): string {
  return localDisplayDateFormatter.format(new Date(`${value}T00:00:00+07:00`));
}

function formatTime(value: string): string {
  return timeFormatter.format(new Date(value));
}

function formatMoney(value: number): string {
  return moneyFormatter.format(value);
}
