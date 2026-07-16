import Link from 'next/link';

export interface TripSummary {
  id: string;
  operatorName: string;
  vehicleTypeName: string;
  vehicleCode: string;
  originName: string;
  destinationName: string;
  pickupName: string;
  dropoffName: string;
  departureAt: string;
  arrivalAt: string;
  durationMinutes: number;
  priceVnd: number;
  remainingSeats: number;
}

export function TripCard({ trip }: { trip: TripSummary }) {
  return (
    <li className="trip-card">
      <div className="trip-operator">
        <p>{trip.operatorName}</p>
        <span>{trip.vehicleTypeName}</span>
        <small>Mã xe {trip.vehicleCode}</small>
      </div>
      <div className="trip-timeline">
        <div>
          <time dateTime={trip.departureAt}>{formatTime(trip.departureAt)}</time>
          <span>{trip.pickupName}</span>
        </div>
        <p>
          <span>{formatDuration(trip.durationMinutes)}</span>
          <i aria-hidden="true" />
        </p>
        <div>
          <time dateTime={trip.arrivalAt}>{formatTime(trip.arrivalAt)}</time>
          <span>{trip.dropoffName}</span>
        </div>
      </div>
      <div className="trip-price">
        <strong>{formatMoney(trip.priceVnd)}</strong>
        <span>{trip.remainingSeats} chỗ còn lại</span>
        <Link href={`/trips/${trip.id}`}>Xem chi tiết</Link>
      </div>
    </li>
  );
}

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

function formatTime(value: string): string {
  return timeFormatter.format(new Date(value));
}

function formatMoney(value: number): string {
  return moneyFormatter.format(value);
}

function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours}g ${remainingMinutes}p` : `${hours} giờ`;
}
