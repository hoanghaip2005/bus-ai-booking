'use client';

import { useEffect, useState } from 'react';

import { SiteHeader } from '../../components/site-header';
import { authStorageKey } from '../../lib/auth-session';

type Session = { accessToken: string; user: { displayName: string; role: string } };
type Item = { id: string; code?: string; name?: string; isActive?: boolean };
type Catalog = {
  locations: Array<Item & { kind: 'CITY' | 'STATION'; parentLocationId?: string }>;
  operators: Item[];
  vehicleTypes: Array<Item & { seatCapacity: number }>;
  seatLayouts: Array<
    Item & { vehicleTypeId: string; version: number; deckCount: number; layoutJson: string }
  >;
  vehicles: Array<
    Item & { plate: string; operatorId: string; vehicleTypeId: string; seatLayoutVersionId: string }
  >;
  routes: Array<
    Item & { originLocationId: string; destinationLocationId: string; durationMinutes: number }
  >;
  trips: Array<
    Item & {
      routeId: string;
      vehicleId: string;
      departureAt: string;
      arrivalAt: string;
      priceVnd: number;
      status: string;
    }
  >;
};

const snapshotQuery = `query AdminCatalog { adminCatalog {
  locations { id code name kind parentLocationId isActive }
  operators { id code name isActive }
  vehicleTypes { id code name seatCapacity }
  seatLayouts { id vehicleTypeId version name deckCount layoutJson isActive }
  vehicles { id code plate operatorId vehicleTypeId seatLayoutVersionId isActive }
  routes { id code originLocationId destinationLocationId durationMinutes isActive }
  trips { id routeId vehicleId departureAt arrivalAt priceVnd status isActive }
} }`;

export default function AdminCatalogPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [message, setMessage] = useState('Đăng nhập bằng tài khoản quản trị để tiếp tục.');
  const [busy, setBusy] = useState(false);

  async function reload(activeSession: Session) {
    setBusy(true);
    try {
      setCatalog(
        await graphql<Catalog>(snapshotQuery, {}, 'adminCatalog', activeSession.accessToken),
      );
      setMessage('Dữ liệu danh mục đã được cập nhật.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể tải dữ liệu danh mục.');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const raw = sessionStorage.getItem(authStorageKey);
    if (!raw) return;
    try {
      const value = JSON.parse(raw) as Session;
      if (value.user.role !== 'ADMIN') return;
      setSession(value);
      void reload(value);
    } catch {
      sessionStorage.removeItem(authStorageKey);
    }
  }, []);

  async function mutate(field: string, query: string, input: Record<string, unknown>) {
    if (!session) return;
    setBusy(true);
    try {
      const result = await graphql<{ id: string; created: boolean; changed: boolean }>(
        query,
        { input: { ...input, idempotencyKey: `catalog-${crypto.randomUUID()}` } },
        field,
        session.accessToken,
      );
      setMessage(
        result.created
          ? 'Đã tạo dữ liệu mới.'
          : result.changed
            ? 'Đã lưu thay đổi.'
            : 'Không có thay đổi mới.',
      );
      await reload(session);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể lưu thay đổi.');
      setBusy(false);
    }
  }

  return (
    <main className="operations-page">
      <SiteHeader variant="admin" />
      <section className="operations-shell">
        <div className="operations-heading">
          <div>
            <p className="eyebrow">Danh mục vận hành</p>
            <h1>Quản lý tuyến, xe và điểm đón.</h1>
          </div>
          <span>{session?.user.displayName ?? 'Chưa đăng nhập'}</span>
        </div>
        {session ? (
          <p className="operations-message" role="status">
            {busy ? 'Đang xử lý…' : message}
          </p>
        ) : null}
        {!session ? (
          <div className="account-access-state">
            <strong>Đăng nhập để quản lý danh mục</strong>
            <p>{message}</p>
            <a href="/login">Đăng nhập quản trị</a>
          </div>
        ) : catalog ? (
          <CatalogForms catalog={catalog} disabled={busy} mutate={mutate} />
        ) : (
          <div className="results-state" role="status">
            <strong>Đang tải danh mục vận hành…</strong>
            <span>Tuyến, xe và điểm đón sẽ xuất hiện trong giây lát.</span>
          </div>
        )}
      </section>
    </main>
  );
}

function CatalogForms({
  catalog,
  disabled,
  mutate,
}: {
  catalog: Catalog;
  disabled: boolean;
  mutate: (field: string, query: string, input: Record<string, unknown>) => Promise<void>;
}) {
  const cities = catalog.locations.filter((item) => item.kind === 'CITY');
  const [locationName, setLocationName] = useState('Điểm đón mới');
  const [locationCode, setLocationCode] = useState('BEN-MOI');
  const [routeCode, setRouteCode] = useState('TUYEN-MOI');
  const [originId, setOriginId] = useState(cities[0]?.id ?? '');
  const [destinationId, setDestinationId] = useState(cities[1]?.id ?? '');
  const [layoutVersion, setLayoutVersion] = useState('99');
  const [vehicleCode, setVehicleCode] = useState('XE-MOI');
  const [plate, setPlate] = useState('51B-000.00');
  const [tripId, setTripId] = useState(catalog.trips[0]?.id ?? '');

  return (
    <div className="operations-ledger-grid">
      <Form
        title="Điểm đón và bến xe"
        onSubmit={() =>
          mutate(
            'saveAdminLocation',
            'mutation Save($input: SaveAdminLocationInput!) { saveAdminLocation(input:$input) { id created changed } }',
            {
              code: locationCode,
              name: locationName,
              kind: 'STATION',
              parentLocationId: cities[0]?.id,
            },
          )
        }
        disabled={disabled}
      >
        <label>
          Mã
          <input value={locationCode} onChange={(event) => setLocationCode(event.target.value)} />
        </label>
        <label>
          Tên
          <input value={locationName} onChange={(event) => setLocationName(event.target.value)} />
        </label>
      </Form>
      <Form
        title="Tuyến và thứ tự điểm dừng"
        onSubmit={() =>
          mutate(
            'saveAdminRoute',
            'mutation Save($input: SaveAdminRouteInput!) { saveAdminRoute(input:$input) { id created changed } }',
            {
              code: routeCode,
              originLocationId: originId,
              destinationLocationId: destinationId,
              durationMinutes: 360,
              stops: [
                { locationId: originId, stopOrder: 1, stopKind: 'PICKUP', offsetMinutes: 0 },
                {
                  locationId: destinationId,
                  stopOrder: 2,
                  stopKind: 'DROPOFF',
                  offsetMinutes: 360,
                },
              ],
            },
          )
        }
        disabled={disabled}
      >
        <label>
          Mã
          <input value={routeCode} onChange={(event) => setRouteCode(event.target.value)} />
        </label>
        <Select label="Điểm đi" value={originId} setValue={setOriginId} items={cities} />
        <Select label="Điểm đến" value={destinationId} setValue={setDestinationId} items={cities} />
      </Form>
      <Form
        title="Sơ đồ ghế"
        onSubmit={() =>
          mutate(
            'saveAdminSeatLayout',
            'mutation Save($input: SaveAdminSeatLayoutInput!) { saveAdminSeatLayout(input:$input) { id created changed } }',
            {
              vehicleTypeId: catalog.vehicleTypes[0]?.id,
              version: Number(layoutVersion),
              name: `Sơ đồ ghế phiên bản ${layoutVersion}`,
              deckCount: 1,
              layoutJson: JSON.stringify({
                seats: [{ id: 'A01', label: 'A01', deck: 1, row: 1, column: 1 }],
              }),
            },
          )
        }
        disabled={disabled}
      >
        <label>
          Phiên bản
          <input
            inputMode="numeric"
            value={layoutVersion}
            onChange={(event) => setLayoutVersion(event.target.value)}
          />
        </label>
        <p>Tạo phiên bản mới khi cấu hình ghế thay đổi.</p>
      </Form>
      <Form
        title="Phương tiện"
        onSubmit={() =>
          mutate(
            'saveAdminVehicle',
            'mutation Save($input: SaveAdminVehicleInput!) { saveAdminVehicle(input:$input) { id created changed } }',
            {
              code: vehicleCode,
              plate,
              operatorId: catalog.operators[0]?.id,
              vehicleTypeId: catalog.seatLayouts[0]?.vehicleTypeId,
              seatLayoutVersionId: catalog.seatLayouts[0]?.id,
            },
          )
        }
        disabled={disabled}
      >
        <label>
          Mã xe
          <input value={vehicleCode} onChange={(event) => setVehicleCode(event.target.value)} />
        </label>
        <label>
          Biển số
          <input value={plate} onChange={(event) => setPlate(event.target.value)} />
        </label>
      </Form>
      <Form
        title="Chuyến và giá vé"
        onSubmit={() => {
          const trip = catalog.trips.find((item) => item.id === tripId);
          const vehicle = catalog.vehicles.find((item) => item.id === trip?.vehicleId);
          if (trip && vehicle)
            return mutate(
              'updateAdminTrip',
              'mutation Save($input: UpdateAdminTripInput!) { updateAdminTrip(input:$input) { id created changed } }',
              {
                id: trip.id,
                routeId: trip.routeId,
                vehicleId: trip.vehicleId,
                seatLayoutVersionId: vehicle.seatLayoutVersionId,
                departureAt: trip.departureAt,
                arrivalAt: trip.arrivalAt,
                priceVnd: trip.priceVnd,
              },
            );
          return Promise.resolve();
        }}
        disabled={disabled}
      >
        <Select
          label="Chuyến"
          value={tripId}
          setValue={setTripId}
          items={catalog.trips.map((item) => {
            const route = catalog.routes.find((candidate) => candidate.id === item.routeId);
            const vehicle = catalog.vehicles.find((candidate) => candidate.id === item.vehicleId);
            return {
              ...item,
              code: `${formatTripDateTime(item.departureAt)} · ${route?.code ?? 'Tuyến chưa đặt mã'} · ${vehicle?.code ?? 'Xe chưa đặt mã'} · ${tripStatusLabel(item.status)}`,
            };
          })}
        />
        <p>Chỉ có thể cập nhật chuyến chưa khởi hành.</p>
      </Form>
      <section className="operations-ledger">
        <div className="operations-section-heading">
          <span>TRẠNG THÁI</span>
          <h2>Tạm ngừng hoặc mở lại</h2>
        </div>
        {[
          ...catalog.locations.slice(0, 4).map((item) => ({ ...item, resourceType: 'LOCATION' })),
          ...catalog.routes.slice(0, 4).map((item) => ({ ...item, resourceType: 'ROUTE' })),
          ...catalog.vehicles.slice(0, 4).map((item) => ({ ...item, resourceType: 'VEHICLE' })),
        ].map((item) => (
          <article className="operations-row" key={`${item.resourceType}-${item.id}`}>
            <div>
              <strong>{itemLabel(item)}</strong>
              <span>{resourceTypeLabel(item.resourceType)}</span>
            </div>
            <button
              disabled={disabled}
              onClick={() =>
                void mutate(
                  'setCatalogResourceActive',
                  'mutation Active($input: SetCatalogResourceActiveInput!) { setCatalogResourceActive(input:$input) { id changed isActive } }',
                  { resourceType: item.resourceType, id: item.id, isActive: !item.isActive },
                )
              }
            >
              {item.isActive ? 'Tạm ngừng' : 'Mở lại'}
            </button>
          </article>
        ))}
      </section>
    </div>
  );
}

function Form({
  title,
  onSubmit,
  disabled,
  children,
}: {
  title: string;
  onSubmit: () => Promise<void>;
  disabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <form
      className="ticket-lookup"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit();
      }}
    >
      <span className="operations-index">DANH MỤC</span>
      <h2>{title}</h2>
      {children}
      <button disabled={disabled} type="submit">
        Lưu thay đổi
      </button>
    </form>
  );
}

function Select({
  label,
  value,
  setValue,
  items,
}: {
  label: string;
  value: string;
  setValue: (value: string) => void;
  items: Item[];
}) {
  return (
    <label>
      {label}
      <select value={value} onChange={(event) => setValue(event.target.value)}>
        {items.map((item) => (
          <option key={item.id} value={item.id}>
            {itemLabel(item)}
          </option>
        ))}
      </select>
    </label>
  );
}

function itemLabel(item: Item): string {
  if (item.code && item.name) return `${item.code} · ${item.name}`;
  return item.code ?? item.name ?? 'Chưa đặt tên';
}

function resourceTypeLabel(type: string): string {
  if (type === 'LOCATION') return 'Điểm đón/trả';
  if (type === 'ROUTE') return 'Tuyến xe';
  if (type === 'VEHICLE') return 'Phương tiện';
  return 'Danh mục';
}

function tripStatusLabel(status: string): string {
  if (status === 'DRAFT') return 'Bản nháp';
  if (status === 'SCHEDULED') return 'Đã lên lịch';
  if (status === 'BOARDING') return 'Đang đón khách';
  if (status === 'DEPARTED') return 'Đã khởi hành';
  if (status === 'COMPLETED') return 'Đã hoàn tất';
  if (status === 'CANCELLED') return 'Đã hủy';
  return 'Chưa xác định';
}

function formatTripDateTime(value: string): string {
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

async function graphql<T>(
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
    errors?: Array<{ message: string }>;
  };
  if (!response.ok || body.errors?.[0] || body.data?.[field] === undefined)
    throw new Error(body.errors?.[0]?.message ?? 'Không thể xử lý yêu cầu danh mục.');
  return body.data[field]!;
}
