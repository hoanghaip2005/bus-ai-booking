'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { SiteHeader } from '../../components/site-header';
import { type StoredAuthSession } from '../../lib/auth-session';
import { AdminClientError, authorizedGraphql, loadAuthorizedSession } from '../admin-client';
import { AdminPagination, AdminSearch, normalizeAdminSearch, pageItems } from '../admin-ui';

type ResourceTab = 'locations' | 'routes' | 'vehicles' | 'layouts';

interface CatalogLocation {
  id: string;
  code: string;
  name: string;
  kind: 'CITY' | 'STATION';
  parentLocationId?: string | null;
  isActive: boolean;
}

interface CatalogRouteStop {
  id?: string;
  locationId: string;
  stopOrder: number;
  stopKind: 'PICKUP' | 'DROPOFF' | 'BOTH';
  offsetMinutes: number;
}

interface CatalogRoute {
  id: string;
  code: string;
  originLocationId: string;
  destinationLocationId: string;
  durationMinutes: number;
  isActive: boolean;
  stops: CatalogRouteStop[];
}

interface CatalogVehicle {
  id: string;
  code: string;
  plate: string;
  operatorId: string;
  vehicleTypeId: string;
  seatLayoutVersionId: string;
  isActive: boolean;
}

interface CatalogLayout {
  id: string;
  vehicleTypeId: string;
  version: number;
  name: string;
  deckCount: number;
  layoutJson: string;
  isActive: boolean;
}

interface CatalogData {
  locations: CatalogLocation[];
  operators: Array<{ id: string; code: string; name: string; isActive: boolean }>;
  vehicleTypes: Array<{ id: string; code: string; name: string; seatCapacity: number }>;
  seatLayouts: CatalogLayout[];
  vehicles: CatalogVehicle[];
  routes: CatalogRoute[];
}

const catalogQuery = `query AdminCatalogWorkspace { adminCatalog {
  locations { id code name kind parentLocationId isActive }
  operators { id code name isActive }
  vehicleTypes { id code name seatCapacity }
  seatLayouts { id vehicleTypeId version name deckCount layoutJson isActive }
  vehicles { id code plate operatorId vehicleTypeId seatLayoutVersionId isActive }
  routes { id code originLocationId destinationLocationId durationMinutes isActive stops { id locationId stopOrder stopKind offsetMinutes } }
} }`;

export default function AdminCatalogPage() {
  const [session, setSession] = useState<StoredAuthSession | null>(null);
  const [catalog, setCatalog] = useState<CatalogData | null>(null);
  const [tab, setTab] = useState<ResourceTab>('locations');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Đang kiểm tra phiên quản trị…');

  useEffect(() => {
    void loadAuthorizedSession().then((stored) => {
      if (!stored) {
        setMessage('Phiên quản trị đã hết hạn. Vui lòng đăng nhập lại.');
        return;
      }
      setSession(stored);
      void reload();
    });
  }, []);

  async function reload() {
    setBusy(true);
    try {
      const response = await authorizedGraphql<{ adminCatalog: CatalogData }>(catalogQuery, {});
      setSession(response.session);
      setCatalog(response.data.adminCatalog);
      setMessage('Dữ liệu danh mục đã được cập nhật.');
    } catch (error) {
      handleError(error);
    } finally {
      setBusy(false);
    }
  }

  async function mutate(query: string, input: Record<string, unknown>, success: string) {
    setBusy(true);
    try {
      const response = await authorizedGraphql<Record<string, unknown>>(query, {
        input: { ...input, idempotencyKey: `catalog-${crypto.randomUUID()}` },
      });
      setSession(response.session);
      await reload();
      setMessage(success);
    } catch (error) {
      handleError(error);
    } finally {
      setBusy(false);
    }
  }

  async function setActive(resourceType: string, id: string, isActive: boolean) {
    await mutate(
      'mutation SetCatalogActive($input: SetCatalogResourceActiveInput!) { setCatalogResourceActive(input:$input) { id changed isActive } }',
      { resourceType, id, isActive },
      isActive ? 'Đã mở lại dữ liệu danh mục.' : 'Đã tạm ngừng dữ liệu danh mục.',
    );
  }

  function handleError(error: unknown) {
    if (error instanceof AdminClientError && error.code === 'UNAUTHENTICATED') {
      setSession(null);
      setMessage('Phiên quản trị đã hết hạn. Vui lòng đăng nhập lại.');
      return;
    }
    setMessage(error instanceof Error ? error.message : 'Không thể xử lý yêu cầu danh mục.');
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

        {!session ? (
          <div className="account-access-state">
            <strong>Phiên quản trị không còn hiệu lực</strong>
            <p>{message}</p>
            <Link href="/login">Đăng nhập quản trị</Link>
          </div>
        ) : (
          <>
            <p className="operations-message" role="status" aria-live="polite">
              {busy ? 'Đang xử lý…' : message}
            </p>
            <nav className="admin-resource-tabs" aria-label="Nhóm dữ liệu danh mục">
              {(
                [
                  ['locations', 'Điểm dừng'],
                  ['routes', 'Tuyến xe'],
                  ['vehicles', 'Xe'],
                  ['layouts', 'Sơ đồ ghế'],
                ] as Array<[ResourceTab, string]>
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={tab === value}
                  onClick={() => setTab(value)}
                >
                  {label}
                </button>
              ))}
            </nav>
            {!catalog ? (
              <div className="results-state" role="status">
                <strong>Đang tải danh mục vận hành…</strong>
              </div>
            ) : tab === 'locations' ? (
              <LocationManager
                catalog={catalog}
                busy={busy}
                mutate={mutate}
                setActive={setActive}
              />
            ) : tab === 'routes' ? (
              <RouteManager catalog={catalog} busy={busy} mutate={mutate} setActive={setActive} />
            ) : tab === 'vehicles' ? (
              <VehicleManager catalog={catalog} busy={busy} mutate={mutate} setActive={setActive} />
            ) : (
              <LayoutManager catalog={catalog} busy={busy} mutate={mutate} setActive={setActive} />
            )}
          </>
        )}
      </section>
    </main>
  );
}

interface ManagerProps {
  catalog: CatalogData;
  busy: boolean;
  mutate: (query: string, input: Record<string, unknown>, success: string) => Promise<void>;
  setActive: (resourceType: string, id: string, isActive: boolean) => Promise<void>;
}

function LocationManager({ catalog, busy, mutate, setActive }: ManagerProps) {
  const [selectedId, setSelectedId] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'CITY' | 'STATION'>('STATION');
  const [parentLocationId, setParentLocationId] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const cities = catalog.locations.filter((item) => item.kind === 'CITY');
  const filtered = useMemo(() => {
    const normalized = normalizeAdminSearch(query);
    return catalog.locations.filter((item) =>
      normalizeAdminSearch(`${item.code} ${item.name} ${item.kind}`).includes(normalized),
    );
  }, [catalog.locations, query]);

  function select(item?: CatalogLocation) {
    setSelectedId(item?.id ?? '');
    setCode(item?.code ?? '');
    setName(item?.name ?? '');
    setKind(item?.kind ?? 'STATION');
    setParentLocationId(item?.parentLocationId ?? cities[0]?.id ?? '');
  }

  return (
    <ManagerLayout
      title="Điểm dừng và tỉnh thành"
      search={
        <AdminSearch
          label="Tìm theo mã, tên hoặc loại địa điểm"
          value={query}
          onChange={(value) => {
            setQuery(value);
            setPage(1);
          }}
          resultCount={filtered.length}
        />
      }
      list={
        <ResourceTable
          headers={['Mã', 'Tên', 'Loại', 'Trạng thái']}
          rows={pageItems(filtered, page).map((item) => ({
            id: item.id,
            cells: [
              item.code,
              item.name,
              item.kind === 'CITY' ? 'Tỉnh/thành' : 'Bến/điểm dừng',
              activeText(item.isActive),
            ],
            selected: selectedId === item.id,
            onSelect: () => select(item),
          }))}
          empty="Không tìm thấy địa điểm phù hợp."
          pagination={
            <AdminPagination page={page} totalItems={filtered.length} onChange={setPage} />
          }
        />
      }
      editor={
        <form
          className="admin-editor-form"
          onSubmit={(event) => {
            event.preventDefault();
            void mutate(
              'mutation SaveLocation($input: SaveAdminLocationInput!) { saveAdminLocation(input:$input) { id created changed } }',
              {
                ...(selectedId && { id: selectedId }),
                code,
                name,
                kind,
                parentLocationId: kind === 'STATION' ? parentLocationId : null,
              },
              selectedId ? 'Đã cập nhật điểm dừng.' : 'Đã tạo điểm dừng mới.',
            );
          }}
        >
          <EditorHeading
            title={selectedId ? 'Sửa địa điểm' : 'Thêm địa điểm'}
            onCreate={() => select()}
          />
          <label>
            Mã
            <input
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              required
            />
          </label>
          <label>
            Tên
            <input value={name} onChange={(event) => setName(event.target.value)} required />
          </label>
          <label>
            Loại
            <select
              value={kind}
              onChange={(event) => setKind(event.target.value as 'CITY' | 'STATION')}
            >
              <option value="CITY">Tỉnh/thành</option>
              <option value="STATION">Bến/điểm dừng</option>
            </select>
          </label>
          {kind === 'STATION' && (
            <label>
              Thuộc tỉnh/thành
              <select
                value={parentLocationId}
                onChange={(event) => setParentLocationId(event.target.value)}
              >
                {cities.map((city) => (
                  <option key={city.id} value={city.id}>
                    {city.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <EditorActions
            busy={busy}
            selectedId={selectedId}
            active={catalog.locations.find((item) => item.id === selectedId)?.isActive}
            onToggle={(active) => void setActive('LOCATION', selectedId, active)}
          />
        </form>
      }
    />
  );
}

function RouteManager({ catalog, busy, mutate, setActive }: ManagerProps) {
  const [selectedId, setSelectedId] = useState('');
  const [code, setCode] = useState('');
  const [originLocationId, setOriginLocationId] = useState(catalog.locations[0]?.id ?? '');
  const [destinationLocationId, setDestinationLocationId] = useState(
    catalog.locations[1]?.id ?? '',
  );
  const [durationMinutes, setDurationMinutes] = useState('360');
  const [stops, setStops] = useState<CatalogRouteStop[]>([]);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const filtered = useMemo(() => {
    const normalized = normalizeAdminSearch(query);
    return catalog.routes.filter((route) =>
      normalizeAdminSearch(
        `${route.code} ${locationName(catalog, route.originLocationId)} ${locationName(catalog, route.destinationLocationId)}`,
      ).includes(normalized),
    );
  }, [catalog, query]);

  function select(route?: CatalogRoute) {
    setSelectedId(route?.id ?? '');
    setCode(route?.code ?? '');
    setOriginLocationId(route?.originLocationId ?? catalog.locations[0]?.id ?? '');
    setDestinationLocationId(route?.destinationLocationId ?? catalog.locations[1]?.id ?? '');
    setDurationMinutes(String(route?.durationMinutes ?? 360));
    setStops(
      route?.stops.length
        ? route.stops.map((stop) => ({ ...stop }))
        : defaultStops(catalog.locations[0]?.id ?? '', catalog.locations[1]?.id ?? '', 360),
    );
  }

  return (
    <ManagerLayout
      title="Tuyến xe và thứ tự điểm dừng"
      search={
        <AdminSearch
          label="Tìm theo mã tuyến hoặc địa điểm"
          value={query}
          onChange={(value) => {
            setQuery(value);
            setPage(1);
          }}
          resultCount={filtered.length}
        />
      }
      list={
        <ResourceTable
          headers={['Mã tuyến', 'Điểm đi', 'Điểm đến', 'Trạng thái']}
          rows={pageItems(filtered, page).map((route) => ({
            id: route.id,
            cells: [
              route.code,
              locationName(catalog, route.originLocationId),
              locationName(catalog, route.destinationLocationId),
              activeText(route.isActive),
            ],
            selected: selectedId === route.id,
            onSelect: () => select(route),
          }))}
          empty="Không tìm thấy tuyến phù hợp."
          pagination={
            <AdminPagination page={page} totalItems={filtered.length} onChange={setPage} />
          }
        />
      }
      editor={
        <form
          className="admin-editor-form"
          onSubmit={(event) => {
            event.preventDefault();
            void mutate(
              'mutation SaveRoute($input: SaveAdminRouteInput!) { saveAdminRoute(input:$input) { id created changed } }',
              {
                ...(selectedId && { id: selectedId }),
                code,
                originLocationId,
                destinationLocationId,
                durationMinutes: Number(durationMinutes),
                stops: stops.map((stop, index) => ({
                  ...(stop.id && { id: stop.id }),
                  locationId: stop.locationId,
                  stopOrder: index + 1,
                  stopKind: stop.stopKind,
                  offsetMinutes: Number(stop.offsetMinutes),
                })),
              },
              selectedId ? 'Đã cập nhật tuyến xe.' : 'Đã tạo tuyến xe mới.',
            );
          }}
        >
          <EditorHeading
            title={selectedId ? 'Sửa tuyến xe' : 'Thêm tuyến xe'}
            onCreate={() => select()}
          />
          <label>
            Mã tuyến
            <input
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              required
            />
          </label>
          <div className="admin-form-grid">
            <LocationSelect
              label="Điểm đi"
              value={originLocationId}
              onChange={setOriginLocationId}
              locations={catalog.locations}
            />
            <LocationSelect
              label="Điểm đến"
              value={destinationLocationId}
              onChange={setDestinationLocationId}
              locations={catalog.locations}
            />
          </div>
          <label>
            Thời gian dự kiến (phút)
            <input
              inputMode="numeric"
              value={durationMinutes}
              onChange={(event) => setDurationMinutes(event.target.value.replace(/\D/g, ''))}
              required
            />
          </label>
          <div className="admin-stop-editor">
            <div className="admin-editor-heading">
              <strong>Thứ tự điểm dừng</strong>
              <button
                type="button"
                onClick={() =>
                  setStops([
                    ...stops,
                    {
                      locationId: catalog.locations[0]?.id ?? '',
                      stopOrder: stops.length + 1,
                      stopKind: 'BOTH',
                      offsetMinutes: 0,
                    },
                  ])
                }
              >
                + Thêm điểm
              </button>
            </div>
            {stops.map((stop, index) => (
              <div className="admin-stop-row" key={stop.id ?? `new-${index}`}>
                <span className="admin-stop-index" aria-label={`Điểm dừng ${index + 1}`}>
                  {index + 1}
                </span>
                <label className="admin-stop-location">
                  Điểm dừng
                  <select
                    value={stop.locationId}
                    onChange={(event) =>
                      setStops(
                        stops.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, locationId: event.target.value } : item,
                        ),
                      )
                    }
                  >
                    {catalog.locations.map((location) => (
                      <option key={location.id} value={location.id}>
                        {location.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="admin-stop-kind">
                  Phục vụ
                  <select
                    value={stop.stopKind}
                    onChange={(event) =>
                      setStops(
                        stops.map((item, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...item,
                                stopKind: event.target.value as CatalogRouteStop['stopKind'],
                              }
                            : item,
                        ),
                      )
                    }
                  >
                    <option value="PICKUP">Đón khách</option>
                    <option value="DROPOFF">Trả khách</option>
                    <option value="BOTH">Đón và trả</option>
                  </select>
                </label>
                <label className="admin-stop-offset">
                  Phút lệch
                  <input
                    aria-label={`Phút lệch điểm ${index + 1}`}
                    inputMode="numeric"
                    value={stop.offsetMinutes}
                    onChange={(event) =>
                      setStops(
                        stops.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, offsetMinutes: Number(event.target.value) }
                            : item,
                        ),
                      )
                    }
                  />
                </label>
                <button
                  aria-label={`Xóa điểm dừng ${index + 1}`}
                  type="button"
                  disabled={stops.length <= 2}
                  onClick={() => setStops(stops.filter((_, itemIndex) => itemIndex !== index))}
                >
                  Xóa điểm
                </button>
              </div>
            ))}
          </div>
          <EditorActions
            busy={busy}
            selectedId={selectedId}
            active={catalog.routes.find((item) => item.id === selectedId)?.isActive}
            onToggle={(active) => void setActive('ROUTE', selectedId, active)}
          />
        </form>
      }
    />
  );
}

function VehicleManager({ catalog, busy, mutate, setActive }: ManagerProps) {
  const [selectedId, setSelectedId] = useState('');
  const [code, setCode] = useState('');
  const [plate, setPlate] = useState('');
  const [operatorId, setOperatorId] = useState(catalog.operators[0]?.id ?? '');
  const [vehicleTypeId, setVehicleTypeId] = useState(catalog.vehicleTypes[0]?.id ?? '');
  const [seatLayoutVersionId, setSeatLayoutVersionId] = useState(catalog.seatLayouts[0]?.id ?? '');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const filtered = useMemo(() => {
    const normalized = normalizeAdminSearch(query);
    return catalog.vehicles.filter((item) =>
      normalizeAdminSearch(
        `${item.code} ${item.plate} ${catalog.operators.find((operator) => operator.id === item.operatorId)?.name ?? ''}`,
      ).includes(normalized),
    );
  }, [catalog, query]);

  function select(vehicle?: CatalogVehicle) {
    setSelectedId(vehicle?.id ?? '');
    setCode(vehicle?.code ?? '');
    setPlate(vehicle?.plate ?? '');
    setOperatorId(vehicle?.operatorId ?? catalog.operators[0]?.id ?? '');
    setVehicleTypeId(vehicle?.vehicleTypeId ?? catalog.vehicleTypes[0]?.id ?? '');
    setSeatLayoutVersionId(vehicle?.seatLayoutVersionId ?? catalog.seatLayouts[0]?.id ?? '');
  }

  const compatibleLayouts = catalog.seatLayouts.filter(
    (layout) => layout.vehicleTypeId === vehicleTypeId,
  );
  return (
    <ManagerLayout
      title="Phương tiện khai thác"
      search={
        <AdminSearch
          label="Tìm mã xe, biển số hoặc nhà xe"
          value={query}
          onChange={(value) => {
            setQuery(value);
            setPage(1);
          }}
          resultCount={filtered.length}
        />
      }
      list={
        <ResourceTable
          headers={['Mã xe', 'Biển số', 'Nhà xe', 'Trạng thái']}
          rows={pageItems(filtered, page).map((vehicle) => ({
            id: vehicle.id,
            cells: [
              vehicle.code,
              vehicle.plate,
              catalog.operators.find((item) => item.id === vehicle.operatorId)?.name ??
                'Không xác định',
              activeText(vehicle.isActive),
            ],
            selected: selectedId === vehicle.id,
            onSelect: () => select(vehicle),
          }))}
          empty="Không tìm thấy xe phù hợp."
          pagination={
            <AdminPagination page={page} totalItems={filtered.length} onChange={setPage} />
          }
        />
      }
      editor={
        <form
          className="admin-editor-form"
          onSubmit={(event) => {
            event.preventDefault();
            void mutate(
              'mutation SaveVehicle($input: SaveAdminVehicleInput!) { saveAdminVehicle(input:$input) { id created changed } }',
              {
                ...(selectedId && { id: selectedId }),
                code,
                plate,
                operatorId,
                vehicleTypeId,
                seatLayoutVersionId,
              },
              selectedId ? 'Đã cập nhật xe.' : 'Đã tạo xe mới.',
            );
          }}
        >
          <EditorHeading title={selectedId ? 'Sửa xe' : 'Thêm xe'} onCreate={() => select()} />
          <p className="admin-editor-helper">
            Khai báo phương tiện trước khi gán vào lịch chạy và bán vé.
          </p>
          <section className="admin-editor-section" aria-labelledby="vehicle-identity-title">
            <div className="admin-editor-section-heading">
              <span>NHẬN DIỆN</span>
              <strong id="vehicle-identity-title">Thông tin xe</strong>
            </div>
            <div className="admin-form-grid">
              <label>
                Mã xe
                <input
                  value={code}
                  onChange={(event) => setCode(event.target.value.toUpperCase())}
                  required
                />
              </label>
              <label>
                Biển số
                <input
                  value={plate}
                  onChange={(event) => setPlate(event.target.value.toUpperCase())}
                  required
                />
              </label>
            </div>
          </section>
          <section className="admin-editor-section" aria-labelledby="vehicle-config-title">
            <div className="admin-editor-section-heading">
              <span>KHAI THÁC</span>
              <strong id="vehicle-config-title">Cấu hình phục vụ</strong>
            </div>
            <label>
              Nhà xe
              <select value={operatorId} onChange={(event) => setOperatorId(event.target.value)}>
                {catalog.operators.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Loại xe
              <select
                value={vehicleTypeId}
                onChange={(event) => {
                  setVehicleTypeId(event.target.value);
                  setSeatLayoutVersionId(
                    catalog.seatLayouts.find(
                      (layout) => layout.vehicleTypeId === event.target.value,
                    )?.id ?? '',
                  );
                }}
              >
                {catalog.vehicleTypes.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {item.seatCapacity} chỗ
                  </option>
                ))}
              </select>
            </label>
            <label>
              Sơ đồ ghế
              <select
                value={seatLayoutVersionId}
                onChange={(event) => setSeatLayoutVersionId(event.target.value)}
              >
                {compatibleLayouts.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · v{item.version}
                  </option>
                ))}
              </select>
            </label>
          </section>
          <EditorActions
            busy={busy}
            selectedId={selectedId}
            active={catalog.vehicles.find((item) => item.id === selectedId)?.isActive}
            onToggle={(active) => void setActive('VEHICLE', selectedId, active)}
          />
        </form>
      }
    />
  );
}

function LayoutManager({ catalog, busy, mutate, setActive }: ManagerProps) {
  const [vehicleTypeId, setVehicleTypeId] = useState(catalog.vehicleTypes[0]?.id ?? '');
  const [version, setVersion] = useState(
    String(Math.max(0, ...catalog.seatLayouts.map((item) => item.version)) + 1),
  );
  const [name, setName] = useState('Sơ đồ ghế mới');
  const [deckCount, setDeckCount] = useState('1');
  const [rows, setRows] = useState('6');
  const [columns, setColumns] = useState('4');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const filtered = useMemo(() => {
    const normalized = normalizeAdminSearch(query);
    return catalog.seatLayouts.filter((item) =>
      normalizeAdminSearch(
        `${item.name} ${item.version} ${catalog.vehicleTypes.find((type) => type.id === item.vehicleTypeId)?.name ?? ''}`,
      ).includes(normalized),
    );
  }, [catalog, query]);
  const seats = generateSeats(Number(deckCount), Number(rows), Number(columns));
  return (
    <ManagerLayout
      title="Phiên bản sơ đồ ghế"
      search={
        <AdminSearch
          label="Tìm tên, phiên bản hoặc loại xe"
          value={query}
          onChange={(value) => {
            setQuery(value);
            setPage(1);
          }}
          resultCount={filtered.length}
        />
      }
      list={
        <ResourceTable
          headers={['Tên sơ đồ', 'Loại xe', 'Số ghế', 'Trạng thái']}
          rows={pageItems(filtered, page).map((layout) => ({
            id: layout.id,
            cells: [
              `${layout.name} · v${layout.version}`,
              catalog.vehicleTypes.find((item) => item.id === layout.vehicleTypeId)?.name ??
                'Không xác định',
              layoutSeatCount(layout.layoutJson).toLocaleString('vi-VN'),
              activeText(layout.isActive),
            ],
            onSelect: () => {
              setVehicleTypeId(layout.vehicleTypeId);
              setName(`${layout.name} bản mới`);
              setVersion(
                String(
                  Math.max(
                    ...catalog.seatLayouts
                      .filter((item) => item.vehicleTypeId === layout.vehicleTypeId)
                      .map((item) => item.version),
                  ) + 1,
                ),
              );
            },
          }))}
          empty="Không tìm thấy sơ đồ ghế phù hợp."
          pagination={
            <AdminPagination page={page} totalItems={filtered.length} onChange={setPage} />
          }
        />
      }
      editor={
        <form
          className="admin-editor-form"
          onSubmit={(event) => {
            event.preventDefault();
            void mutate(
              'mutation SaveLayout($input: SaveAdminSeatLayoutInput!) { saveAdminSeatLayout(input:$input) { id created changed } }',
              {
                vehicleTypeId,
                version: Number(version),
                name,
                deckCount: Number(deckCount),
                layoutJson: JSON.stringify({ seats }),
              },
              'Đã tạo phiên bản sơ đồ ghế mới.',
            );
          }}
        >
          <EditorHeading title="Tạo phiên bản sơ đồ ghế" />
          <p className="admin-editor-helper">
            Sơ đồ đã phát hành là bất biến; khi cấu hình thay đổi, hệ thống tạo phiên bản mới.
          </p>
          <section className="admin-editor-section" aria-labelledby="layout-version-title">
            <div className="admin-editor-section-heading">
              <span>PHIÊN BẢN</span>
              <strong id="layout-version-title">Thông tin phát hành</strong>
            </div>
            <label>
              Loại xe
              <select
                value={vehicleTypeId}
                onChange={(event) => setVehicleTypeId(event.target.value)}
              >
                {catalog.vehicleTypes.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {item.seatCapacity} chỗ
                  </option>
                ))}
              </select>
            </label>
            <div className="admin-form-grid">
              <label>
                Phiên bản
                <input
                  inputMode="numeric"
                  value={version}
                  onChange={(event) => setVersion(event.target.value.replace(/\D/g, ''))}
                />
              </label>
              <label>
                Tên sơ đồ
                <input value={name} onChange={(event) => setName(event.target.value)} />
              </label>
            </div>
          </section>
          <section className="admin-editor-section" aria-labelledby="layout-geometry-title">
            <div className="admin-editor-section-heading">
              <span>BỐ CỤC</span>
              <strong id="layout-geometry-title">Kích thước sơ đồ</strong>
            </div>
            <div className="admin-form-grid admin-form-grid-three">
              <label>
                Số tầng
                <input
                  inputMode="numeric"
                  value={deckCount}
                  onChange={(event) => setDeckCount(event.target.value.replace(/\D/g, ''))}
                />
              </label>
              <label>
                Số hàng
                <input
                  inputMode="numeric"
                  value={rows}
                  onChange={(event) => setRows(event.target.value.replace(/\D/g, ''))}
                />
              </label>
              <label>
                Số cột
                <input
                  inputMode="numeric"
                  value={columns}
                  onChange={(event) => setColumns(event.target.value.replace(/\D/g, ''))}
                />
              </label>
            </div>
            <div className="admin-layout-preview-heading">
              <strong>Xem trước sơ đồ</strong>
              <span>{seats.length.toLocaleString('vi-VN')} ghế</span>
            </div>
            <SeatLayoutPreview seats={seats} columns={Number(columns)} />
          </section>
          <button disabled={busy || seats.length === 0} type="submit">
            Tạo phiên bản sơ đồ
          </button>
          <section className="admin-editor-section" aria-labelledby="layout-active-title">
            <div className="admin-editor-section-heading">
              <span>ĐANG DÙNG</span>
              <strong id="layout-active-title">Phiên bản hiện có</strong>
            </div>
            <div className="admin-layout-statuses">
              {catalog.seatLayouts
                .filter((item) => item.vehicleTypeId === vehicleTypeId)
                .map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    disabled={busy}
                    onClick={() => void setActive('SEAT_LAYOUT', item.id, !item.isActive)}
                  >
                    {item.name}: {item.isActive ? 'Tạm ngừng' : 'Mở lại'}
                  </button>
                ))}
            </div>
          </section>
        </form>
      }
    />
  );
}

function ManagerLayout({
  title,
  search,
  list,
  editor,
}: {
  title: string;
  search: React.ReactNode;
  list: React.ReactNode;
  editor: React.ReactNode;
}) {
  return (
    <div className="admin-catalog-workspace">
      <section className="operations-ledger">
        <div className="operations-section-heading">
          <span>DANH SÁCH</span>
          <h2>{title}</h2>
        </div>
        {search}
        {list}
      </section>
      <aside className="admin-catalog-editor">{editor}</aside>
    </div>
  );
}

function ResourceTable({
  headers,
  rows,
  empty,
  pagination,
}: {
  headers: string[];
  rows: Array<{ id: string; cells: React.ReactNode[]; selected?: boolean; onSelect?: () => void }>;
  empty: string;
  pagination: React.ReactNode;
}) {
  return (
    <>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              {headers.map((header) => (
                <th key={header}>{header}</th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} data-selected={row.selected || undefined}>
                {row.cells.map((cell, index) => (
                  <td key={`${row.id}-${index}`}>{cell}</td>
                ))}
                <td>
                  <button type="button" onClick={row.onSelect}>
                    Chọn
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && <p>{empty}</p>}
      {pagination}
    </>
  );
}

function EditorHeading({ title, onCreate }: { title: string; onCreate?: () => void }) {
  return (
    <div className="admin-editor-heading">
      <div>
        <span className="operations-index">BIÊN TẬP</span>
        <h2>{title}</h2>
      </div>
      {onCreate && (
        <button type="button" onClick={onCreate}>
          + Tạo mới
        </button>
      )}
    </div>
  );
}

function EditorActions({
  busy,
  selectedId,
  active,
  onToggle,
}: {
  busy: boolean;
  selectedId: string;
  active?: boolean;
  onToggle: (active: boolean) => void;
}) {
  return (
    <div className="admin-editor-actions">
      <button disabled={busy} type="submit">
        Lưu thay đổi
      </button>
      {selectedId && (
        <button
          className="admin-danger-action"
          disabled={busy}
          type="button"
          onClick={() => onToggle(!active)}
        >
          {active ? 'Tạm ngừng' : 'Mở lại'}
        </button>
      )}
    </div>
  );
}

function LocationSelect({
  label,
  value,
  onChange,
  locations,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  locations: CatalogLocation[];
}) {
  return (
    <label>
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {locations.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function SeatLayoutPreview({
  seats,
  columns,
}: {
  seats: Array<{ id: string; deck: number }>;
  columns: number;
}) {
  const previewColumns = Math.min(8, Math.max(1, Number.isFinite(columns) ? columns : 1));
  return (
    <div
      className="admin-layout-preview"
      data-columns={previewColumns}
      aria-label={`Xem trước ${seats.length} ghế`}
    >
      {seats.slice(0, 80).map((seat) => (
        <span key={seat.id} title={`Tầng ${seat.deck}`}>
          {seat.id}
        </span>
      ))}
    </div>
  );
}

function defaultStops(
  originId: string,
  destinationId: string,
  duration: number,
): CatalogRouteStop[] {
  return [
    { locationId: originId, stopOrder: 1, stopKind: 'PICKUP', offsetMinutes: 0 },
    { locationId: destinationId, stopOrder: 2, stopKind: 'DROPOFF', offsetMinutes: duration },
  ];
}

function generateSeats(deckCount: number, rows: number, columns: number) {
  if (![deckCount, rows, columns].every((value) => Number.isInteger(value) && value > 0)) return [];
  const seats: Array<{ id: string; label: string; deck: number; row: number; column: number }> = [];
  for (let deck = 1; deck <= Math.min(deckCount, 4); deck += 1)
    for (let row = 1; row <= Math.min(rows, 30); row += 1)
      for (let column = 1; column <= Math.min(columns, 8); column += 1) {
        const prefix = String.fromCharCode(64 + Math.min(row, 26));
        const suffix = String(column + (deck - 1) * columns).padStart(2, '0');
        const id = `${prefix}${suffix}`;
        seats.push({ id, label: id, deck, row, column });
      }
  return seats;
}

function layoutSeatCount(layoutJson: string): number {
  try {
    const parsed = JSON.parse(layoutJson) as { seats?: unknown[] };
    return parsed.seats?.length ?? 0;
  } catch {
    return 0;
  }
}
function locationName(catalog: CatalogData, id: string): string {
  return catalog.locations.find((item) => item.id === id)?.name ?? 'Không xác định';
}
function activeText(active: boolean): string {
  return active ? 'Đang hoạt động' : 'Tạm ngừng';
}
