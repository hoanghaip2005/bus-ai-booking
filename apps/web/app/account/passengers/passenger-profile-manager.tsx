'use client';

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

  useEffect(() => {
    const session = getStoredAuthSession();
    if (session?.user.role !== 'CUSTOMER') {
      setMessage('Đăng nhập tài khoản CUSTOMER để quản lý hành khách thường dùng.');
      return;
    }
    void reload();
  }, []);

  async function reload() {
    try {
      const next = await listPassengerProfiles();
      setProfiles(next);
      setMessage(next.length ? '' : 'Bạn chưa lưu hành khách thường dùng nào.');
    } catch (error) {
      setMessage(clientMessage(error));
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
      setMessage(clientMessage(error));
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
      setMessage(clientMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="profile-manager" aria-live="polite">
      <header className="profile-manager-heading">
        <div>
          <p className="eyebrow">Identity-owned · M4.3</p>
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
          <span className="profile-editor-index">PROFILE / {editing ? 'EDIT' : 'NEW'}</span>
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
          <p>
            Không lưu số giấy tờ tùy thân trong profile. Booking vẫn tạo snapshot riêng cho từng
            chuyến.
          </p>
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
    if (error.code === 'FORBIDDEN') return 'Chỉ CUSTOMER được quản lý hành khách thường dùng.';
    if (error.code === 'NOT_FOUND') return 'Hành khách này không còn tồn tại.';
    return error.message;
  }
  return 'Không thể cập nhật hành khách thường dùng.';
}
