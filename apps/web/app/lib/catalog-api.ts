import { cache } from 'react';

import type { TripSummary } from '../trips/trip-card';

interface GraphQlError {
  message: string;
  extensions?: { code?: string };
}

interface GraphQlResponse<T> {
  data?: T;
  errors?: GraphQlError[];
}

interface LocationSuggestion {
  id: string;
  code: string;
  name: string;
  kind: 'CITY' | 'STATION';
}

export interface RoutePageData {
  origin: LocationSuggestion;
  destination: LocationSuggestion;
  travelDate: string;
  trips: TripSummary[];
  nearestTravelDates: string[];
}

export interface TripDetail {
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
  status: string;
  timezone: string;
  stops: Array<{
    id: string;
    locationId: string;
    name: string;
    kind: 'PICKUP' | 'DROPOFF' | 'BOTH';
    stopOrder: number;
    offsetMinutes: number;
    scheduledAt: string;
  }>;
  seatLayout: {
    id: string;
    version: number;
    name: string;
    deckCount: number;
    seats: Array<{ id: string; label: string; deck: number; row: number; column: number }>;
  };
  policies: Array<{ code: string; title: string; summary: string; resourceUri: string }>;
}

export interface SeatMap {
  tripId: string;
  layoutId: string;
  layoutVersion: number;
  layoutName: string;
  deckCount: number;
  seats: Array<{
    id: string;
    label: string;
    deck: number;
    row: number;
    column: number;
    status: 'AVAILABLE' | 'HELD' | 'BOOKED' | 'BLOCKED';
    heldByRequester: boolean;
  }>;
  generatedAt: string;
}

export class CatalogApiError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'CatalogApiError';
  }
}

export const getRoutePageData = cache(
  async (
    originCode: string,
    destinationCode: string,
    travelDate: string,
  ): Promise<RoutePageData> => {
    const locations = await executeGraphQl<{
      origin: LocationSuggestion[];
      destination: LocationSuggestion[];
    }>(
      `
        query RoutePageLocations($origin: String!, $destination: String!) {
          origin: locationSuggestions(query: $origin, limit: 5) { id code name kind }
          destination: locationSuggestions(query: $destination, limit: 5) { id code name kind }
        }
      `,
      { origin: originCode, destination: destinationCode },
    );
    const origin = findCityByCode(locations.origin, originCode);
    const destination = findCityByCode(locations.destination, destinationCode);
    if (!origin || !destination || origin.id === destination.id) {
      throw new CatalogApiError('Route was not found.', 'NOT_FOUND');
    }

    const search = await executeGraphQl<{
      searchTrips: { trips: TripSummary[]; nearestTravelDates: string[] };
    }>(
      `
        query RoutePageTrips($input: SearchTripsInput!) {
          searchTrips(input: $input) {
            nearestTravelDates
            trips {
              id operatorName vehicleTypeName vehicleCode originName destinationName
              pickupName dropoffName departureAt arrivalAt durationMinutes priceVnd remainingSeats
            }
          }
        }
      `,
      {
        input: {
          originLocationId: origin.id,
          destinationLocationId: destination.id,
          travelDate,
        },
      },
    );

    return {
      origin,
      destination,
      travelDate,
      trips: search.searchTrips.trips,
      nearestTravelDates: search.searchTrips.nearestTravelDates,
    };
  },
);

export const getTripDetail = cache(async (tripId: string): Promise<TripDetail> => {
  const data = await executeGraphQl<{ trip: TripDetail | null }>(
    `
      query TripDetail($id: ID!) {
        trip(id: $id) {
          id routeId routeCode operatorName vehicleTypeName vehicleCode vehiclePlate
          originName destinationName departureAt arrivalAt durationMinutes priceVnd
          remainingSeats status timezone
          stops { id locationId name kind stopOrder offsetMinutes scheduledAt }
          seatLayout {
            id version name deckCount
            seats { id label deck row column }
          }
          policies { code title summary resourceUri }
        }
      }
    `,
    { id: tripId },
  );
  if (!data.trip) throw new CatalogApiError('Trip was not found.', 'NOT_FOUND');
  return data.trip;
});

export const getSeatMap = cache(async (tripId: string): Promise<SeatMap> => {
  const data = await executeGraphQl<{ seatMap: SeatMap }>(
    `
      query SeatMap($tripId: ID!) {
        seatMap(tripId: $tripId) {
          tripId layoutId layoutVersion layoutName deckCount generatedAt
          seats { id label deck row column status heldByRequester }
        }
      }
    `,
    { tripId },
  );
  return data.seatMap;
});

async function executeGraphQl<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const gatewayBaseUrl = process.env.GRAPHQL_GATEWAY_URL ?? 'http://127.0.0.1:4000';
  const response = await fetch(`${gatewayBaseUrl}/graphql`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    cache: 'no-store',
  });
  const body = (await response.json()) as GraphQlResponse<T>;
  const error = body.errors?.[0];
  if (!response.ok || error || !body.data) {
    throw new CatalogApiError(error?.message ?? 'Catalog request failed.', error?.extensions?.code);
  }
  return body.data;
}

function findCityByCode(
  suggestions: LocationSuggestion[],
  expectedCode: string,
): LocationSuggestion | undefined {
  return suggestions.find(
    (location) => location.kind === 'CITY' && location.code === expectedCode.toUpperCase(),
  );
}
