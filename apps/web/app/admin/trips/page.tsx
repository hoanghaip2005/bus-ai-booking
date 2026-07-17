import type { Metadata } from 'next';

import { TripPreparationConsole } from './trip-preparation-console';
import { SiteHeader } from '../../components/site-header';

export const metadata: Metadata = {
  title: 'Chuẩn bị chuyến xe',
  description: 'Tạo chuyến xe từ tuyến, xe và phiên bản sơ đồ ghế có sẵn.',
};

export default function AdminTripsPage() {
  return (
    <main className="operations-page">
      <SiteHeader variant="admin" />
      <TripPreparationConsole />
    </main>
  );
}
