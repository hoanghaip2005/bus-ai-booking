import Link from 'next/link';

interface PopularRoute {
  label: string;
  slug: string;
}

export function PopularRouteLinks({ routes }: { routes: readonly PopularRoute[] }) {
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  return (
    <div className="route-chip-list" aria-label="Tuyến phổ biến">
      {routes.map((route) => (
        <Link
          className="route-chip"
          href={`/routes/${route.slug}?date=${date}`}
          key={route.slug}
          aria-label={`Xem chuyến ${route.label}`}
        >
          <span>{route.label}</span>
          <span className="route-chip-arrow" aria-hidden="true">
            →
          </span>
        </Link>
      ))}
    </div>
  );
}
