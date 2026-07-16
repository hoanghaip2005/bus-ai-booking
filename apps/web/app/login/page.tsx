import type { Metadata } from 'next';

import { LoginForm } from './login-form';

export const metadata: Metadata = {
  title: 'Đăng nhập',
  description: 'Đăng nhập tài khoản khách hàng, nhân viên hoặc quản trị Bến Việt.',
};

export default function LoginPage() {
  return (
    <main className="auth-page">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Bến Việt - về trang tìm chuyến">
          <span className="brand-mark" aria-hidden="true">
            BV
          </span>
          <span>
            <strong>Bến Việt</strong>
            <small>Identity có ranh giới.</small>
          </span>
        </a>
        <nav aria-label="Điều hướng đăng nhập">
          <a href="/">Tìm chuyến</a>
          <a className="nav-cta" href="/login">
            Đăng nhập
          </a>
        </nav>
      </header>
      <LoginForm />
    </main>
  );
}
