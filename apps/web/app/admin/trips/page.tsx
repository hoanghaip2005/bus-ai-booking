import type { Metadata } from 'next';

import { TripPreparationConsole } from './trip-preparation-console';

export const metadata: Metadata = {
  title: 'Chuẩn bị chuyến xe | Bến Việt',
  description: 'Tạo chuyến xe từ tuyến, xe và phiên bản sơ đồ ghế có sẵn.',
};

export default function AdminTripsPage() {
  return (
    <main className="operations-page">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Bến Việt - về trang tìm chuyến">
          <span className="brand-mark" aria-hidden="true">
            BV
          </span>
          <span>
            <strong>Bến Việt</strong>
            <small>Catalog operations.</small>
          </span>
        </a>
        <nav aria-label="Điều hướng quản trị">
          <a href="/staff/check-in">Check-in</a>
          <a href="/login">Tài khoản</a>
          <a className="nav-cta" href="/admin/trips">
            Chuẩn bị chuyến
          </a>
        </nav>
      </header>
      <TripPreparationConsole />
    </main>
  );
}
