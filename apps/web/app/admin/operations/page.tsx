import type { Metadata } from 'next';

import { AdminOperationsConsole } from './admin-operations-console';
import { SiteHeader } from '../../components/site-header';

export const metadata: Metadata = {
  title: 'Báo cáo vận hành',
  description: 'Theo dõi đặt vé, doanh thu và hoạt động vận hành Bến Việt.',
};

export default function AdminOperationsPage() {
  return (
    <main className="operations-page">
      <SiteHeader variant="admin" />
      <AdminOperationsConsole />
    </main>
  );
}
