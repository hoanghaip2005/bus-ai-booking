import type { Metadata } from 'next';

import { LoginForm } from './login-form';
import { SiteHeader } from '../components/site-header';

export const metadata: Metadata = {
  title: 'Đăng nhập',
  description: 'Đăng nhập tài khoản Bến Việt để quản lý vé và công việc vận hành.',
};

export default function LoginPage() {
  return (
    <main className="auth-page">
      <SiteHeader />
      <LoginForm />
    </main>
  );
}
