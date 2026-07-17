import Link from 'next/link';

import { SiteFooter } from '../../components/site-footer';
import { SiteHeader } from '../../components/site-header';

export default function TripNotFound() {
  return (
    <main className="trip-detail-page">
      <SiteHeader />
      <section className="results-state" role="status">
        <strong>Chuyến xe không còn mở bán</strong>
        <span>Chuyến có thể đã ngừng hoạt động hoặc mã chuyến không tồn tại.</span>
        <Link href="/">Tìm chuyến khác</Link>
      </section>
      <SiteFooter />
    </main>
  );
}
