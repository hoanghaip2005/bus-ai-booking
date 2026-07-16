import type { Metadata } from 'next';

import { CheckInConsole } from './check-in-console';

export const metadata: Metadata = {
  title: 'Check-in hành khách',
  description: 'Tra cứu vé và check-in hành khách dành cho nhân viên vận hành.',
};

export default function StaffCheckInPage() {
  return (
    <main className="operations-page">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Bến Việt - về trang tìm chuyến">
          <span className="brand-mark" aria-hidden="true">
            BV
          </span>
          <span>
            <strong>Bến Việt</strong>
            <small>Operations desk.</small>
          </span>
        </a>
        <nav aria-label="Điều hướng vận hành">
          <a href="/">Tìm chuyến</a>
          <a href="/login">Tài khoản</a>
          <a className="nav-cta" href="/staff/check-in">
            Check-in
          </a>
        </nav>
      </header>
      <CheckInConsole />
    </main>
  );
}
