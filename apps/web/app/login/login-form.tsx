'use client';

import { useEffect, useState } from 'react';

import {
  type AuthSession,
  AuthClientError,
  login,
  logout,
  refreshSession,
  setTripActive,
  transitionTripStatus,
  viewer,
} from './auth-client';
import { authStorageKey } from '../lib/auth-session';

const demoAccounts = [
  { label: 'Khách hàng', email: 'customer.demo@benviet.vn', password: 'Customer123!' },
  { label: 'Nhân viên', email: 'staff.demo@benviet.vn', password: 'Staff123!' },
  { label: 'Quản trị', email: 'admin.demo@benviet.vn', password: 'Admin123!' },
] as const;

export function LoginForm() {
  const [email, setEmail] = useState<string>(demoAccounts[0].email);
  const [password, setPassword] = useState<string>(demoAccounts[0].password);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [message, setMessage] = useState('Chọn tài khoản demo hoặc nhập thông tin đăng nhập.');
  const [busy, setBusy] = useState(false);
  const [interactive, setInteractive] = useState(false);
  const [tripActive, setTripActiveState] = useState(true);
  const [tripStatus, setTripStatus] = useState<'SCHEDULED' | 'DEPARTED' | 'COMPLETED'>('SCHEDULED');

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
      setMessage(`Đăng nhập thành công với role ${authenticated.user.role}.`);
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
      setMessage('Refresh token đã được rotate; token cũ không còn dùng được.');
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
      setMessage('Đã đăng xuất và thu hồi refresh session.');
    } catch (error) {
      setMessage(clientMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleTripActivation() {
    if (!session) return;
    setBusy(true);
    try {
      const result = await setTripActive(
        session.accessToken,
        '00000000-0000-4000-8000-000000000704',
        !tripActive,
      );
      setTripActiveState(result.isActive);
      setMessage(
        result.changed
          ? `Trip demo đã chuyển sang ${result.isActive ? 'ACTIVE' : 'INACTIVE'}.`
          : 'Trip demo đã ở đúng trạng thái yêu cầu.',
      );
    } catch (error) {
      setMessage(clientMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleTripLifecycle() {
    if (!session || tripStatus === 'COMPLETED') return;
    setBusy(true);
    const targetStatus = tripStatus === 'SCHEDULED' ? 'DEPARTED' : 'COMPLETED';
    try {
      const result = await transitionTripStatus(
        session.accessToken,
        '00000000-0000-4000-8000-000000000704',
        targetStatus,
      );
      setTripStatus(result.status);
      setMessage(
        `Trip demo đã chuyển ${result.previousStatus} → ${result.status}; Catalog đã ghi audit.`,
      );
    } catch (error) {
      setMessage(clientMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-grid">
      <section className="auth-card" aria-labelledby="login-title">
        <p className="eyebrow">Identity Service · M4.1</p>
        <h1 id="login-title">Đăng nhập để hệ thống biết bạn được phép làm gì.</h1>
        <div className="demo-account-list" aria-label="Tài khoản demo">
          {demoAccounts.map((account) => (
            <button
              type="button"
              key={account.email}
              disabled={!interactive}
              onClick={() => {
                setEmail(account.email);
                setPassword(account.password);
              }}
            >
              {account.label}
            </button>
          ))}
        </div>
        <form className="auth-form" onSubmit={handleLogin}>
          <label>
            Email
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" />
          </label>
          <label>
            Mật khẩu
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
            />
          </label>
          <button className="auth-primary" disabled={busy || !interactive} type="submit">
            {busy ? 'Đang xử lý…' : 'Đăng nhập'}
          </button>
        </form>
      </section>

      <aside className="auth-session" aria-live="polite">
        <span className="auth-stamp">AUTH / 01</span>
        {session ? (
          <>
            <p className="eyebrow">Phiên đang hoạt động</p>
            <h2>{session.user.displayName}</h2>
            <dl>
              <div>
                <dt>Role</dt>
                <dd>{session.user.role}</dd>
              </div>
              <div>
                <dt>Access hết hạn</dt>
                <dd>{new Date(session.accessExpiresAt).toLocaleTimeString('vi-VN')}</dd>
              </div>
            </dl>
            <div className="auth-actions">
              {session.user.role === 'CUSTOMER' && <a href="/account/bookings">Lịch sử đặt vé</a>}
              {session.user.role === 'CUSTOMER' && <a href="/account/passengers">Hành khách</a>}
              {(session.user.role === 'STAFF' || session.user.role === 'ADMIN') && (
                <a href="/staff/check-in">Bàn check-in</a>
              )}
              {session.user.role === 'ADMIN' && <a href="/admin/trips">Chuẩn bị chuyến</a>}
              <button disabled={busy} onClick={handleRefresh} type="button">
                Rotate token
              </button>
              <button disabled={busy} onClick={handleLogout} type="button">
                Đăng xuất
              </button>
            </div>
            <div className="admin-proof">
              <strong>Kiểm chứng quyền tại Catalog</strong>
              <p>Chỉ ADMIN mới đổi được trạng thái trip 704; Catalog kiểm tra role lần nữa.</p>
              <button disabled={busy} onClick={handleTripActivation} type="button">
                Chuyển trip sang {tripActive ? 'INACTIVE' : 'ACTIVE'}
              </button>
            </div>
            <div className="admin-proof">
              <strong>Vận hành vòng đời chuyến · M5</strong>
              <p>
                ADMIN chuyển trip 704 theo đúng thứ tự SCHEDULED → DEPARTED → COMPLETED; Catalog
                kiểm tra lại role và ghi audit.
              </p>
              <button
                disabled={busy || !interactive || tripStatus === 'COMPLETED'}
                onClick={handleTripLifecycle}
                type="button"
              >
                {tripStatus === 'COMPLETED'
                  ? 'Trip đã COMPLETED'
                  : `Chuyển trip sang ${tripStatus === 'SCHEDULED' ? 'DEPARTED' : 'COMPLETED'}`}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="eyebrow">Chưa có phiên</p>
            <h2>Guest vẫn tìm chuyến, giữ ghế và mua vé như trước.</h2>
            <p>Đăng nhập chỉ bổ sung actor cho các operation cần CUSTOMER, STAFF hoặc ADMIN.</p>
          </>
        )}
        <p className="auth-message" role="status">
          {message}
        </p>
      </aside>
    </div>
  );
}

function persist(session: AuthSession): void {
  sessionStorage.setItem(authStorageKey, JSON.stringify(session));
}

function clientMessage(error: unknown): string {
  if (error instanceof AuthClientError) {
    if (error.code === 'UNAUTHENTICATED') return 'Email, mật khẩu hoặc token không hợp lệ.';
    if (error.code === 'FORBIDDEN') return 'Role hiện tại không được phép thực hiện thao tác này.';
    return error.message;
  }
  return 'Không thể hoàn tất thao tác xác thực.';
}
