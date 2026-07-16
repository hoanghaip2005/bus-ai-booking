import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { CatalogDatabase, type CatalogTransaction } from './catalog.database';

export interface TripSearchEndpoints {
  originCityId: string;
  destinationCityId: string;
}

export type TripSort = 'DEPARTURE_EARLIEST' | 'PRICE_LOWEST' | 'DURATION_SHORTEST';

export interface TripSearchCriteria {
  travelDate: string;
  departureTimeFrom?: string;
  departureTimeTo?: string;
  minPriceVnd?: number;
  maxPriceVnd?: number;
  operatorCodes: string[];
  vehicleTypeCodes: string[];
  minimumRemainingSeats?: number;
  sort: TripSort;
}

export interface TripSummaryRecord {
  id: string;
  routeId: string;
  operatorName: string;
  vehicleTypeName: string;
  vehicleCode: string;
  originName: string;
  destinationName: string;
  pickupName: string;
  dropoffName: string;
  departureAt: string;
  arrivalAt: string;
  durationMinutes: number;
  priceVnd: number;
  remainingSeats: number;
}

export type TripStopKind = 'PICKUP' | 'DROPOFF' | 'BOTH';

export interface TripStopRecord {
  id: string;
  locationId: string;
  name: string;
  kind: TripStopKind;
  stopOrder: number;
  offsetMinutes: number;
  scheduledAt: string;
}

export interface SeatDefinitionRecord {
  id: string;
  label: string;
  deck: number;
  row: number;
  column: number;
}

export interface SeatLayoutRecord {
  id: string;
  version: number;
  name: string;
  deckCount: number;
  seats: SeatDefinitionRecord[];
}

export interface TripDetailRecord {
  id: string;
  routeId: string;
  routeCode: string;
  operatorName: string;
  vehicleTypeName: string;
  vehicleCode: string;
  vehiclePlate: string;
  originName: string;
  destinationName: string;
  departureAt: string;
  arrivalAt: string;
  durationMinutes: number;
  priceVnd: number;
  remainingSeats: number;
  status: 'SCHEDULED' | 'BOARDING';
  stops: TripStopRecord[];
  seatLayout: SeatLayoutRecord;
}

export interface TripActivationRecord {
  tripId: string;
  isActive: boolean;
  changed: boolean;
}

export type TripLifecycleStatus =
  'DRAFT' | 'SCHEDULED' | 'BOARDING' | 'DEPARTED' | 'COMPLETED' | 'CANCELLED';

export interface TripLifecycleTransitionRecord {
  tripId: string;
  previousStatus: TripLifecycleStatus;
  status: 'DEPARTED' | 'COMPLETED';
  changed: boolean;
  transitionedAt: string;
}

export interface TripLifecycleTransitionCommand {
  tripId: string;
  targetStatus: 'DEPARTED' | 'COMPLETED';
  idempotencyKey: string;
  actorId: string;
  requestId: string;
  traceId: string;
}

export interface AdminRouteOptionRecord {
  id: string;
  code: string;
  originName: string;
  destinationName: string;
  durationMinutes: number;
}

export interface AdminVehicleOptionRecord {
  id: string;
  code: string;
  plate: string;
  operatorName: string;
  vehicleTypeName: string;
  seatLayoutVersionId: string;
  seatLayoutVersion: number;
  seatLayoutName: string;
}

export interface TripPreparationOptionsRecord {
  routes: AdminRouteOptionRecord[];
  vehicles: AdminVehicleOptionRecord[];
}

export interface CreateTripCommand {
  routeId: string;
  vehicleId: string;
  seatLayoutVersionId: string;
  departureAt: Date;
  arrivalAt: Date;
  priceVnd: number;
  actorId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  requestId: string;
  traceId: string;
}

export interface CreatedTripRecord {
  tripId: string;
  routeId: string;
  vehicleId: string;
  seatLayoutVersionId: string;
  departureAt: string;
  arrivalAt: string;
  priceVnd: number;
  status: 'SCHEDULED';
  created: boolean;
  createdAt: string;
}

export type CatalogResourceType = 'LOCATION' | 'ROUTE' | 'VEHICLE' | 'SEAT_LAYOUT' | 'TRIP';

export interface AdminCatalogSnapshot {
  locations: Array<{
    id: string;
    code: string;
    name: string;
    kind: 'CITY' | 'STATION';
    parentLocationId?: string;
    isActive: boolean;
  }>;
  operators: Array<{ id: string; code: string; name: string; isActive: boolean }>;
  vehicleTypes: Array<{ id: string; code: string; name: string; seatCapacity: number }>;
  seatLayouts: Array<{
    id: string;
    vehicleTypeId: string;
    version: number;
    name: string;
    deckCount: number;
    layoutJson: string;
    isActive: boolean;
  }>;
  vehicles: Array<{
    id: string;
    code: string;
    plate: string;
    operatorId: string;
    vehicleTypeId: string;
    seatLayoutVersionId: string;
    isActive: boolean;
  }>;
  routes: Array<{
    id: string;
    code: string;
    originLocationId: string;
    destinationLocationId: string;
    durationMinutes: number;
    isActive: boolean;
    stops: Array<{
      id: string;
      locationId: string;
      stopOrder: number;
      stopKind: TripStopKind;
      offsetMinutes: number;
    }>;
  }>;
  trips: Array<{
    id: string;
    routeId: string;
    vehicleId: string;
    departureAt: string;
    arrivalAt: string;
    priceVnd: number;
    status: TripLifecycleStatus;
    isActive: boolean;
  }>;
}

export interface CatalogAdminCommandBase {
  resourceType: CatalogResourceType;
  id?: string;
  actorId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  requestId: string;
  traceId: string;
}

export type SaveCatalogCommand = CatalogAdminCommandBase & { values: Record<string, unknown> };

export interface SaveCatalogResourceRecord {
  resourceType: CatalogResourceType;
  id: string;
  created: boolean;
  changed: boolean;
  isActive: boolean;
  updatedAt: string;
}

interface EndpointRow {
  origin_city_id: string | null;
  destination_city_id: string | null;
}

interface TripRow {
  id: string;
  route_id: string;
  operator_name: string;
  vehicle_type_name: string;
  vehicle_code: string;
  origin_name: string;
  destination_name: string;
  pickup_name: string;
  dropoff_name: string;
  departure_at: Date;
  arrival_at: Date;
  duration_minutes: number;
  price_vnd: number;
  remaining_seats: number;
}

interface TripDetailRow {
  id: string;
  route_id: string;
  route_code: string;
  operator_name: string;
  vehicle_type_name: string;
  vehicle_code: string;
  vehicle_plate: string;
  origin_name: string;
  destination_name: string;
  departure_at: Date;
  arrival_at: Date;
  duration_minutes: number;
  price_vnd: number;
  remaining_seats: number;
  status: 'SCHEDULED' | 'BOARDING';
  seat_layout_id: string;
  seat_layout_version: number;
  seat_layout_name: string;
  deck_count: number;
  layout: { seats?: SeatDefinitionRecord[] };
}

interface TripStopRow {
  id: string;
  location_id: string;
  name: string;
  stop_kind: TripStopKind;
  stop_order: number;
  offset_minutes: number;
  scheduled_at: Date;
}

interface TripActivationRow {
  trip_id: string;
  stored_is_active: boolean;
  changed: boolean;
}

interface TripStatusRow {
  id: string;
  status: TripLifecycleStatus;
}

interface TripLifecycleAuditRow {
  trip_id: string;
  from_status: TripLifecycleStatus;
  to_status: 'DEPARTED' | 'COMPLETED';
  occurred_at: Date;
}

interface AdminAuditRow {
  target_id: string;
  request_fingerprint: string;
  occurred_at: Date;
}

interface CreatedTripRow {
  trip_id: string;
  route_id: string;
  vehicle_id: string;
  seat_layout_version_id: string;
  departure_at: Date;
  arrival_at: Date;
  price_vnd: number;
  created_at: Date;
}

@Injectable()
export class TripRepository {
  constructor(@Inject(CatalogDatabase) private readonly database: CatalogDatabase) {}

  async getAdminCatalog(): Promise<AdminCatalogSnapshot> {
    const [locations, operators, vehicleTypes, layouts, vehicles, routes, stops, trips] =
      await Promise.all([
        this.database.query<{
          id: string;
          code: string;
          name: string;
          kind: 'CITY' | 'STATION';
          parent_location_id: string | null;
          is_active: boolean;
        }>(
          `SELECT id, code, name, kind, parent_location_id, is_active FROM catalog.locations ORDER BY name`,
        ),
        this.database.query<{ id: string; code: string; name: string; is_active: boolean }>(
          `SELECT id, code, name, is_active FROM catalog.operators ORDER BY name`,
        ),
        this.database.query<{ id: string; code: string; name: string; seat_capacity: number }>(
          `SELECT id, code, name, seat_capacity::int FROM catalog.vehicle_types ORDER BY name`,
        ),
        this.database.query<{
          id: string;
          vehicle_type_id: string;
          version: number;
          name: string;
          deck_count: number;
          layout_json: string;
          is_active: boolean;
        }>(
          `SELECT id, vehicle_type_id, version, name, deck_count::int,
                  layout::text AS layout_json, is_active
             FROM catalog.seat_layout_versions ORDER BY vehicle_type_id, version DESC`,
        ),
        this.database.query<{
          id: string;
          code: string;
          plate: string;
          operator_id: string;
          vehicle_type_id: string;
          seat_layout_version_id: string;
          is_active: boolean;
        }>(
          `SELECT id, code, plate, operator_id, vehicle_type_id, seat_layout_version_id, is_active
             FROM catalog.vehicles ORDER BY code`,
        ),
        this.database.query<{
          id: string;
          code: string;
          origin_location_id: string;
          destination_location_id: string;
          duration_minutes: number;
          is_active: boolean;
        }>(
          `SELECT id, code, origin_location_id, destination_location_id, duration_minutes, is_active
             FROM catalog.routes ORDER BY code`,
        ),
        this.database.query<{
          id: string;
          route_id: string;
          location_id: string;
          stop_order: number;
          stop_kind: TripStopKind;
          offset_minutes: number;
        }>(
          `SELECT id, route_id, location_id, stop_order::int, stop_kind, offset_minutes
             FROM catalog.route_stops ORDER BY route_id, stop_order`,
        ),
        this.database.query<{
          id: string;
          route_id: string;
          vehicle_id: string;
          departure_at: Date;
          arrival_at: Date;
          price_vnd: number;
          status: TripLifecycleStatus;
          is_active: boolean;
        }>(
          `SELECT trip.id, trip.route_id, trip.vehicle_id, trip.departure_at, trip.arrival_at,
                  fare.price_vnd, trip.status, trip.is_active
             FROM catalog.trips AS trip JOIN catalog.fares AS fare ON fare.trip_id = trip.id
            ORDER BY trip.departure_at DESC LIMIT 100`,
        ),
      ]);
    const stopsByRoute = new Map<string, AdminCatalogSnapshot['routes'][number]['stops']>();
    for (const stop of stops.rows) {
      const values = stopsByRoute.get(stop.route_id) ?? [];
      values.push({
        id: stop.id,
        locationId: stop.location_id,
        stopOrder: stop.stop_order,
        stopKind: stop.stop_kind,
        offsetMinutes: stop.offset_minutes,
      });
      stopsByRoute.set(stop.route_id, values);
    }
    return {
      locations: locations.rows.map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        kind: row.kind,
        ...(row.parent_location_id && { parentLocationId: row.parent_location_id }),
        isActive: row.is_active,
      })),
      operators: operators.rows.map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        isActive: row.is_active,
      })),
      vehicleTypes: vehicleTypes.rows.map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        seatCapacity: row.seat_capacity,
      })),
      seatLayouts: layouts.rows.map((row) => ({
        id: row.id,
        vehicleTypeId: row.vehicle_type_id,
        version: row.version,
        name: row.name,
        deckCount: row.deck_count,
        layoutJson: row.layout_json,
        isActive: row.is_active,
      })),
      vehicles: vehicles.rows.map((row) => ({
        id: row.id,
        code: row.code,
        plate: row.plate,
        operatorId: row.operator_id,
        vehicleTypeId: row.vehicle_type_id,
        seatLayoutVersionId: row.seat_layout_version_id,
        isActive: row.is_active,
      })),
      routes: routes.rows.map((row) => ({
        id: row.id,
        code: row.code,
        originLocationId: row.origin_location_id,
        destinationLocationId: row.destination_location_id,
        durationMinutes: row.duration_minutes,
        isActive: row.is_active,
        stops: stopsByRoute.get(row.id) ?? [],
      })),
      trips: trips.rows.map((row) => ({
        id: row.id,
        routeId: row.route_id,
        vehicleId: row.vehicle_id,
        departureAt: row.departure_at.toISOString(),
        arrivalAt: row.arrival_at.toISOString(),
        priceVnd: row.price_vnd,
        status: row.status,
        isActive: row.is_active,
      })),
    };
  }

  async saveCatalogResource(command: SaveCatalogCommand): Promise<SaveCatalogResourceRecord> {
    return this.database.transaction(async (transaction) => {
      await transaction.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `${command.actorId}:${command.idempotencyKey}`,
      ]);
      const prior = await transaction.query<AdminAuditRow>(
        `SELECT target_id, request_fingerprint, occurred_at FROM catalog.admin_audit
          WHERE actor_id = $1 AND idempotency_key = $2`,
        [command.actorId, command.idempotencyKey],
      );
      if (prior.rows[0]) {
        if (prior.rows[0].request_fingerprint !== command.requestFingerprint) {
          throw new TripAdminIdempotencyConflictError();
        }
        return {
          resourceType: command.resourceType,
          id: prior.rows[0].target_id,
          created: false,
          changed: false,
          isActive: await resourceActive(
            transaction,
            command.resourceType,
            prior.rows[0].target_id,
          ),
          updatedAt: prior.rows[0].occurred_at.toISOString(),
        };
      }
      const id = command.id ?? randomUUID();
      const created = !command.id;
      if (command.resourceType === 'LOCATION') await saveLocation(transaction, id, command.values);
      if (command.resourceType === 'ROUTE') await saveRoute(transaction, id, command.values);
      if (command.resourceType === 'VEHICLE') await saveVehicle(transaction, id, command.values);
      if (command.resourceType === 'SEAT_LAYOUT')
        await saveSeatLayout(transaction, id, command.values);
      if (command.resourceType === 'TRIP') await saveTrip(transaction, id, command.values);
      const occurredAt = new Date().toISOString();
      await transaction.query(
        `INSERT INTO catalog.admin_audit (
          id, action, target_type, target_id, actor_id, actor_role, idempotency_key,
          request_fingerprint, request_id, trace_id, occurred_at
        ) VALUES ($1,$2,$3,$4,$5,'ADMIN',$6,$7,$8,$9,$10)`,
        [
          randomUUID(),
          `${command.resourceType}_${created ? 'CREATED' : 'UPDATED'}`,
          command.resourceType,
          id,
          command.actorId,
          command.idempotencyKey,
          command.requestFingerprint,
          command.requestId,
          command.traceId,
          occurredAt,
        ],
      );
      return {
        resourceType: command.resourceType,
        id,
        created,
        changed: true,
        isActive: true,
        updatedAt: occurredAt,
      };
    });
  }

  async setCatalogResourceActive(
    command: SaveCatalogCommand & { isActive: boolean },
  ): Promise<SaveCatalogResourceRecord | null> {
    return this.database.transaction(async (transaction) => {
      await transaction.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `${command.actorId}:${command.idempotencyKey}`,
      ]);
      const prior = await transaction.query<AdminAuditRow>(
        `SELECT target_id, request_fingerprint, occurred_at FROM catalog.admin_audit WHERE actor_id=$1 AND idempotency_key=$2`,
        [command.actorId, command.idempotencyKey],
      );
      if (prior.rows[0]) {
        if (prior.rows[0].request_fingerprint !== command.requestFingerprint)
          throw new TripAdminIdempotencyConflictError();
        return {
          resourceType: command.resourceType,
          id: prior.rows[0].target_id,
          created: false,
          changed: false,
          isActive: command.isActive,
          updatedAt: prior.rows[0].occurred_at.toISOString(),
        };
      }
      const table = resourceTable(command.resourceType);
      const updated = await transaction.query<{ is_active: boolean }>(
        `UPDATE ${table} SET is_active=$2 WHERE id=$1 AND is_active IS DISTINCT FROM $2 RETURNING is_active`,
        [command.id, command.isActive],
      );
      if (
        !updated.rows[0] &&
        !(await resourceExists(transaction, command.resourceType, command.id!))
      )
        return null;
      const occurredAt = new Date().toISOString();
      await transaction.query(
        `INSERT INTO catalog.admin_audit (id,action,target_type,target_id,actor_id,actor_role,idempotency_key,request_fingerprint,request_id,trace_id,occurred_at)
         VALUES ($1,$2,$3,$4,$5,'ADMIN',$6,$7,$8,$9,$10)`,
        [
          randomUUID(),
          `${command.resourceType}_${command.isActive ? 'ACTIVATED' : 'DEACTIVATED'}`,
          command.resourceType,
          command.id,
          command.actorId,
          command.idempotencyKey,
          command.requestFingerprint,
          command.requestId,
          command.traceId,
          occurredAt,
        ],
      );
      return {
        resourceType: command.resourceType,
        id: command.id!,
        created: false,
        changed: Boolean(updated.rows[0]),
        isActive: command.isActive,
        updatedAt: occurredAt,
      };
    });
  }

  async setActive(tripId: string, isActive: boolean): Promise<TripActivationRecord | null> {
    const result = await this.database.query<TripActivationRow>(
      `
        WITH current_trip AS (
          SELECT id, is_active
          FROM catalog.trips
          WHERE id = $1
          FOR UPDATE
        ), updated_trip AS (
          UPDATE catalog.trips AS trip
          SET is_active = $2
          FROM current_trip
          WHERE trip.id = current_trip.id
            AND current_trip.is_active IS DISTINCT FROM $2
          RETURNING trip.id, trip.is_active
        )
        SELECT
          current_trip.id AS trip_id,
          COALESCE(updated_trip.is_active, current_trip.is_active) AS stored_is_active,
          updated_trip.id IS NOT NULL AS changed
        FROM current_trip
        LEFT JOIN updated_trip ON updated_trip.id = current_trip.id
      `,
      [tripId, isActive],
    );
    const row = result.rows[0];
    return row
      ? { tripId: row.trip_id, isActive: row.stored_is_active, changed: row.changed }
      : null;
  }

  async transitionStatus(
    command: TripLifecycleTransitionCommand,
  ): Promise<TripLifecycleTransitionRecord | null> {
    return this.database.transaction(async (transaction) => {
      await transaction.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `${command.actorId}:${command.idempotencyKey}`,
      ]);
      const prior = await transaction.query<TripLifecycleAuditRow>(
        `SELECT trip_id, from_status, to_status, occurred_at
           FROM catalog.trip_lifecycle_audit
          WHERE actor_id = $1 AND idempotency_key = $2`,
        [command.actorId, command.idempotencyKey],
      );
      const priorRow = prior.rows[0];
      if (priorRow) {
        if (priorRow.trip_id !== command.tripId || priorRow.to_status !== command.targetStatus) {
          throw new TripLifecycleIdempotencyConflictError();
        }
        return {
          tripId: priorRow.trip_id,
          previousStatus: priorRow.from_status,
          status: priorRow.to_status,
          changed: true,
          transitionedAt: priorRow.occurred_at.toISOString(),
        };
      }

      const current = await transaction.query<TripStatusRow>(
        'SELECT id, status FROM catalog.trips WHERE id = $1 FOR UPDATE',
        [command.tripId],
      );
      const trip = current.rows[0];
      if (!trip) return null;

      if (trip.status === command.targetStatus) {
        const audit = await transaction.query<{ occurred_at: Date }>(
          `INSERT INTO catalog.trip_lifecycle_audit (
             id, trip_id, from_status, to_status, actor_id, actor_role,
             idempotency_key, request_id, trace_id
           ) VALUES ($1, $2, $3, $3, $4, 'ADMIN', $5, $6, $7)
           RETURNING occurred_at`,
          [
            randomUUID(),
            trip.id,
            trip.status,
            command.actorId,
            command.idempotencyKey,
            command.requestId,
            command.traceId,
          ],
        );
        return {
          tripId: trip.id,
          previousStatus: trip.status,
          status: command.targetStatus,
          changed: false,
          transitionedAt: audit.rows[0]!.occurred_at.toISOString(),
        };
      }
      if (!isAllowedTransition(trip.status, command.targetStatus)) {
        throw new TripLifecycleTransitionError(trip.status, command.targetStatus);
      }

      const updated = await transaction.query<{ occurred_at: Date }>(
        `WITH updated AS (
           UPDATE catalog.trips SET status = $2 WHERE id = $1 RETURNING id
         )
         INSERT INTO catalog.trip_lifecycle_audit (
           id, trip_id, from_status, to_status, actor_id, actor_role,
           idempotency_key, request_id, trace_id
         )
         SELECT $3, updated.id, $4, $2, $5, 'ADMIN', $6, $7, $8 FROM updated
         RETURNING occurred_at`,
        [
          command.tripId,
          command.targetStatus,
          randomUUID(),
          trip.status,
          command.actorId,
          command.idempotencyKey,
          command.requestId,
          command.traceId,
        ],
      );
      return {
        tripId: trip.id,
        previousStatus: trip.status,
        status: command.targetStatus,
        changed: true,
        transitionedAt: updated.rows[0]!.occurred_at.toISOString(),
      };
    });
  }

  async listPreparationOptions(): Promise<TripPreparationOptionsRecord> {
    const [routes, vehicles] = await Promise.all([
      this.database.query<{
        id: string;
        code: string;
        origin_name: string;
        destination_name: string;
        duration_minutes: number;
      }>(`
        SELECT route.id, route.code, origin.name AS origin_name,
               destination.name AS destination_name, route.duration_minutes
          FROM catalog.routes AS route
          JOIN catalog.locations AS origin ON origin.id = route.origin_location_id
          JOIN catalog.locations AS destination ON destination.id = route.destination_location_id
         WHERE route.is_active AND origin.is_active AND destination.is_active
         ORDER BY route.code
      `),
      this.database.query<{
        id: string;
        code: string;
        plate: string;
        operator_name: string;
        vehicle_type_name: string;
        seat_layout_version_id: string;
        seat_layout_version: number;
        seat_layout_name: string;
      }>(`
        SELECT vehicle.id, vehicle.code, vehicle.plate, operator.name AS operator_name,
               vehicle_type.name AS vehicle_type_name,
               layout.id AS seat_layout_version_id, layout.version AS seat_layout_version,
               layout.name AS seat_layout_name
          FROM catalog.vehicles AS vehicle
          JOIN catalog.operators AS operator ON operator.id = vehicle.operator_id
          JOIN catalog.vehicle_types AS vehicle_type ON vehicle_type.id = vehicle.vehicle_type_id
          JOIN catalog.seat_layout_versions AS layout
            ON layout.id = vehicle.seat_layout_version_id
         WHERE vehicle.is_active AND operator.is_active AND layout.is_active
         ORDER BY operator.name, vehicle.code
      `),
    ]);
    return {
      routes: routes.rows.map((row) => ({
        id: row.id,
        code: row.code,
        originName: row.origin_name,
        destinationName: row.destination_name,
        durationMinutes: row.duration_minutes,
      })),
      vehicles: vehicles.rows.map((row) => ({
        id: row.id,
        code: row.code,
        plate: row.plate,
        operatorName: row.operator_name,
        vehicleTypeName: row.vehicle_type_name,
        seatLayoutVersionId: row.seat_layout_version_id,
        seatLayoutVersion: row.seat_layout_version,
        seatLayoutName: row.seat_layout_name,
      })),
    };
  }

  async createTrip(command: CreateTripCommand): Promise<CreatedTripRecord> {
    return this.database.transaction(async (transaction) => {
      await transaction.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `${command.actorId}:${command.idempotencyKey}`,
      ]);
      const prior = await transaction.query<AdminAuditRow>(
        `SELECT target_id, request_fingerprint, occurred_at
           FROM catalog.admin_audit
          WHERE actor_id = $1 AND idempotency_key = $2`,
        [command.actorId, command.idempotencyKey],
      );
      const priorRow = prior.rows[0];
      if (priorRow) {
        if (priorRow.request_fingerprint !== command.requestFingerprint) {
          throw new TripAdminIdempotencyConflictError();
        }
        const replay = await transaction.query<CreatedTripRow>(
          `SELECT trip.id AS trip_id, trip.route_id, trip.vehicle_id,
                  vehicle.seat_layout_version_id, trip.departure_at, trip.arrival_at,
                  fare.price_vnd, trip.created_at
             FROM catalog.trips AS trip
             JOIN catalog.vehicles AS vehicle ON vehicle.id = trip.vehicle_id
             JOIN catalog.fares AS fare ON fare.trip_id = trip.id
            WHERE trip.id = $1`,
          [priorRow.target_id],
        );
        const row = replay.rows[0];
        if (!row) throw new TripCreationConfigurationError('Created trip no longer exists.');
        return mapCreatedTrip(row, false);
      }

      const configuration = await transaction.query<{ valid: boolean }>(
        `SELECT true AS valid
           FROM catalog.routes AS route
           JOIN catalog.vehicles AS vehicle ON vehicle.id = $2
           JOIN catalog.operators AS operator ON operator.id = vehicle.operator_id
           JOIN catalog.seat_layout_versions AS layout ON layout.id = $3
          WHERE route.id = $1 AND route.is_active
            AND vehicle.is_active AND operator.is_active
            AND vehicle.seat_layout_version_id = layout.id AND layout.is_active`,
        [command.routeId, command.vehicleId, command.seatLayoutVersionId],
      );
      if (!configuration.rows[0]) {
        throw new TripCreationConfigurationError(
          'Route, vehicle, or seat-layout version is inactive, missing, or incompatible.',
        );
      }

      const tripId = randomUUID();
      const created = await transaction.query<CreatedTripRow>(
        `WITH inserted_trip AS (
           INSERT INTO catalog.trips (
             id, route_id, vehicle_id, departure_at, arrival_at, status, is_active
           ) VALUES ($1, $2, $3, $4, $5, 'SCHEDULED', true)
           RETURNING id, route_id, vehicle_id, departure_at, arrival_at, created_at
         ), inserted_fare AS (
           INSERT INTO catalog.fares (id, trip_id, price_vnd)
           SELECT $6, inserted_trip.id, $7 FROM inserted_trip
           RETURNING trip_id, price_vnd
         ), inserted_audit AS (
           INSERT INTO catalog.admin_audit (
             id, action, target_type, target_id, actor_id, actor_role,
             idempotency_key, request_fingerprint, request_id, trace_id
           ) VALUES ($8, 'TRIP_CREATED', 'TRIP', $1, $9, 'ADMIN', $10, $11, $12, $13)
         )
         SELECT trip.id AS trip_id, trip.route_id, trip.vehicle_id,
                $14::uuid AS seat_layout_version_id, trip.departure_at, trip.arrival_at,
                fare.price_vnd, trip.created_at
           FROM inserted_trip AS trip
           JOIN inserted_fare AS fare ON fare.trip_id = trip.id`,
        [
          tripId,
          command.routeId,
          command.vehicleId,
          command.departureAt,
          command.arrivalAt,
          randomUUID(),
          command.priceVnd,
          randomUUID(),
          command.actorId,
          command.idempotencyKey,
          command.requestFingerprint,
          command.requestId,
          command.traceId,
          command.seatLayoutVersionId,
        ],
      );
      return mapCreatedTrip(created.rows[0]!, true);
    });
  }

  async findById(tripId: string): Promise<TripDetailRecord | null> {
    const result = await this.database.query<TripDetailRow>(
      `
        SELECT
          trip.id,
          route.id AS route_id,
          route.code AS route_code,
          operator.name AS operator_name,
          vehicle_type.name AS vehicle_type_name,
          vehicle.code AS vehicle_code,
          vehicle.plate AS vehicle_plate,
          origin.name AS origin_name,
          destination.name AS destination_name,
          trip.departure_at,
          trip.arrival_at,
          (EXTRACT(EPOCH FROM (trip.arrival_at - trip.departure_at)) / 60)::integer AS duration_minutes,
          fare.price_vnd,
          vehicle_type.seat_capacity::integer AS remaining_seats,
          trip.status,
          seat_layout.id AS seat_layout_id,
          seat_layout.version AS seat_layout_version,
          seat_layout.name AS seat_layout_name,
          seat_layout.deck_count::integer,
          seat_layout.layout
        FROM catalog.trips AS trip
        JOIN catalog.routes AS route ON route.id = trip.route_id
        JOIN catalog.locations AS origin ON origin.id = route.origin_location_id
        JOIN catalog.locations AS destination ON destination.id = route.destination_location_id
        JOIN catalog.vehicles AS vehicle ON vehicle.id = trip.vehicle_id
        JOIN catalog.operators AS operator ON operator.id = vehicle.operator_id
        JOIN catalog.vehicle_types AS vehicle_type ON vehicle_type.id = vehicle.vehicle_type_id
        JOIN catalog.seat_layout_versions AS seat_layout
          ON seat_layout.id = vehicle.seat_layout_version_id
        JOIN catalog.fares AS fare ON fare.trip_id = trip.id
        WHERE trip.id = $1
          AND trip.is_active
          AND trip.status IN ('SCHEDULED', 'BOARDING')
          AND route.is_active
          AND vehicle.is_active
          AND operator.is_active
          AND seat_layout.is_active
      `,
      [tripId],
    );
    const row = result.rows[0];
    if (!row) return null;

    const stops = await this.database.query<TripStopRow>(
      `
        SELECT
          stop.id,
          location.id AS location_id,
          location.name,
          stop.stop_kind,
          stop.stop_order::integer,
          stop.offset_minutes,
          trip.departure_at + (stop.offset_minutes * interval '1 minute') AS scheduled_at
        FROM catalog.trips AS trip
        JOIN catalog.route_stops AS stop ON stop.route_id = trip.route_id
        JOIN catalog.locations AS location ON location.id = stop.location_id
        WHERE trip.id = $1
          AND location.is_active
        ORDER BY stop.stop_order
      `,
      [tripId],
    );

    return {
      id: row.id,
      routeId: row.route_id,
      routeCode: row.route_code,
      operatorName: row.operator_name,
      vehicleTypeName: row.vehicle_type_name,
      vehicleCode: row.vehicle_code,
      vehiclePlate: row.vehicle_plate,
      originName: row.origin_name,
      destinationName: row.destination_name,
      departureAt: row.departure_at.toISOString(),
      arrivalAt: row.arrival_at.toISOString(),
      durationMinutes: row.duration_minutes,
      priceVnd: row.price_vnd,
      remainingSeats: row.remaining_seats,
      status: row.status,
      stops: stops.rows.map((stop) => ({
        id: stop.id,
        locationId: stop.location_id,
        name: stop.name,
        kind: stop.stop_kind,
        stopOrder: stop.stop_order,
        offsetMinutes: stop.offset_minutes,
        scheduledAt: stop.scheduled_at.toISOString(),
      })),
      seatLayout: {
        id: row.seat_layout_id,
        version: row.seat_layout_version,
        name: row.seat_layout_name,
        deckCount: row.deck_count,
        seats: row.layout.seats ?? [],
      },
    };
  }

  async resolveEndpoints(
    originLocationId: string,
    destinationLocationId: string,
  ): Promise<TripSearchEndpoints | null> {
    const result = await this.database.query<EndpointRow>(
      `
        SELECT
          (SELECT COALESCE(parent_location_id, id)
             FROM catalog.locations
            WHERE id = $1 AND is_active) AS origin_city_id,
          (SELECT COALESCE(parent_location_id, id)
             FROM catalog.locations
            WHERE id = $2 AND is_active) AS destination_city_id
      `,
      [originLocationId, destinationLocationId],
    );
    const row = result.rows[0];
    if (!row?.origin_city_id || !row.destination_city_id) {
      return null;
    }
    return {
      originCityId: row.origin_city_id,
      destinationCityId: row.destination_city_id,
    };
  }

  async search(
    endpoints: TripSearchEndpoints,
    criteria: TripSearchCriteria,
  ): Promise<TripSummaryRecord[]> {
    const result = await this.database.query<TripRow>(
      `
        SELECT
          trip.id,
          route.id AS route_id,
          operator.name AS operator_name,
          vehicle_type.name AS vehicle_type_name,
          vehicle.code AS vehicle_code,
          origin.name AS origin_name,
          destination.name AS destination_name,
          pickup.name AS pickup_name,
          dropoff.name AS dropoff_name,
          trip.departure_at,
          trip.arrival_at,
          (EXTRACT(EPOCH FROM (trip.arrival_at - trip.departure_at)) / 60)::integer AS duration_minutes,
          fare.price_vnd,
          vehicle_type.seat_capacity::integer AS remaining_seats
        FROM catalog.trips AS trip
        JOIN catalog.routes AS route ON route.id = trip.route_id
        JOIN catalog.locations AS origin ON origin.id = route.origin_location_id
        JOIN catalog.locations AS destination ON destination.id = route.destination_location_id
        JOIN catalog.vehicles AS vehicle ON vehicle.id = trip.vehicle_id
        JOIN catalog.operators AS operator ON operator.id = vehicle.operator_id
        JOIN catalog.vehicle_types AS vehicle_type ON vehicle_type.id = vehicle.vehicle_type_id
        JOIN catalog.fares AS fare ON fare.trip_id = trip.id
        JOIN LATERAL (
          SELECT location.name
          FROM catalog.route_stops AS stop
          JOIN catalog.locations AS location ON location.id = stop.location_id
          WHERE stop.route_id = route.id AND stop.stop_kind IN ('PICKUP', 'BOTH')
          ORDER BY stop.stop_order
          LIMIT 1
        ) AS pickup ON true
        JOIN LATERAL (
          SELECT location.name
          FROM catalog.route_stops AS stop
          JOIN catalog.locations AS location ON location.id = stop.location_id
          WHERE stop.route_id = route.id AND stop.stop_kind IN ('DROPOFF', 'BOTH')
          ORDER BY stop.stop_order DESC
          LIMIT 1
        ) AS dropoff ON true
        WHERE route.origin_location_id = $1
          AND route.destination_location_id = $2
          AND route.is_active
          AND trip.is_active
          AND vehicle.is_active
          AND operator.is_active
          AND trip.status IN ('SCHEDULED', 'BOARDING')
          AND trip.departure_at >= ($3::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
          AND trip.departure_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
          AND ($4::time IS NULL OR (trip.departure_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::time >= $4::time)
          AND ($5::time IS NULL OR (trip.departure_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::time <= $5::time)
          AND ($6::integer IS NULL OR fare.price_vnd >= $6)
          AND ($7::integer IS NULL OR fare.price_vnd <= $7)
          AND ($8::text[] IS NULL OR operator.code = ANY($8))
          AND ($9::text[] IS NULL OR vehicle_type.code = ANY($9))
          AND ($10::integer IS NULL OR vehicle_type.seat_capacity >= $10)
        ORDER BY
          CASE WHEN $11 = 'PRICE_LOWEST' THEN fare.price_vnd END,
          CASE WHEN $11 = 'DURATION_SHORTEST' THEN trip.arrival_at - trip.departure_at END,
          trip.departure_at,
          trip.id
      `,
      searchParameters(endpoints, criteria),
    );

    return result.rows.map((row) => ({
      id: row.id,
      routeId: row.route_id,
      operatorName: row.operator_name,
      vehicleTypeName: row.vehicle_type_name,
      vehicleCode: row.vehicle_code,
      originName: row.origin_name,
      destinationName: row.destination_name,
      pickupName: row.pickup_name,
      dropoffName: row.dropoff_name,
      departureAt: row.departure_at.toISOString(),
      arrivalAt: row.arrival_at.toISOString(),
      durationMinutes: row.duration_minutes,
      priceVnd: row.price_vnd,
      remainingSeats: row.remaining_seats,
    }));
  }

  async findNearestDates(
    endpoints: TripSearchEndpoints,
    criteria: TripSearchCriteria,
  ): Promise<string[]> {
    const result = await this.database.query<{ travel_date: string }>(
      `
        SELECT candidate.travel_date::text
        FROM (
          SELECT DISTINCT (trip.departure_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS travel_date
          FROM catalog.trips AS trip
          JOIN catalog.routes AS route ON route.id = trip.route_id
          JOIN catalog.vehicles AS vehicle ON vehicle.id = trip.vehicle_id
          JOIN catalog.operators AS operator ON operator.id = vehicle.operator_id
          JOIN catalog.vehicle_types AS vehicle_type ON vehicle_type.id = vehicle.vehicle_type_id
          JOIN catalog.fares AS fare ON fare.trip_id = trip.id
          WHERE route.origin_location_id = $1
            AND route.destination_location_id = $2
            AND route.is_active
            AND trip.is_active
            AND vehicle.is_active
            AND operator.is_active
            AND trip.status IN ('SCHEDULED', 'BOARDING')
            AND (trip.departure_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date <> $3::date
            AND ($4::time IS NULL OR (trip.departure_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::time >= $4::time)
            AND ($5::time IS NULL OR (trip.departure_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::time <= $5::time)
            AND ($6::integer IS NULL OR fare.price_vnd >= $6)
            AND ($7::integer IS NULL OR fare.price_vnd <= $7)
            AND ($8::text[] IS NULL OR operator.code = ANY($8))
            AND ($9::text[] IS NULL OR vehicle_type.code = ANY($9))
            AND ($10::integer IS NULL OR vehicle_type.seat_capacity >= $10)
        ) AS candidate
        ORDER BY ABS(candidate.travel_date - $3::date), candidate.travel_date
        LIMIT 3
      `,
      searchParameters(endpoints, criteria).slice(0, 10),
    );
    return result.rows.map((row) => row.travel_date);
  }
}

export class TripLifecycleTransitionError extends Error {
  constructor(
    readonly currentStatus: string,
    readonly targetStatus: string,
  ) {
    super(`Trip cannot transition from ${currentStatus} to ${targetStatus}.`);
    this.name = 'TripLifecycleTransitionError';
  }
}

export class TripLifecycleIdempotencyConflictError extends Error {
  constructor() {
    super('Idempotency key was already used for another trip lifecycle command.');
    this.name = 'TripLifecycleIdempotencyConflictError';
  }
}

export class TripAdminIdempotencyConflictError extends Error {
  constructor() {
    super('Idempotency key was already used for another catalog admin command.');
    this.name = 'TripAdminIdempotencyConflictError';
  }
}

export class TripCreationConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TripCreationConfigurationError';
  }
}

function mapCreatedTrip(row: CreatedTripRow, created: boolean): CreatedTripRecord {
  return {
    tripId: row.trip_id,
    routeId: row.route_id,
    vehicleId: row.vehicle_id,
    seatLayoutVersionId: row.seat_layout_version_id,
    departureAt: row.departure_at.toISOString(),
    arrivalAt: row.arrival_at.toISOString(),
    priceVnd: row.price_vnd,
    status: 'SCHEDULED',
    created,
    createdAt: row.created_at.toISOString(),
  };
}

async function saveLocation(
  transaction: CatalogTransaction,
  id: string,
  values: Record<string, unknown>,
): Promise<void> {
  await transaction.query(
    `INSERT INTO catalog.locations (id, code, name, normalized_name, kind, parent_location_id, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,true)
     ON CONFLICT (id) DO UPDATE SET code=EXCLUDED.code, name=EXCLUDED.name,
       normalized_name=EXCLUDED.normalized_name, kind=EXCLUDED.kind,
       parent_location_id=EXCLUDED.parent_location_id`,
    [
      id,
      values.code,
      values.name,
      values.normalizedName,
      values.kind,
      values.parentLocationId ?? null,
    ],
  );
}

async function saveRoute(
  transaction: CatalogTransaction,
  id: string,
  values: Record<string, unknown>,
): Promise<void> {
  await transaction.query(
    `INSERT INTO catalog.routes (id,code,origin_location_id,destination_location_id,duration_minutes,is_active)
     VALUES ($1,$2,$3,$4,$5,true)
     ON CONFLICT (id) DO UPDATE SET code=EXCLUDED.code,
       origin_location_id=EXCLUDED.origin_location_id,
       destination_location_id=EXCLUDED.destination_location_id,
       duration_minutes=EXCLUDED.duration_minutes`,
    [
      id,
      values.code,
      values.originLocationId,
      values.destinationLocationId,
      values.durationMinutes,
    ],
  );
  await transaction.query(`DELETE FROM catalog.route_stops WHERE route_id=$1`, [id]);
  for (const stop of values.stops as Array<Record<string, unknown>>) {
    await transaction.query(
      `INSERT INTO catalog.route_stops (id,route_id,location_id,stop_order,stop_kind,offset_minutes)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        stop.id ?? randomUUID(),
        id,
        stop.locationId,
        stop.stopOrder,
        stop.stopKind,
        stop.offsetMinutes,
      ],
    );
  }
}

async function saveVehicle(
  transaction: CatalogTransaction,
  id: string,
  values: Record<string, unknown>,
): Promise<void> {
  const compatible = await transaction.query<{ valid: boolean }>(
    `SELECT true AS valid FROM catalog.seat_layout_versions
      WHERE id=$1 AND vehicle_type_id=$2 AND is_active`,
    [values.seatLayoutVersionId, values.vehicleTypeId],
  );
  if (!compatible.rows[0])
    throw new TripCreationConfigurationError('Seat layout is incompatible with the vehicle type.');
  await transaction.query(
    `INSERT INTO catalog.vehicles (id,code,plate,operator_id,vehicle_type_id,seat_layout_version_id,is_active)
     VALUES ($1,$2,$3,$4,$5,$6,true)
     ON CONFLICT (id) DO UPDATE SET code=EXCLUDED.code, plate=EXCLUDED.plate,
       operator_id=EXCLUDED.operator_id, vehicle_type_id=EXCLUDED.vehicle_type_id,
       seat_layout_version_id=EXCLUDED.seat_layout_version_id`,
    [
      id,
      values.code,
      values.plate,
      values.operatorId,
      values.vehicleTypeId,
      values.seatLayoutVersionId,
    ],
  );
}

async function saveSeatLayout(
  transaction: CatalogTransaction,
  id: string,
  values: Record<string, unknown>,
): Promise<void> {
  if (values.existingId) {
    throw new TripCreationConfigurationError(
      'Seat-layout versions are immutable; create a new version instead.',
    );
  }
  await transaction.query(
    `INSERT INTO catalog.seat_layout_versions
      (id,vehicle_type_id,version,name,deck_count,layout,is_active)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,true)`,
    [id, values.vehicleTypeId, values.version, values.name, values.deckCount, values.layoutJson],
  );
}

async function saveTrip(
  transaction: CatalogTransaction,
  id: string,
  values: Record<string, unknown>,
): Promise<void> {
  const compatible = await transaction.query<{ valid: boolean }>(
    `SELECT true AS valid FROM catalog.routes AS route
       JOIN catalog.vehicles AS vehicle ON vehicle.id=$2
       JOIN catalog.seat_layout_versions AS layout ON layout.id=$3
      WHERE route.id=$1 AND route.is_active AND vehicle.is_active
        AND vehicle.seat_layout_version_id=layout.id AND layout.is_active`,
    [values.routeId, values.vehicleId, values.seatLayoutVersionId],
  );
  if (!compatible.rows[0])
    throw new TripCreationConfigurationError(
      'Route, vehicle or layout is inactive or incompatible.',
    );
  const updated = await transaction.query(
    `UPDATE catalog.trips SET route_id=$2, vehicle_id=$3, departure_at=$4, arrival_at=$5
      WHERE id=$1 AND status IN ('DRAFT','SCHEDULED')`,
    [id, values.routeId, values.vehicleId, values.departureAt, values.arrivalAt],
  );
  if (updated.rowCount !== 1)
    throw new TripCreationConfigurationError('Only DRAFT or SCHEDULED trips can be updated.');
  await transaction.query(`UPDATE catalog.fares SET price_vnd=$2 WHERE trip_id=$1`, [
    id,
    values.priceVnd,
  ]);
}

function resourceTable(resourceType: CatalogResourceType): string {
  if (resourceType === 'LOCATION') return 'catalog.locations';
  if (resourceType === 'ROUTE') return 'catalog.routes';
  if (resourceType === 'VEHICLE') return 'catalog.vehicles';
  if (resourceType === 'SEAT_LAYOUT') return 'catalog.seat_layout_versions';
  return 'catalog.trips';
}

async function resourceExists(
  transaction: CatalogTransaction,
  resourceType: CatalogResourceType,
  id: string,
): Promise<boolean> {
  const result = await transaction.query<{ present: boolean }>(
    `SELECT true AS present FROM ${resourceTable(resourceType)} WHERE id=$1`,
    [id],
  );
  return Boolean(result.rows[0]);
}

async function resourceActive(
  transaction: CatalogTransaction,
  resourceType: CatalogResourceType,
  id: string,
): Promise<boolean> {
  const result = await transaction.query<{ is_active: boolean }>(
    `SELECT is_active FROM ${resourceTable(resourceType)} WHERE id=$1`,
    [id],
  );
  return result.rows[0]?.is_active ?? false;
}

function isAllowedTransition(
  currentStatus: TripLifecycleStatus,
  targetStatus: 'DEPARTED' | 'COMPLETED',
): boolean {
  return (
    (currentStatus === 'SCHEDULED' && targetStatus === 'DEPARTED') ||
    (currentStatus === 'DEPARTED' && targetStatus === 'COMPLETED')
  );
}

function searchParameters(endpoints: TripSearchEndpoints, criteria: TripSearchCriteria): unknown[] {
  return [
    endpoints.originCityId,
    endpoints.destinationCityId,
    criteria.travelDate,
    criteria.departureTimeFrom ?? null,
    criteria.departureTimeTo ?? null,
    criteria.minPriceVnd ?? null,
    criteria.maxPriceVnd ?? null,
    criteria.operatorCodes.length ? criteria.operatorCodes : null,
    criteria.vehicleTypeCodes.length ? criteria.vehicleTypeCodes : null,
    criteria.minimumRemainingSeats ?? null,
    criteria.sort,
  ];
}
