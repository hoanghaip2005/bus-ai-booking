'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import {
  authSessionChangedEvent,
  getStoredAuthSession,
  type StoredUserRole,
} from '../lib/auth-session';

type HeaderVariant = 'public' | 'account' | 'staff' | 'admin';

interface NavigationItem {
  href: string;
  label: string;
  action?: boolean;
}

const navByVariant: Record<HeaderVariant, NavigationItem[]> = {
  public: [
    { href: '/#search', label: 'Tìm chuyến' },
    { href: '/assistant', label: 'Trợ lý' },
    { href: '/#travel-notes', label: 'Hướng dẫn' },
    { href: '/login', label: 'Đăng nhập', action: true },
  ],
  account: [
    { href: '/', label: 'Đặt vé' },
    { href: '/assistant', label: 'Trợ lý' },
    { href: '/account/bookings', label: 'Vé của tôi' },
    { href: '/account/passengers', label: 'Hành khách' },
    { href: '/login', label: 'Tài khoản', action: true },
  ],
  staff: [
    { href: '/', label: 'Đặt vé' },
    { href: '/assistant', label: 'Trợ lý' },
    { href: '/staff/check-in', label: 'Check-in' },
    { href: '/login', label: 'Tài khoản', action: true },
  ],
  admin: [
    { href: '/', label: 'Đặt vé' },
    { href: '/staff/check-in', label: 'Check-in' },
    { href: '/admin/trips', label: 'Lịch chạy' },
    { href: '/admin/operations', label: 'Báo cáo' },
    { href: '/admin/catalog', label: 'Danh mục' },
    { href: '/login', label: 'Tài khoản', action: true },
  ],
};

const labelByVariant: Record<HeaderVariant, string> = {
  public: 'Đặt vé xe liên tỉnh',
  account: 'Không gian cá nhân',
  staff: 'Bàn làm việc',
  admin: 'Quản trị vận hành',
};

let cachedHeaderRole: StoredUserRole | null | undefined;

export function SiteHeader({ variant = 'public' }: { variant?: HeaderVariant }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [storedRole, setStoredRole] = useState<StoredUserRole | null>(
    () => cachedHeaderRole ?? null,
  );
  const [sessionResolved, setSessionResolved] = useState(() => cachedHeaderRole !== undefined);
  const authenticatedVariant = headerVariantForRole(storedRole);
  const resolvedVariant: HeaderVariant =
    variant === 'public' && authenticatedVariant
      ? authenticatedVariant
      : variant === 'staff' && storedRole === 'ADMIN'
        ? 'admin'
        : variant;
  const links =
    variant === 'public' && !sessionResolved
      ? navByVariant.public.filter((link) => !link.action)
      : navByVariant[resolvedVariant];

  useEffect(() => setMenuOpen(false), [pathname]);

  useEffect(() => {
    function syncRole() {
      const role = getStoredAuthSession()?.user.role ?? null;
      cachedHeaderRole = role;
      setStoredRole(role);
      setSessionResolved(true);
    }

    syncRole();
    window.addEventListener(authSessionChangedEvent, syncRole);
    return () => window.removeEventListener(authSessionChangedEvent, syncRole);
  }, [pathname]);

  return (
    <header className="site-header">
      <Link className="brand" href="/" aria-label="Bến Việt - về trang chủ">
        <span className="brand-mark" aria-hidden="true">
          BV
        </span>
        <span className="brand-copy">
          <strong>Bến Việt</strong>
          <small>{labelByVariant[resolvedVariant]}</small>
        </span>
      </Link>

      <button
        className="site-menu-toggle"
        type="button"
        aria-expanded={menuOpen}
        aria-controls="site-navigation"
        onClick={() => setMenuOpen((current) => !current)}
      >
        <span>{menuOpen ? 'Đóng' : 'Menu'}</span>
        <i aria-hidden="true" />
      </button>

      <nav
        className="site-nav"
        id="site-navigation"
        aria-label="Điều hướng chính"
        data-open={menuOpen}
      >
        {links.map((link) => {
          const active = link.href.includes('#')
            ? false
            : link.href === '/'
              ? pathname === '/'
              : pathname === link.href || pathname.startsWith(`${link.href}/`);
          return (
            <Link
              className={link.action ? 'nav-cta' : undefined}
              href={link.href}
              key={link.href}
              aria-current={active ? 'page' : undefined}
              onClick={() => setMenuOpen(false)}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}

function headerVariantForRole(role: string | null): HeaderVariant | undefined {
  if (role === 'CUSTOMER') return 'account';
  if (role === 'STAFF') return 'staff';
  if (role === 'ADMIN') return 'admin';
  return undefined;
}
