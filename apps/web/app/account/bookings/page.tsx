import type { Metadata } from 'next';

import { BookingHistory } from './booking-history';
import { SiteHeader } from '../../components/site-header';

export const metadata: Metadata = {
  title: 'Lịch sử đặt vé',
  description: 'Xem và quản lý các vé thuộc tài khoản Bến Việt.',
};

export default function BookingHistoryPage() {
  return (
    <main className="account-page">
      <SiteHeader variant="account" />
      <BookingHistory />
    </main>
  );
}
