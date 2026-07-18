'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { SiteHeader } from '../components/site-header';
import { SiteFooter } from '../components/site-footer';
import { readGraphQlResponse } from '../lib/graphql-client';
import { TripFilters } from './trip-filters';
import { TripCard, type TripSummary } from './trip-card';

interface TripSearchResponse {
  data?: {
    searchTrips: { trips: TripSummary[]; timezone: string; nearestTravelDates: string[] };
  };
  errors?: Array<{ message: string }>;
}

export function TripResults() {
  const parameters = useSearchParams();
  const originLocationId = parameters.get('originId') ?? '';
  const destinationLocationId = parameters.get('destinationId') ?? '';
  const travelDate = parameters.get('date') ?? '';
  const originName = parameters.get('origin') ?? 'Điểm đi';
  const destinationName = parameters.get('destination') ?? 'Điểm đến';
  const originCode = parameters.get('originCode') ?? '';
  const destinationCode = parameters.get('destinationCode') ?? '';
  const hasCityRoute =
    parameters.get('originKind') === 'CITY' && parameters.get('destinationKind') === 'CITY';
  const timeRange = parameters.get('timeRange') ?? '';
  const maxPrice = parameters.get('maxPrice') ?? '';
  const operatorCode = parameters.get('operator') ?? '';
  const vehicleTypeCode = parameters.get('vehicleType') ?? '';
  const minSeats = parameters.get('minSeats') ?? '';
  const sort = normalizeSort(parameters.get('sort'));
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [nearestTravelDates, setNearestTravelDates] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!originLocationId || !destinationLocationId || !travelDate) {
      setError('Thông tin tìm kiếm chưa đầy đủ.');
      setIsLoading(false);
      return;
    }
    const controller = new AbortController();
    setIsLoading(true);
    setError(null);
    void fetch('/graphql', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-search-session-id': getSearchSessionId(),
      },
      signal: controller.signal,
      body: JSON.stringify({
        query:
          'query SearchTrips($input: SearchTripsInput!) { searchTrips(input: $input) { timezone nearestTravelDates trips { id operatorName vehicleTypeName vehicleCode originName destinationName pickupName dropoffName departureAt arrivalAt durationMinutes priceVnd remainingSeats } } }',
        variables: {
          input: {
            originLocationId,
            destinationLocationId,
            travelDate,
            ...timeRangeInput(timeRange),
            ...(positiveInteger(maxPrice) ? { maxPriceVnd: positiveInteger(maxPrice) } : {}),
            ...(operatorCode ? { operatorCodes: [operatorCode] } : {}),
            ...(vehicleTypeCode ? { vehicleTypeCodes: [vehicleTypeCode] } : {}),
            ...(positiveInteger(minSeats)
              ? { minimumRemainingSeats: positiveInteger(minSeats) }
              : {}),
            sort,
          },
        },
      }),
    })
      .then(async (response) => {
        const body = await readGraphQlResponse<{
          searchTrips: { trips: TripSummary[]; timezone: string; nearestTravelDates: string[] };
        }>(
          response,
          'Không thể tải danh sách chuyến. Kiểm tra GraphQL Gateway đang chạy.',
        );
        if (!response.ok || body.errors?.length) {
          throw new Error(body.errors?.[0]?.message ?? 'Không thể tải danh sách chuyến.');
        }
        setTrips(body.data?.searchTrips.trips ?? []);
        setNearestTravelDates(body.data?.searchTrips.nearestTravelDates ?? []);
      })
      .catch((requestError: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          requestError instanceof Error ? requestError.message : 'Không thể tải danh sách chuyến.',
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => controller.abort();
  }, [
    destinationLocationId,
    maxPrice,
    minSeats,
    operatorCode,
    originLocationId,
    sort,
    timeRange,
    travelDate,
    vehicleTypeCode,
  ]);

  return (
    <main className="results-page">
      <SiteHeader />

      <section className="results-intro" aria-labelledby="results-title">
        <p className="eyebrow">Lịch chạy ngày {formatLocalDate(travelDate)}</p>
        <h1 id="results-title">
          {originName} <span aria-hidden="true">→</span> {destinationName}
        </h1>
        <p>
          Giờ địa phương · Giá vé cho một hành khách · Chọn chuyến để xem điểm đón và ghế trống.
        </p>
        {hasCityRoute && originCode && destinationCode && travelDate ? (
          <Link
            className="route-seo-link"
            href={`/routes/${originCode.toLowerCase()}-to-${destinationCode.toLowerCase()}?date=${travelDate}`}
          >
            Mở trang tuyến {originName} đi {destinationName}
          </Link>
        ) : null}
      </section>

      <TripFilters />

      {isLoading ? (
        <section className="results-state" role="status" aria-live="polite">
          <strong>Đang tìm chuyến phù hợp...</strong>
          <span>Kiểm tra lịch chạy và giá vé mới nhất.</span>
        </section>
      ) : error ? (
        <section className="results-state is-error" role="alert">
          <strong>Chưa thể tải chuyến xe</strong>
          <span>{error}</span>
          <Link href="/#search">Quay lại tìm kiếm</Link>
        </section>
      ) : trips.length === 0 ? (
        <section className="results-state" role="status">
          <strong>Ngày này chưa có chuyến phù hợp</strong>
          <span>Thử đổi ngày đi, nới bộ lọc hoặc chọn thành phố thay vì bến xe.</span>
          {nearestTravelDates.length ? (
            <div className="nearby-dates" aria-label="Ngày gần nhất có chuyến">
              {nearestTravelDates.map((date) => (
                <Link key={date} href={withTravelDate(parameters, date)}>
                  {formatLocalDate(date)}
                </Link>
              ))}
            </div>
          ) : null}
          <Link href="/#search">Chọn ngày khác</Link>
        </section>
      ) : (
        <section className="trip-list" aria-label={`${trips.length} chuyến xe tìm thấy`}>
          <div className="result-count">
            <span>{trips.length.toString().padStart(2, '0')}</span>
            <p>chuyến đang mở bán</p>
          </div>
          <ol>
            {trips.map((trip) => (
              <TripCard key={trip.id} trip={trip} />
            ))}
          </ol>
        </section>
      )}
      <SiteFooter />
    </main>
  );
}

function formatLocalDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

function normalizeSort(value: string | null) {
  return value === 'PRICE_LOWEST' || value === 'DURATION_SHORTEST' ? value : 'DEPARTURE_EARLIEST';
}

function positiveInteger(value: string): number | undefined {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

function timeRangeInput(value: string): {
  departureTimeFrom?: string;
  departureTimeTo?: string;
} {
  if (value === 'morning') return { departureTimeFrom: '00:00', departureTimeTo: '11:59' };
  if (value === 'afternoon') return { departureTimeFrom: '12:00', departureTimeTo: '17:59' };
  if (value === 'evening') return { departureTimeFrom: '18:00', departureTimeTo: '23:59' };
  return {};
}

function withTravelDate(parameters: URLSearchParams, travelDate: string): string {
  const nextParameters = new URLSearchParams(parameters.toString());
  nextParameters.set('date', travelDate);
  return `/trips?${nextParameters.toString()}`;
}

function getSearchSessionId(): string {
  const storageKey = 'bus.search-session-id';
  const created = window.crypto.randomUUID();
  try {
    const existing = window.sessionStorage.getItem(storageKey);
    if (existing) return existing;
    window.sessionStorage.setItem(storageKey, created);
  } catch {
    // Storage can be disabled; the opaque ID remains safe for the current request.
  }
  return created;
}
