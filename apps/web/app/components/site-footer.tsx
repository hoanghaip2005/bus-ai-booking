import Link from 'next/link';

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-brand">
        <span className="brand-mark" aria-hidden="true">
          BV
        </span>
        <div>
          <strong>Bến Việt</strong>
          <span>Đi xa, nhẹ đầu.</span>
        </div>
      </div>
      <nav className="site-footer-links" aria-label="Liên kết cuối trang">
        <Link href="/#search">Tìm chuyến</Link>
        <Link href="/assistant">Trợ lý đặt vé</Link>
        <Link href="/#popular-routes">Tuyến phổ biến</Link>
        <Link href="/login">Tài khoản</Link>
      </nav>
      <div className="site-footer-meta">
        <span>Hỗ trợ hành trình liên tỉnh</span>
        <span>© 2026 Bến Việt</span>
      </div>
    </footer>
  );
}
