'use client';

import { useEffect, useMemo, useState } from 'react';

import { authStorageKey } from '../../lib/auth-session';
import { displayOperatorName } from '../../lib/display';

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
  const [seatTripId, setSeatTripId] = useState('');
  const [seatIds, setSeatIds] = useState('A03');
  const [blockReason, setBlockReason] = useState('Bảo trì ghế');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Đăng nhập bằng tài khoản quản trị để tiếp tục.');
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
          setMessage('Đã tải danh sách tuyến, xe và sơ đồ ghế.');
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
        result.created
          ? 'Đã tạo chuyến mới. Bạn có thể tiếp tục quản lý ghế cho chuyến này.'
          : 'Chuyến này đã tồn tại và đã được chọn để quản lý ghế.',
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
        `${result.changed ? 'Đã cập nhật' : 'Không thay đổi'} ${result.seatIds.join(', ')} sang ${result.blocked ? 'Tạm khóa' : 'Còn bán'}.`,
      );
    } catch (error) {
      setBusy(false);
      setMessage(errorMessage(error));
    }
  }

  if (!session) {
    return (
      <section className="operations-shell" aria-labelledby="trip-preparation-title">
        <div className="operations-heading">
          <div>
            <p className="eyebrow">Điều phối lịch chạy</p>
            <h1 id="trip-preparation-title">Tạo chuyến mới và quản lý ghế tạm khóa.</h1>
          </div>
          <span>Chưa đăng nhập</span>
        </div>
        <div className="account-access-state">
          <strong>Đăng nhập để điều phối chuyến xe</strong>
          <p>{message}</p>
          <a href="/login">Đăng nhập quản trị</a>
        </div>
      </section>
    );
  }

  return (
    <section className="operations-shell" aria-labelledby="trip-preparation-title">
      <div className="operations-heading">
        <div>
          <p className="eyebrow">Điều phối lịch chạy</p>
          <h1 id="trip-preparation-title">Tạo chuyến mới và quản lý ghế tạm khóa.</h1>
        </div>
        <span>{session?.user.displayName ?? 'Chưa đăng nhập'}</span>
      </div>
      <div className="operations-grid">
        <form className="ticket-lookup" onSubmit={handleSubmit}>
          <span className="operations-index">LỊCH CHẠY</span>
          <h2>Tạo chuyến mới</h2>
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
                  {displayOperatorName(item.operatorName)} · {item.code} · {item.plate}
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
            {busy ? 'Đang xử lý…' : 'Tạo chuyến'}
          </button>
        </form>
        <div className="ticket-results" aria-live="polite">
          <p className="operations-message" role="status">
            {message}
          </p>
          <div className="admin-seat-block">
            <span className="operations-index">KHO GHẾ</span>
            <h2>Tạm khóa ghế</h2>
            <label>
              Mã chuyến
              <input
                value={seatTripId}
                onChange={(event) => setSeatTripId(event.target.value)}
                placeholder="Tạo chuyến mới hoặc nhập mã chuyến"
              />
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
