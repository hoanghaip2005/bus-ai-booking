import Link from 'next/link';

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div>
        <strong>Bến Việt</strong>
        <span>Đi xa, nhẹ đầu.</span>
      </div>
      <div className="site-footer-links">
        <Link href="/#travel-notes">Hướng dẫn đặt vé</Link>
        <Link href="/#policies">Chính sách vé</Link>
        <Link href="/#support">Hỗ trợ</Link>
      </div>
      <span className="site-footer-meta">© 2026 Bến Việt</span>
    </footer>
  );
}
