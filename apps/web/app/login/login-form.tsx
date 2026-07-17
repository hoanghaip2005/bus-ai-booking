'use client';

import { useEffect, useState } from 'react';

import {
  type AuthSession,
  AuthClientError,
  login,
  logout,
  refreshSession,
  viewer,
} from './auth-client';
import { authStorageKey } from '../lib/auth-session';

export function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [session, setSession] = useState<AuthSession | null>(null);
  const [message, setMessage] = useState('Đăng nhập để tiếp tục quản lý chuyến đi của bạn.');
  const [busy, setBusy] = useState(false);
  const [interactive, setInteractive] = useState(false);

  useEffect(() => {
    setInteractive(true);
    const serialized = sessionStorage.getItem(authStorageKey);
    if (!serialized) return;
    try {
      const stored = JSON.parse(serialized) as AuthSession;
      void viewer(stored.accessToken)
        .then((user) => setSession({ ...stored, user }))
        .catch(() => sessionStorage.removeItem(authStorageKey));
    } catch {
      sessionStorage.removeItem(authStorageKey);
    }
  }, []);

  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const authenticated = await login(email, password);
      persist(authenticated);
      setSession(authenticated);
      setMessage(`Xin chào ${authenticated.user.displayName}.`);
    } catch (error) {
      setMessage(clientMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleRefresh() {
    if (!session) return;
    setBusy(true);
    try {
      const rotated = await refreshSession(session.refreshToken);
      persist(rotated);
      setSession(rotated);
      setMessage('Phiên đăng nhập đã được gia hạn.');
    } catch (error) {
      setMessage(clientMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    if (!session) return;
    setBusy(true);
    try {
      await logout(session.refreshToken);
      sessionStorage.removeItem(authStorageKey);
      setSession(null);
      setMessage('Bạn đã đăng xuất an toàn.');
    } catch (error) {
      setMessage(clientMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-grid">
      <section className="auth-card" aria-labelledby="login-title">
        <p className="eyebrow">Tài khoản Bến Việt</p>
        <h1 id="login-title">Chào mừng bạn trở lại.</h1>
        <p className="auth-intro">
          Xem vé đã đặt, lưu thông tin hành khách và tiếp tục công việc vận hành của bạn.
        </p>
        <form className="auth-form" onSubmit={handleLogin}>
          <label>
            Email
            <input
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              required
            />
          </label>
          <label>
            Mật khẩu
            <input
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              required
            />
          </label>
          <button className="auth-primary" disabled={busy || !interactive} type="submit">
            {busy ? 'Đang xử lý…' : 'Đăng nhập'}
          </button>
        </form>
      </section>

      <aside className="auth-session" aria-live="polite">
        <span className="auth-stamp">BẾN VIỆT</span>
        {session ? (
          <>
            <p className="eyebrow">Đã đăng nhập</p>
            <h2>{session.user.displayName}</h2>
            <dl>
              <div>
                <dt>Quyền truy cập</dt>
                <dd>{roleLabel(session.user.role)}</dd>
              </div>
              <div>
                <dt>Phiên hết hạn lúc</dt>
                <dd>{new Date(session.accessExpiresAt).toLocaleTimeString('vi-VN')}</dd>
              </div>
            </dl>
            <div className="auth-actions">
              {session.user.role === 'CUSTOMER' && <a href="/account/bookings">Vé của tôi</a>}
              {session.user.role === 'CUSTOMER' && (
                <a href="/account/passengers">Hành khách đã lưu</a>
              )}
              {(session.user.role === 'STAFF' || session.user.role === 'ADMIN') && (
                <a href="/staff/check-in">Mở bàn check-in</a>
              )}
              {session.user.role === 'ADMIN' && <a href="/admin/operations">Trung tâm vận hành</a>}
              <button disabled={busy} onClick={handleRefresh} type="button">
                Gia hạn phiên
              </button>
              <button disabled={busy} onClick={handleLogout} type="button">
                Đăng xuất
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="eyebrow">Một tài khoản, nhiều tiện ích</p>
            <h2>Giữ mọi hành trình trong tầm tay.</h2>
            <ul className="auth-benefits">
              <li>Xem lại lịch sử và trạng thái vé.</li>
              <li>Lưu hành khách thường đi cùng.</li>
              <li>Hủy vé trực tuyến khi đủ điều kiện.</li>
            </ul>
            <a className="auth-guest-link" href="/#search">
              Tiếp tục tìm chuyến không cần đăng nhập
            </a>
          </>
        )}
        <p className="auth-message" role="status">
          {message}
        </p>
      </aside>
    </div>
  );
}

function roleLabel(role: AuthSession['user']['role']): string {
  if (role === 'ADMIN') return 'Quản trị viên';
  if (role === 'STAFF') return 'Nhân viên vận hành';
  return 'Khách hàng';
}

function persist(session: AuthSession): void {
  sessionStorage.setItem(authStorageKey, JSON.stringify(session));
}

function clientMessage(error: unknown): string {
  if (error instanceof AuthClientError) {
    if (error.code === 'UNAUTHENTICATED') return 'Email hoặc mật khẩu không chính xác.';
    if (error.code === 'FORBIDDEN') return 'Tài khoản này không có quyền thực hiện thao tác.';
    return error.message;
  }
  return 'Không thể hoàn tất đăng nhập. Vui lòng thử lại.';
}
