import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { CatalogApiError, getRoutePageData } from '../../lib/catalog-api';
import { SiteHeader } from '../../components/site-header';
import { TripCard } from '../../trips/trip-card';

interface RoutePageProps {
  params: Promise<{ routeSlug: string }>;
  searchParams: Promise<{ date?: string }>;
}

export async function generateMetadata({
  params,
  searchParams,
}: RoutePageProps): Promise<Metadata> {
  const { routeSlug } = await params;
  const { date } = await searchParams;
  const route = parseRouteSlug(routeSlug);
  if (!route || !date || !isLocalDate(date)) {
    return { title: 'Tuyến xe không tồn tại', robots: { index: false, follow: false } };
  }

  try {
    const data = await getRoutePageData(route.originCode, route.destinationCode, date);
    const formattedDate = formatLocalDate(date);
    return {
      title: `Vé xe ${data.origin.name} đi ${data.destination.name} ngày ${formattedDate}`,
      description: `Tìm chuyến xe ${data.origin.name} đi ${data.destination.name} ngày ${formattedDate}, xem giờ khởi hành, giá vé và số chỗ còn lại.`,
      alternates: { canonical: `/routes/${routeSlug}?date=${date}` },
    };
  } catch {
    return { title: 'Tuyến xe không tồn tại', robots: { index: false, follow: false } };
  }
}

export default async function RoutePage({ params, searchParams }: RoutePageProps) {
  const { routeSlug } = await params;
  const { date } = await searchParams;
  const route = parseRouteSlug(routeSlug);
  if (!route || !date || !isLocalDate(date)) notFound();

  try {
    const data = await getRoutePageData(route.originCode, route.destinationCode, date);
    return (
      <main className="results-page route-page">
        <SiteHeader />
        <div className="page-toolbar">
          <Link className="back-link" href="/#search">
            ← Tìm tuyến khác
          </Link>
          <span>Lịch chạy theo tuyến</span>
        </div>

        <section className="results-intro route-intro" aria-labelledby="route-title">
          <p className="eyebrow">Lịch chạy ngày {formatLocalDate(data.travelDate)}</p>
          <h1 id="route-title">
            {data.origin.name} <span aria-hidden="true">→</span> {data.destination.name}
          </h1>
          <p>So sánh giờ khởi hành, loại xe, giá vé và số ghế còn lại trên tuyến này.</p>
        </section>

        {data.trips.length ? (
          <section className="trip-list" aria-label={`${data.trips.length} chuyến xe trên tuyến`}>
            <div className="result-count">
              <span>{data.trips.length.toString().padStart(2, '0')}</span>
              <p>chuyến đang mở bán</p>
            </div>
            <ol>
              {data.trips.map((trip) => (
                <TripCard key={trip.id} trip={trip} />
              ))}
            </ol>
          </section>
        ) : (
          <section className="results-state" role="status">
            <strong>Ngày này chưa có chuyến phù hợp</strong>
            <span>Hãy chọn một ngày gần nhất đang có lịch chạy.</span>
            <div className="nearby-dates">
              {data.nearestTravelDates.map((nearestDate) => (
                <Link key={nearestDate} href={`/routes/${routeSlug}?date=${nearestDate}`}>
                  {formatLocalDate(nearestDate)}
                </Link>
              ))}
            </div>
          </section>
        )}
      </main>
    );
  } catch (error) {
    if (error instanceof CatalogApiError && error.code === 'NOT_FOUND') notFound();
    throw error;
  }
}

function parseRouteSlug(value: string): { originCode: string; destinationCode: string } | null {
  const match = /^([a-z0-9-]{2,16})-to-([a-z0-9-]{2,16})$/.exec(value);
  if (!match?.[1] || !match[2]) return null;
  return { originCode: match[1].toUpperCase(), destinationCode: match[2].toUpperCase() };
}

function isLocalDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return (
    date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() === Number(match[2]) - 1 &&
    date.getUTCDate() === Number(match[3])
  );
}

function formatLocalDate(value: string): string {
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
}
