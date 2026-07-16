import type { Metadata } from 'next';

import { AdminOperationsConsole } from './admin-operations-console';

export const metadata: Metadata = {
  title: 'Vận hành booking | Bến Việt',
  description: 'Theo dõi booking và audit vận hành thuộc Booking Service.',
};

export default function AdminOperationsPage() {
  return (
    <main className="operations-page">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Bến Việt - về trang tìm chuyến">
          <span className="brand-mark" aria-hidden="true">
            BV
          </span>
          <span>
            <strong>Bến Việt</strong>
            <small>Operations ledger.</small>
          </span>
        </a>
        <nav aria-label="Điều hướng quản trị">
          <a href="/staff/check-in">Check-in</a>
          <a href="/admin/trips">Chuẩn bị chuyến</a>
          <a className="nav-cta" href="/admin/operations">
            Vận hành
          </a>
        </nav>
      </header>
      <AdminOperationsConsole />
    </main>
  );
}
