import Link from 'next/link';

type HeaderVariant = 'public' | 'account' | 'staff' | 'admin';

const navByVariant: Record<HeaderVariant, Array<{ href: string; label: string }>> = {
  public: [
    { href: '/#search', label: 'Tìm chuyến' },
    { href: '/#travel-notes', label: 'Kinh nghiệm đi xe' },
    { href: '/login', label: 'Đăng nhập' },
  ],
  account: [
    { href: '/', label: 'Đặt vé' },
    { href: '/account/bookings', label: 'Vé của tôi' },
    { href: '/account/passengers', label: 'Hành khách' },
    { href: '/login', label: 'Tài khoản' },
  ],
  staff: [
    { href: '/', label: 'Trang đặt vé' },
    { href: '/login', label: 'Tài khoản' },
    { href: '/staff/check-in', label: 'Check-in' },
  ],
  admin: [
    { href: '/', label: 'Trang đặt vé' },
    { href: '/staff/check-in', label: 'Check-in' },
    { href: '/admin/trips', label: 'Lịch chạy' },
    { href: '/admin/operations', label: 'Báo cáo' },
    { href: '/admin/catalog', label: 'Danh mục' },
  ],
};

const labelByVariant: Record<HeaderVariant, string> = {
  public: 'Đặt vé xe liên tỉnh',
  account: 'Không gian cá nhân',
  staff: 'Bàn làm việc',
  admin: 'Quản trị vận hành',
};

export function SiteHeader({ variant = 'public' }: { variant?: HeaderVariant }) {
  const links = navByVariant[variant];

  return (
    <header className="site-header">
      <Link className="brand" href="/" aria-label="Bến Việt - về trang chủ">
        <span className="brand-mark" aria-hidden="true">
          BV
        </span>
        <span className="brand-copy">
          <strong>Bến Việt</strong>
          <small>{labelByVariant[variant]}</small>
        </span>
      </Link>
      <nav className="site-nav" aria-label="Điều hướng chính">
        {links.map((link, index) => (
          <Link
            className={index === links.length - 1 ? 'nav-cta' : undefined}
            href={link.href}
            key={link.href}
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
