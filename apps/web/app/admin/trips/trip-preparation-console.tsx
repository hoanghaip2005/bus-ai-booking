'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { displayOperatorName } from '../../lib/display';
import { type StoredAuthSession } from '../../lib/auth-session';
import { AdminClientError, authorizedGraphql, loadAuthorizedSession } from '../admin-client';
import { AdminPagination, AdminSearch, normalizeAdminSearch, pageItems } from '../admin-ui';

interface CatalogLocation {
  id: string;
  name: string;
}

interface CatalogRoute {
  id: string;
  code: string;
  originLocationId: string;
  destinationLocationId: string;
  durationMinutes: number;
  isActive: boolean;
}

interface CatalogVehicle {
  id: string;
  code: string;
  plate: string;
  operatorId: string;
  seatLayoutVersionId: string;
  isActive: boolean;
}

interface CatalogTrip {
  id: string;
  routeId: string;
  vehicleId: string;
  departureAt: string;
  arrivalAt: string;
  priceVnd: number;
  status: string;
  isActive: boolean;
}

interface TripCatalog {
  locations: CatalogLocation[];
  operators: Array<{ id: string; name: string }>;
  vehicles: CatalogVehicle[];
  routes: CatalogRoute[];
  trips: CatalogTrip[];
}

const tripWorkspaceQuery = `query AdminTripWorkspace {
  adminCatalog {
    locations { id name }
    operators { id name }
    routes { id code originLocationId destinationLocationId durationMinutes isActive }
    vehicles { id code plate operatorId seatLayoutVersionId isActive }
    trips { id routeId vehicleId departureAt arrivalAt priceVnd status isActive }
  }
}`;

const tripLifecycleSteps = [
  { status: 'SCHEDULED', label: 'Đã lên lịch', hint: 'Sẵn sàng bán vé' },
  { status: 'DEPARTED', label: 'Đã khởi hành', hint: 'Đang vận hành' },
  { status: 'COMPLETED', label: 'Đã hoàn tất', hint: 'Đã kết thúc' },
] as const;

export function TripPreparationConsole() {
  const [session, setSession] = useState<StoredAuthSession | null>(null);
  const [catalog, setCatalog] = useState<TripCatalog | null>(null);
  const [selectedTripId, setSelectedTripId] = useState('');
  const [routeId, setRouteId] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [departureAt, setDepartureAt] = useState(defaultDeparture());
  const [arrivalAt, setArrivalAt] = useState(defaultArrival());
  const [priceVnd, setPriceVnd] = useState('280000');
  const [seatIds, setSeatIds] = useState('A03');
  const [blockReason, setBlockReason] = useState('Bảo trì ghế');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Đang kiểm tra phiên quản trị…');

  const selectedTrip = catalog?.trips.find((trip) => trip.id === selectedTripId);
  const selectedRoute = catalog?.routes.find((route) => route.id === routeId);
  const selectedVehicle = catalog?.vehicles.find((vehicle) => vehicle.id === vehicleId);
  const selectedTripStage = selectedTrip ? tripStatusIndex(selectedTrip.status) : -1;

  useEffect(() => {
    void loadAuthorizedSession().then((stored) => {
      if (!stored) {
        setMessage('Phiên quản trị đã hết hạn. Vui lòng đăng nhập lại.');
        return;
      }
      setSession(stored);
      void reloadCatalog();
    });
  }, []);

  async function reloadCatalog(preferredTripId?: string) {
    setBusy(true);
    try {
      const response = await authorizedGraphql<{ adminCatalog: TripCatalog }>(
        tripWorkspaceQuery,
        {},
      );
      const nextCatalog = response.data.adminCatalog;
      setSession(response.session);
      setCatalog(nextCatalog);
      setRouteId(
        (current) => current || nextCatalog.routes.find((item) => item.isActive)?.id || '',
      );
      setVehicleId(
        (current) => current || nextCatalog.vehicles.find((item) => item.isActive)?.id || '',
      );
      if (preferredTripId) selectTrip(nextCatalog, preferredTripId);
      setMessage('Danh sách chuyến đã được cập nhật.');
    } catch (error) {
      handleFailure(error);
    } finally {
      setBusy(false);
    }
  }

  function selectTrip(source: TripCatalog, tripId: string) {
    const trip = source.trips.find((item) => item.id === tripId);
    if (!trip) return;
    setSelectedTripId(trip.id);
    setRouteId(trip.routeId);
    setVehicleId(trip.vehicleId);
    setDepartureAt(toDateTimeLocal(trip.departureAt));
    setArrivalAt(toDateTimeLocal(trip.arrivalAt));
    setPriceVnd(String(trip.priceVnd));
  }

  function chooseTrip(tripId: string) {
    if (catalog) selectTrip(catalog, tripId);
  }

  function resetForm() {
    setSelectedTripId('');
    setRouteId(catalog?.routes.find((item) => item.isActive)?.id ?? '');
    setVehicleId(catalog?.vehicles.find((item) => item.isActive)?.id ?? '');
    setDepartureAt(defaultDeparture());
    setArrivalAt(defaultArrival());
    setPriceVnd('280000');
    setMessage('Đang tạo một chuyến mới.');
  }

  function handleRouteChange(nextRouteId: string) {
    setRouteId(nextRouteId);
    const route = catalog?.routes.find((item) => item.id === nextRouteId);
    if (!route) return;
    const departure = new Date(hoChiMinhLocalToUtc(departureAt));
    if (!Number.isNaN(departure.getTime())) {
      setArrivalAt(
        toHoChiMinhDateTimeLocal(new Date(departure.getTime() + route.durationMinutes * 60_000)),
      );
    }
  }

  async function saveTrip(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedVehicle) return;
    const validation = validateTripInput(departureAt, arrivalAt, priceVnd);
    if (validation) {
      setMessage(validation);
      return;
    }
    setBusy(true);
    try {
      if (selectedTripId) {
        const response = await authorizedGraphql<{
          updateAdminTrip: { id: string; changed: boolean };
        }>(
          'mutation UpdateTrip($input: UpdateAdminTripInput!) { updateAdminTrip(input:$input) { id changed } }',
          {
            input: {
              id: selectedTripId,
              routeId,
              vehicleId,
              seatLayoutVersionId: selectedVehicle.seatLayoutVersionId,
              departureAt: hoChiMinhLocalToUtc(departureAt),
              arrivalAt: hoChiMinhLocalToUtc(arrivalAt),
              priceVnd: Number(priceVnd),
              idempotencyKey: `admin-update-trip-${crypto.randomUUID()}`,
            },
          },
        );
        setSession(response.session);
        await reloadCatalog(selectedTripId);
        setMessage(
          response.data.updateAdminTrip.changed
            ? 'Đã cập nhật chuyến, xe, giờ chạy và giá vé.'
            : 'Không có thay đổi mới cho chuyến này.',
        );
      } else {
        const response = await authorizedGraphql<{
          createTrip: { tripId: string; created: boolean };
        }>(
          'mutation CreateTrip($input: CreateTripInput!) { createTrip(input:$input) { tripId created status departureAt arrivalAt priceVnd } }',
          {
            input: {
              routeId,
              vehicleId,
              seatLayoutVersionId: selectedVehicle.seatLayoutVersionId,
              departureAt: hoChiMinhLocalToUtc(departureAt),
              arrivalAt: hoChiMinhLocalToUtc(arrivalAt),
              priceVnd: Number(priceVnd),
              idempotencyKey: `admin-create-trip-${crypto.randomUUID()}`,
            },
          },
        );
        setSession(response.session);
        setSelectedTripId(response.data.createTrip.tripId);
        await reloadCatalog(response.data.createTrip.tripId);
        setMessage(
          response.data.createTrip.created
            ? 'Đã tạo chuyến mới. Bạn có thể tiếp tục quản lý ghế và trạng thái.'
            : 'Chuyến đã tồn tại và đã được chọn.',
        );
      }
    } catch (error) {
      handleFailure(error);
    } finally {
      setBusy(false);
    }
  }

  async function setTripActive(isActive: boolean) {
    if (!selectedTripId) return;
    await runCommand(
      'mutation SetTripActive($input: SetTripActiveInput!) { setTripActive(input:$input) { tripId isActive changed } }',
      { input: { tripId: selectedTripId, isActive } },
      isActive ? 'Đã mở bán lại chuyến.' : 'Đã tạm khóa chuyến.',
    );
  }

  async function transitionTrip(targetStatus: 'DEPARTED' | 'COMPLETED') {
    if (!selectedTripId) return;
    await runCommand(
      'mutation TransitionTrip($input: TransitionTripStatusInput!) { transitionTripStatus(input:$input) { tripId previousStatus status changed transitionedAt } }',
      {
        input: {
          tripId: selectedTripId,
          targetStatus,
          idempotencyKey: `admin-trip-status-${crypto.randomUUID()}`,
        },
      },
      targetStatus === 'DEPARTED' ? 'Đã đánh dấu chuyến khởi hành.' : 'Đã hoàn tất chuyến.',
    );
  }

  async function setSeatsBlocked(blocked: boolean) {
    if (!selectedTripId) return;
    const normalizedSeatIds = seatIds
      .split(',')
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean);
    if (normalizedSeatIds.length === 0) {
      setMessage('Nhập ít nhất một mã ghế cần cập nhật.');
      return;
    }
    await runCommand(
      'mutation SetSeatBlocked($input: SetSeatBlockedInput!) { setSeatBlocked(input:$input) { tripId seatIds blocked changed updatedAt } }',
      {
        input: {
          tripId: selectedTripId,
          seatIds: normalizedSeatIds,
          blocked,
          reason: blocked ? blockReason : 'Mở bán lại',
          idempotencyKey: `admin-seat-block-${crypto.randomUUID()}`,
        },
      },
      `${blocked ? 'Đã khóa' : 'Đã mở bán lại'} ghế ${normalizedSeatIds.join(', ')}.`,
      false,
    );
  }

  async function runCommand(
    mutation: string,
    variables: Record<string, unknown>,
    successMessage: string,
    reload = true,
  ) {
    setBusy(true);
    try {
      const response = await authorizedGraphql<Record<string, unknown>>(mutation, variables);
      setSession(response.session);
      if (reload) await reloadCatalog(selectedTripId);
      setMessage(successMessage);
    } catch (error) {
      handleFailure(error);
    } finally {
      setBusy(false);
    }
  }

  function handleFailure(error: unknown) {
    if (error instanceof AdminClientError && error.code === 'UNAUTHENTICATED') {
      setSession(null);
      setMessage('Phiên quản trị đã hết hạn. Vui lòng đăng nhập lại.');
      return;
    }
    if (error instanceof AdminClientError && error.code === 'INVALID_CONFIGURATION') {
      setMessage('Tuyến, xe hoặc sơ đồ ghế không còn tương thích. Hãy tải lại danh sách.');
      return;
    }
    setMessage(error instanceof Error ? error.message : 'Không thể hoàn tất thao tác chuyến.');
  }

  const filteredTrips = useMemo(() => {
    if (!catalog) return [];
    const normalized = normalizeAdminSearch(query);
    const sorted = [...catalog.trips].sort(
      (left, right) => Date.parse(right.departureAt) - Date.parse(left.departureAt),
    );
    if (!normalized) return sorted;
    return sorted.filter((trip) =>
      normalizeAdminSearch(tripSearchText(catalog, trip)).includes(normalized),
    );
  }, [catalog, query]);
  const visibleTrips = pageItems(filteredTrips, page);

  if (!session) {
    return (
      <section className="operations-shell" aria-labelledby="trip-preparation-title">
        <div className="operations-heading">
          <div>
            <p className="eyebrow">Điều phối lịch chạy</p>
            <h1 id="trip-preparation-title">Quản lý lịch chạy và vận hành chuyến xe.</h1>
          </div>
          <span>Chưa đăng nhập</span>
        </div>
        <div className="account-access-state">
          <strong>Phiên quản trị không còn hiệu lực</strong>
          <p>{message}</p>
          <Link href="/login">Đăng nhập quản trị</Link>
        </div>
      </section>
    );
  }

  return (
    <section className="operations-shell" aria-labelledby="trip-preparation-title">
      <div className="operations-heading">
        <div>
          <p className="eyebrow">Điều phối lịch chạy</p>
          <h1 id="trip-preparation-title">Quản lý lịch chạy và vận hành chuyến xe.</h1>
        </div>
        <span>{session.user.displayName}</span>
      </div>

      <p className="operations-message" role="status" aria-live="polite">
        {busy ? 'Đang xử lý…' : message}
      </p>

      <div className="admin-workspace-grid">
        <section className="operations-ledger admin-trip-list" aria-labelledby="trip-list-title">
          <div className="operations-section-heading">
            <span>LỊCH CHẠY</span>
            <h2 id="trip-list-title">Danh sách chuyến</h2>
          </div>
          <AdminSearch
            label="Tìm tuyến, xe, trạng thái hoặc mã chuyến"
            value={query}
            onChange={(value) => {
              setQuery(value);
              setPage(1);
            }}
            resultCount={filteredTrips.length}
          />
          <button className="admin-secondary-action" type="button" onClick={resetForm}>
            + Tạo chuyến mới
          </button>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Tuyến và giờ chạy</th>
                  <th>Xe</th>
                  <th>Giá vé</th>
                  <th>Trạng thái</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visibleTrips.map((trip) => (
                  <TripRow
                    key={trip.id}
                    catalog={catalog!}
                    trip={trip}
                    selected={trip.id === selectedTripId}
                    onSelect={() => chooseTrip(trip.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
          {filteredTrips.length === 0 && <p>Không tìm thấy chuyến phù hợp.</p>}
          <AdminPagination page={page} totalItems={filteredTrips.length} onChange={setPage} />
        </section>

        <div className="admin-trip-editor">
          <form className="ticket-lookup" onSubmit={saveTrip}>
            <span className="operations-index">{selectedTrip ? 'CHỈNH SỬA' : 'CHUYẾN MỚI'}</span>
            <h2>{selectedTrip ? 'Cập nhật chuyến' : 'Tạo chuyến mới'}</h2>
            <label>
              Tuyến
              <select value={routeId} onChange={(event) => handleRouteChange(event.target.value)}>
                {(catalog?.routes ?? []).map((route) => (
                  <option key={route.id} value={route.id} disabled={!route.isActive}>
                    {routeLabel(catalog!, route)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Xe được gán
              <select value={vehicleId} onChange={(event) => setVehicleId(event.target.value)}>
                {(catalog?.vehicles ?? []).map((vehicle) => (
                  <option key={vehicle.id} value={vehicle.id} disabled={!vehicle.isActive}>
                    {vehicleLabel(catalog!, vehicle)}
                  </option>
                ))}
              </select>
            </label>
            <div className="admin-form-grid">
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
            </div>
            <label>
              Giá vé VND
              <input
                inputMode="numeric"
                value={priceVnd}
                onChange={(event) => setPriceVnd(event.target.value.replace(/\D/g, ''))}
              />
            </label>
            <p>
              {selectedRoute
                ? `${selectedRoute.durationMinutes} phút dự kiến`
                : 'Chọn tuyến hợp lệ'}{' '}
              · {selectedVehicle ? vehicleLabel(catalog!, selectedVehicle) : 'Chọn xe hợp lệ'}
            </p>
            <button
              disabled={
                busy ||
                !routeId ||
                !selectedVehicle ||
                Boolean(selectedTrip && selectedTrip.status !== 'SCHEDULED')
              }
              type="submit"
            >
              {selectedTrip ? 'Lưu thay đổi' : 'Tạo chuyến'}
            </button>
          </form>

          {selectedTrip && (
            <section
              className="operations-ledger admin-trip-actions"
              aria-labelledby="trip-actions-title"
            >
              <div className="operations-section-heading">
                <span>VẬN HÀNH</span>
                <h2 id="trip-actions-title">Trạng thái chuyến</h2>
              </div>
              <div className="admin-trip-summary">
                <div>
                  <span>CHUYẾN ĐANG CHỌN</span>
                  <strong>#{selectedTrip.id.slice(0, 8).toUpperCase()}</strong>
                </div>
                <div className="admin-trip-badges">
                  <span className="admin-trip-status-chip" data-status={selectedTrip.status}>
                    {tripStatusLabel(selectedTrip.status)}
                  </span>
                  <span className="admin-trip-sale-chip" data-active={selectedTrip.isActive}>
                    {selectedTrip.isActive ? 'Đang mở bán' : 'Đang tạm khóa'}
                  </span>
                </div>
              </div>
              <ol className="admin-trip-state-track" aria-label="Tiến trình chuyến">
                {tripLifecycleSteps.map((step, index) => (
                  <li
                    key={step.status}
                    aria-current={index === selectedTripStage ? 'step' : undefined}
                    data-state={
                      index < selectedTripStage
                        ? 'complete'
                        : index === selectedTripStage
                          ? 'current'
                          : 'upcoming'
                    }
                  >
                    <span>{index + 1}</span>
                    <div>
                      <strong>{step.label}</strong>
                      <small>{step.hint}</small>
                    </div>
                  </li>
                ))}
              </ol>
              <div className="admin-trip-action-sections">
                <section className="admin-trip-action-section" aria-labelledby="trip-sales-title">
                  <div className="admin-trip-action-heading">
                    <div>
                      <span>BÁN VÉ</span>
                      <h3 id="trip-sales-title">Quyền mở bán</h3>
                    </div>
                    <p>
                      {selectedTrip.isActive
                        ? 'Khách có thể tiếp tục đặt vé cho chuyến này.'
                        : 'Chuyến đang tạm khóa, khách không thể tạo booking mới.'}
                    </p>
                  </div>
                  <button
                    className="admin-trip-action-button admin-trip-action-button-sale"
                    type="button"
                    disabled={busy}
                    onClick={() => void setTripActive(!selectedTrip.isActive)}
                  >
                    {selectedTrip.isActive ? 'Tạm khóa bán vé' : 'Mở bán lại'}
                  </button>
                </section>
                <section
                  className="admin-trip-action-section"
                  aria-labelledby="trip-lifecycle-title"
                >
                  <div className="admin-trip-action-heading">
                    <div>
                      <span>VẬN HÀNH</span>
                      <h3 id="trip-lifecycle-title">Cập nhật tiến trình</h3>
                    </div>
                    <p>Chỉ mở bước tiếp theo khi chuyến đã sẵn sàng.</p>
                  </div>
                  <div className="admin-action-grid">
                    <button
                      className="admin-trip-action-button admin-trip-action-button-primary"
                      type="button"
                      disabled={
                        busy || selectedTrip.status !== 'SCHEDULED' || !selectedTrip.isActive
                      }
                      onClick={() => void transitionTrip('DEPARTED')}
                    >
                      Xác nhận xe đã khởi hành
                    </button>
                    <button
                      className="admin-trip-action-button admin-trip-action-button-primary"
                      type="button"
                      disabled={busy || selectedTrip.status !== 'DEPARTED'}
                      onClick={() => void transitionTrip('COMPLETED')}
                    >
                      Xác nhận chuyến hoàn tất
                    </button>
                  </div>
                </section>
                <nav className="admin-trip-action-links" aria-label="Liên kết vận hành chuyến">
                  <Link href={`/admin/operations?tripId=${selectedTrip.id}`}>
                    Xem booking theo chuyến
                  </Link>
                  <Link href="/staff/check-in">Mở bàn check-in</Link>
                </nav>
              </div>
            </section>
          )}

          <section
            className="operations-ledger admin-seat-block"
            aria-labelledby="seat-block-title"
            data-selected-trip-id={selectedTripId || undefined}
          >
            <div className="operations-section-heading">
              <span>KHO GHẾ</span>
              <h2 id="seat-block-title">Tạm khóa ghế</h2>
            </div>
            {selectedTrip ? (
              <div className="admin-selected-trip-context">
                <strong>
                  {routeLabel(
                    catalog!,
                    catalog!.routes.find((route) => route.id === selectedTrip.routeId)!,
                  )}
                </strong>
                <span>
                  {formatDateTime(selectedTrip.departureAt)} · Đang quản lý kho ghế của chuyến đã
                  chọn.
                </span>
              </div>
            ) : (
              <p className="admin-helper">Chọn một chuyến trong danh sách để quản lý kho ghế.</p>
            )}
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
                disabled={busy || !selectedTripId || !seatIds}
                onClick={() => void setSeatsBlocked(true)}
                type="button"
              >
                Khóa ghế
              </button>
              <button
                disabled={busy || !selectedTripId || !seatIds}
                onClick={() => void setSeatsBlocked(false)}
                type="button"
              >
                Mở bán lại
              </button>
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}

function TripRow({
  catalog,
  trip,
  selected,
  onSelect,
}: {
  catalog: TripCatalog;
  trip: CatalogTrip;
  selected: boolean;
  onSelect: () => void;
}) {
  const route = catalog.routes.find((item) => item.id === trip.routeId);
  const vehicle = catalog.vehicles.find((item) => item.id === trip.vehicleId);
  return (
    <tr data-selected={selected || undefined}>
      <td>
        <strong>{route ? routeLabel(catalog, route) : 'Tuyến không còn tồn tại'}</strong>
        <span>{formatDateTime(trip.departureAt)}</span>
      </td>
      <td>{vehicle ? `${vehicle.code} · ${vehicle.plate}` : 'Xe không còn tồn tại'}</td>
      <td>{trip.priceVnd.toLocaleString('vi-VN')} ₫</td>
      <td>
        <span className="admin-status" data-status={trip.status.toLowerCase()}>
          {tripStatusLabel(trip.status)}
        </span>
      </td>
      <td>
        <button type="button" onClick={onSelect}>
          {selected ? 'Đang chọn' : 'Quản lý'}
        </button>
      </td>
    </tr>
  );
}

function tripSearchText(catalog: TripCatalog, trip: CatalogTrip): string {
  const route = catalog.routes.find((item) => item.id === trip.routeId);
  const vehicle = catalog.vehicles.find((item) => item.id === trip.vehicleId);
  return `${trip.id} ${trip.status} ${route ? routeLabel(catalog, route) : ''} ${vehicle ? vehicleLabel(catalog, vehicle) : ''}`;
}

function routeLabel(catalog: TripCatalog, route: CatalogRoute): string {
  const origin = catalog.locations.find((item) => item.id === route.originLocationId)?.name;
  const destination = catalog.locations.find(
    (item) => item.id === route.destinationLocationId,
  )?.name;
  return `${route.code} · ${origin ?? 'Điểm đi'} → ${destination ?? 'Điểm đến'}`;
}

function vehicleLabel(catalog: TripCatalog, vehicle: CatalogVehicle): string {
  const operator = catalog.operators.find((item) => item.id === vehicle.operatorId)?.name;
  return `${displayOperatorName(operator ?? 'Nhà xe')} · ${vehicle.code} · ${vehicle.plate}`;
}

function tripStatusLabel(status: string): string {
  if (status === 'SCHEDULED') return 'Đã lên lịch';
  if (status === 'DEPARTED') return 'Đã khởi hành';
  if (status === 'COMPLETED') return 'Đã hoàn tất';
  if (status === 'CANCELLED') return 'Đã hủy';
  return status;
}

function tripStatusIndex(status: string): number {
  return tripLifecycleSteps.findIndex((step) => step.status === status);
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

function validateTripInput(departure: string, arrival: string, price: string): string | undefined {
  const departureTime = Date.parse(hoChiMinhLocalToUtc(departure));
  const arrivalTime = Date.parse(hoChiMinhLocalToUtc(arrival));
  if (!Number.isFinite(departureTime) || !Number.isFinite(arrivalTime))
    return 'Ngày giờ chuyến không hợp lệ.';
  if (arrivalTime <= departureTime) return 'Giờ đến phải sau giờ khởi hành.';
  if (!Number.isSafeInteger(Number(price)) || Number(price) <= 0)
    return 'Giá vé phải là số nguyên VND lớn hơn 0.';
  return undefined;
}

function defaultDeparture(): string {
  return `${hoChiMinhDate(new Date(Date.now() + 24 * 60 * 60 * 1000))}T07:00`;
}

function defaultArrival(): string {
  return `${hoChiMinhDate(new Date(Date.now() + 24 * 60 * 60 * 1000))}T14:00`;
}

function toDateTimeLocal(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return toHoChiMinhDateTimeLocal(date);
}

function hoChiMinhDate(value: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}

function hoChiMinhLocalToUtc(value: string): string {
  const normalized = value.length === 16 ? `${value}:00` : value;
  return new Date(`${normalized}+07:00`).toISOString();
}

function toHoChiMinhDateTimeLocal(value: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}
