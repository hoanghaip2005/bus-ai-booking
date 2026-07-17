import type { Metadata } from 'next';

import { PassengerProfileManager } from './passenger-profile-manager';
import { SiteHeader } from '../../components/site-header';

export const metadata: Metadata = {
  title: 'Hành khách thường dùng',
  description: 'Quản lý thông tin hành khách thường dùng thuộc tài khoản Bến Việt.',
};

export default function PassengerProfilesPage() {
  return (
    <main className="account-page">
      <SiteHeader variant="account" />
      <PassengerProfileManager />
    </main>
  );
}
