'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';

import { getStoredAuthSession } from '../../lib/auth-session';
import {
  createPassengerProfile,
  deletePassengerProfile,
  listPassengerProfiles,
  PassengerProfileClientError,
  type PassengerProfile,
  updatePassengerProfile,
} from '../../lib/passenger-profiles';

export function PassengerProfileManager() {
  const [profiles, setProfiles] = useState<PassengerProfile[]>([]);
  const [editing, setEditing] = useState<PassengerProfile>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Đang tải hành khách thường dùng…');
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    const session = getStoredAuthSession();
    if (session?.user.role !== 'CUSTOMER') {
      setSignedIn(false);
      setMessage('Vui lòng đăng nhập để quản lý hành khách thường dùng.');
      return;
    }
    setSignedIn(true);
    void reload();
  }, []);

  async function reload() {
    try {
      const next = await listPassengerProfiles();
      setProfiles(next);
      setMessage(next.length ? '' : 'Bạn chưa lưu hành khách thường dùng nào.');
    } catch (error) {
      handleFailure(error);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const input = {
      label: String(form.get('label') ?? '').trim(),
      fullName: String(form.get('fullName') ?? '').trim(),
      phone: String(form.get('phone') ?? '').trim() || undefined,
    };
    setBusy(true);
    try {
      if (editing) await updatePassengerProfile(editing.id, input);
      else await createPassengerProfile(input);
      formElement.reset();
      setEditing(undefined);
      setMessage(editing ? 'Đã cập nhật hành khách.' : 'Đã lưu hành khách mới.');
      await reload();
    } catch (error) {
      handleFailure(error);
    } finally {
      setBusy(false);
    }
  }

  async function remove(profile: PassengerProfile) {
    setBusy(true);
    try {
      await deletePassengerProfile(profile.id);
      if (editing?.id === profile.id) setEditing(undefined);
      setMessage('Đã xóa hành khách thường dùng.');
      await reload();
    } catch (error) {
      handleFailure(error);
    } finally {
      setBusy(false);
    }
  }

  function handleFailure(error: unknown) {
    if (error instanceof PassengerProfileClientError && error.code === 'UNAUTHENTICATED') {
      setSignedIn(false);
      setProfiles([]);
    }
    setMessage(clientMessage(error));
  }

  if (signedIn !== true) {
    return (
      <section className="profile-manager" aria-live="polite">
        <header className="profile-manager-heading">
          <div>
            <p className="eyebrow">Hành khách thường dùng</p>
            <h1>Điền một lần. Đi nhiều chuyến.</h1>
          </div>
          <span>0/20 hồ sơ</span>
        </header>
        {signedIn === false ? (
          <div className="account-access-state">
            <strong>Đăng nhập để lưu hành khách</strong>
            <p>{message}</p>
            <Link href="/login">Đăng nhập tài khoản</Link>
          </div>
        ) : (
          <div className="results-state" role="status">
            <strong>Đang mở danh sách hành khách…</strong>
            <span>Thông tin đã lưu sẽ xuất hiện trong giây lát.</span>
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="profile-manager" aria-live="polite">
      <header className="profile-manager-heading">
        <div>
          <p className="eyebrow">Hành khách thường dùng</p>
          <h1>Điền một lần. Đi nhiều chuyến.</h1>
        </div>
        <span>{profiles.length}/20 hồ sơ</span>
      </header>

      <div className="profile-manager-grid">
        <form
          className="profile-editor"
          onSubmit={(event) => void submit(event)}
          key={editing?.id ?? 'new'}
        >
          <span className="profile-editor-index">{editing ? 'CHỈNH SỬA' : 'THÊM MỚI'}</span>
          <h2>{editing ? 'Chỉnh sửa hành khách' : 'Thêm hành khách thường dùng'}</h2>
          <label>
            Nhãn dễ nhớ
            <input
              name="label"
              defaultValue={editing?.label}
              placeholder="Tôi, Mẹ, Đồng nghiệp…"
              required
              maxLength={40}
            />
          </label>
          <label>
            Họ và tên
            <input
              name="fullName"
              defaultValue={editing?.fullName}
              required
              minLength={2}
              maxLength={100}
              autoComplete="name"
            />
          </label>
          <label>
            Số điện thoại
            <input
              name="phone"
              defaultValue={editing?.phone ?? ''}
              type="tel"
              maxLength={24}
              autoComplete="tel"
            />
          </label>
          <div className="profile-editor-actions">
            {editing && (
              <button type="button" onClick={() => setEditing(undefined)}>
                Hủy sửa
              </button>
            )}
            <button className="auth-primary" disabled={busy} type="submit">
              {busy ? 'Đang lưu…' : editing ? 'Cập nhật' : 'Lưu hành khách'}
            </button>
          </div>
          <p>Số giấy tờ không được lưu trong hồ sơ này. Bạn có thể bổ sung khi đặt từng chuyến.</p>
        </form>

        <div className="profile-stack">
          {profiles.map((profile, index) => (
            <article className="profile-card" key={profile.id}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <div>
                <small>{profile.label}</small>
                <h2>{profile.fullName}</h2>
                <p>{profile.phone ?? 'Không lưu số điện thoại'}</p>
              </div>
              <div className="profile-card-actions">
                <button disabled={busy} onClick={() => setEditing(profile)} type="button">
                  Sửa
                </button>
                <button disabled={busy} onClick={() => void remove(profile)} type="button">
                  Xóa
                </button>
              </div>
            </article>
          ))}
          {message && <p className="profile-message">{message}</p>}
        </div>
      </div>
    </section>
  );
}

function clientMessage(error: unknown): string {
  if (error instanceof PassengerProfileClientError) {
    if (error.code === 'UNAUTHENTICATED') return 'Phiên đăng nhập đã hết hạn.';
    if (error.code === 'FORBIDDEN')
      return 'Tài khoản này không thể quản lý hành khách thường dùng.';
    if (error.code === 'NOT_FOUND') return 'Hành khách này không còn tồn tại.';
    return error.message;
  }
  return 'Không thể cập nhật hành khách thường dùng.';
}
