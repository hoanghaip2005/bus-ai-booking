import type { Metadata } from 'next';

import { BookingHistory } from './booking-history';

export const metadata: Metadata = {
  title: 'Lịch sử đặt vé',
  description: 'Xem các booking thuộc tài khoản khách hàng Bến Việt.',
};

export default function BookingHistoryPage() {
  return (
    <main className="account-page">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Bến Việt - về trang tìm chuyến">
          <span className="brand-mark" aria-hidden="true">
            BV
          </span>
          <span>
            <strong>Bến Việt</strong>
            <small>Booking đúng chủ sở hữu.</small>
          </span>
        </a>
        <nav aria-label="Điều hướng tài khoản">
          <a href="/">Tìm chuyến</a>
          <a href="/account/passengers">Hành khách</a>
          <a className="nav-cta" href="/login">
            Tài khoản
          </a>
        </nav>
      </header>
      <BookingHistory />
    </main>
  );
}
