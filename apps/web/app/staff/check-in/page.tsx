import type { Metadata } from 'next';

import { CheckInConsole } from './check-in-console';
import { SiteHeader } from '../../components/site-header';

export const metadata: Metadata = {
  title: 'Check-in hành khách',
  description: 'Tra cứu vé và check-in hành khách dành cho nhân viên vận hành.',
};

export default function StaffCheckInPage() {
  return (
    <main className="operations-page">
      <SiteHeader variant="staff" />
      <CheckInConsole />
    </main>
  );
}
