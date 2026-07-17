import Link from 'next/link';

import { SiteFooter } from './components/site-footer';
import { SiteHeader } from './components/site-header';

export default function NotFoundPage() {
  return (
    <main className="system-page">
      <SiteHeader />
      <section className="system-state-page">
        <span className="system-state-code">404</span>
        <p className="eyebrow">Lạc tuyến rồi</p>
        <h1>Trang bạn tìm không còn ở đây.</h1>
        <p>Đường dẫn có thể đã thay đổi. Hãy quay về trang chủ để bắt đầu một hành trình mới.</p>
        <div className="system-state-actions">
          <Link className="system-primary-action" href="/#search">
            Tìm chuyến xe
          </Link>
          <Link href="/assistant">Hỏi trợ lý Bến Việt</Link>
        </div>
      </section>
      <SiteFooter />
    </main>
  );
}
