import type { Metadata } from 'next';

import { PassengerProfileManager } from './passenger-profile-manager';

export const metadata: Metadata = {
  title: 'Hành khách thường dùng',
  description: 'Quản lý thông tin hành khách thường dùng thuộc tài khoản Bến Việt.',
};

export default function PassengerProfilesPage() {
  return (
    <main className="account-page">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Bến Việt - về trang tìm chuyến">
          <span className="brand-mark" aria-hidden="true">
            BV
          </span>
          <span>
            <strong>Bến Việt</strong>
            <small>Điền nhanh, dữ liệu đúng chủ.</small>
          </span>
        </a>
        <nav aria-label="Điều hướng tài khoản">
          <a href="/account/bookings">Lịch sử vé</a>
          <a className="nav-cta" href="/login">
            Tài khoản
          </a>
        </nav>
      </header>
      <PassengerProfileManager />
    </main>
  );
}
