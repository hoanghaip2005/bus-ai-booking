'use client';

import { useEffect, useMemo, useState } from 'react';

import { authStorageKey } from '../../lib/auth-session';

interface Session {
  accessToken: string;
  user: { displayName: string; role: 'CUSTOMER' | 'STAFF' | 'ADMIN' };
}

interface RouteOption {
  id: string;
  code: string;
  originName: string;
  destinationName: string;
  durationMinutes: number;
}

interface VehicleOption {
  id: string;
  code: string;
  plate: string;
  operatorName: string;
  vehicleTypeName: string;
  seatLayoutVersionId: string;
  seatLayoutVersion: number;
  seatLayoutName: string;
}

interface PreparationOptions {
  routes: RouteOption[];
  vehicles: VehicleOption[];
}

export function TripPreparationConsole() {
  const [session, setSession] = useState<Session | null>(null);
  const [options, setOptions] = useState<PreparationOptions>({ routes: [], vehicles: [] });
  const [routeId, setRouteId] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [departureAt, setDepartureAt] = useState('2030-07-01T07:00');
  const [arrivalAt, setArrivalAt] = useState('2030-07-01T14:00');
  const [priceVnd, setPriceVnd] = useState('280000');
  const [seatTripId, setSeatTripId] = useState('00000000-0000-4000-8000-000000000704');
  const [seatIds, setSeatIds] = useState('A03');
  const [blockReason, setBlockReason] = useState('Bảo trì ghế');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Đăng nhập ADMIN để tải dữ liệu Catalog.');
  const vehicle = useMemo(
    () => options.vehicles.find((item) => item.id === vehicleId),
    [options.vehicles, vehicleId],
  );

  useEffect(() => {
    const raw = sessionStorage.getItem(authStorageKey);
    if (!raw) return;
    try {
      const stored = JSON.parse(raw) as Session;
      if (stored.user.role !== 'ADMIN') return;
      setSession(stored);
      setBusy(true);
      void adminGraphql<PreparationOptions>(
        'query AdminTripPreparationOptions { adminTripPreparationOptions { routes { id code originName destinationName durationMinutes } vehicles { id code plate operatorName vehicleTypeName seatLayoutVersionId seatLayoutVersion seatLayoutName } } }',
        {},
        'adminTripPreparationOptions',
        stored.accessToken,
      )
        .then((result) => {
          setOptions(result);
          setRouteId(result.routes[0]?.id ?? '');
          setVehicleId(result.vehicles[0]?.id ?? '');
          setMessage('Dữ liệu tuyến, xe và sơ đồ ghế được đọc trực tiếp từ Catalog.');
        })
        .catch((error: unknown) => setMessage(errorMessage(error)))
        .finally(() => setBusy(false));
    } catch {
      sessionStorage.removeItem(authStorageKey);
    }
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || !vehicle) return;
    setBusy(true);
    try {
      const result = await adminGraphql<{ tripId: string; created: boolean }>(
        'mutation CreateTrip($input: CreateTripInput!) { createTrip(input: $input) { tripId created status departureAt arrivalAt priceVnd } }',
        {
          input: {
            routeId,
            vehicleId,
            seatLayoutVersionId: vehicle.seatLayoutVersionId,
            departureAt: new Date(departureAt).toISOString(),
            arrivalAt: new Date(arrivalAt).toISOString(),
            priceVnd: Number(priceVnd),
            idempotencyKey: `admin-create-trip-${crypto.randomUUID()}`,
          },
        },
        'createTrip',
        session.accessToken,
      );
      setBusy(false);
      setMessage(
        `${result.created ? 'Đã tạo' : 'Đã tìm lại'} chuyến ${result.tripId}; trip và fare đã commit cùng transaction.`,
      );
      setSeatTripId(result.tripId);
    } catch (error) {
      setBusy(false);
      setMessage(errorMessage(error));
    }
  }

  async function handleSeatBlock(blocked: boolean) {
    if (!session) return;
    setBusy(true);
    try {
      const normalizedSeatIds = seatIds
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      const result = await adminGraphql<{ changed: boolean; blocked: boolean; seatIds: string[] }>(
        'mutation SetSeatBlocked($input: SetSeatBlockedInput!) { setSeatBlocked(input: $input) { tripId seatIds blocked changed updatedAt } }',
        {
          input: {
            tripId: seatTripId,
            seatIds: normalizedSeatIds,
            blocked,
            reason: blocked ? blockReason : 'Mở bán lại',
            idempotencyKey: `admin-seat-block-${crypto.randomUUID()}`,
          },
        },
        'setSeatBlocked',
        session.accessToken,
      );
      setBusy(false);
      setMessage(
        `${result.changed ? 'Đã cập nhật' : 'Không thay đổi'} ${result.seatIds.join(', ')} sang ${result.blocked ? 'BLOCKED' : 'AVAILABLE'}.`,
      );
    } catch (error) {
      setBusy(false);
      setMessage(errorMessage(error));
    }
  }

  return (
    <section className="operations-shell" aria-labelledby="trip-preparation-title">
      <div className="operations-heading">
        <div>
          <p className="eyebrow">Milestone 5 · Trip preparation</p>
          <h1 id="trip-preparation-title">
            Chuẩn bị một chuyến hoàn chỉnh từ dữ liệu đã kiểm duyệt.
          </h1>
        </div>
        <span>{session?.user.displayName ?? 'Chưa xác thực ADMIN'}</span>
      </div>
      <div className="operations-grid">
        <form className="ticket-lookup" onSubmit={handleSubmit}>
          <span className="operations-index">OPS / 03</span>
          <h2>Tạo chuyến SCHEDULED</h2>
          <label>
            Tuyến
            <select value={routeId} onChange={(event) => setRouteId(event.target.value)}>
              {options.routes.map((route) => (
                <option key={route.id} value={route.id}>
                  {route.code} · {route.originName} → {route.destinationName}
                </option>
              ))}
            </select>
          </label>
          <label>
            Xe
            <select value={vehicleId} onChange={(event) => setVehicleId(event.target.value)}>
              {options.vehicles.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.operatorName} · {item.code} · {item.plate}
                </option>
              ))}
            </select>
          </label>
          <p>
            {vehicle
              ? `${vehicle.vehicleTypeName} · ${vehicle.seatLayoutName} v${vehicle.seatLayoutVersion}`
              : 'Chưa có xe khả dụng.'}
          </p>
          <label>
            Khởi hành
            <input
              type="datetime-local"
              value={departureAt}
              onChange={(event) => setDepartureAt(event.target.value)}
            />
          </label>
          <label>
            Đến dự kiến
            <input
              type="datetime-local"
              value={arrivalAt}
              onChange={(event) => setArrivalAt(event.target.value)}
            />
          </label>
          <label>
            Giá vé VND
            <input
              inputMode="numeric"
              value={priceVnd}
              onChange={(event) => setPriceVnd(event.target.value)}
            />
          </label>
          <button disabled={busy || !session || !routeId || !vehicle || !priceVnd} type="submit">
            {busy ? 'Đang xử lý…' : 'Tạo chuyến và fare'}
          </button>
          {!session && <a href="/login">Đăng nhập tài khoản ADMIN</a>}
        </form>
        <div className="ticket-results" aria-live="polite">
          <p className="operations-message" role="status">
            {message}
          </p>
          <div className="admin-seat-block">
            <span className="operations-index">OPS / 04</span>
            <h2>Khóa ghế vận hành</h2>
            <label>
              Trip ID
              <input value={seatTripId} onChange={(event) => setSeatTripId(event.target.value)} />
            </label>
            <label>
              Mã ghế, cách nhau bằng dấu phẩy
              <input value={seatIds} onChange={(event) => setSeatIds(event.target.value)} />
            </label>
            <label>
              Lý do khóa
              <input value={blockReason} onChange={(event) => setBlockReason(event.target.value)} />
            </label>
            <div className="ticket-document-actions">
              <button
                disabled={busy || !session || !seatTripId || !seatIds}
                onClick={() => void handleSeatBlock(true)}
                type="button"
              >
                Khóa ghế
              </button>
              <button
                disabled={busy || !session || !seatTripId || !seatIds}
                onClick={() => void handleSeatBlock(false)}
                type="button"
              >
                Mở bán lại
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

async function adminGraphql<T>(
  query: string,
  variables: Record<string, unknown>,
  field: string,
  token: string,
): Promise<T> {
  const response = await fetch('/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
  });
  const body = (await response.json()) as {
    data?: Record<string, T>;
    errors?: Array<{ message: string; extensions?: { code?: string } }>;
  };
  const error = body.errors?.[0];
  const data = body.data?.[field];
  if (!response.ok || error || data === undefined) {
    const failure = new Error(error?.message ?? 'Không thể hoàn tất thao tác Catalog.');
    failure.name = error?.extensions?.code ?? 'ADMIN_OPERATION_ERROR';
    throw failure;
  }
  return data;
}

function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return 'Không thể hoàn tất thao tác Catalog.';
  if (error.name === 'FORBIDDEN') return 'Chỉ ADMIN được phép chuẩn bị chuyến.';
  if (error.name === 'INVALID_CONFIGURATION')
    return 'Tuyến, xe hoặc sơ đồ ghế không còn tương thích.';
  return error.message;
}
