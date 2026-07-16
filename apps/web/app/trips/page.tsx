import { Suspense } from 'react';

import { TripResults } from './trip-results';

export default function TripsPage() {
  return (
    <Suspense fallback={<TripResultsLoading />}>
      <TripResults />
    </Suspense>
  );
}

function TripResultsLoading() {
  return (
    <main className="results-page" aria-busy="true">
      <p className="eyebrow">Bến Việt đang dò lịch chạy</p>
      <h1>Đang tìm chuyến phù hợp...</h1>
    </main>
  );
}
