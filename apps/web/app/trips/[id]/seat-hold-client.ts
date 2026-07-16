import { createClient } from 'graphql-ws';

import type { SeatMap } from '../../lib/catalog-api';
import { authenticatedHeaders } from '../../lib/auth-session';

export interface SeatHold {
  token: string;
  tripId: string;
  seatIds: string[];
  expiresAt: string;
  remainingTtlSeconds: number;
  unitPriceVnd: number;
  totalPriceVnd: number;
  status: 'ACTIVE' | 'EXPIRED' | 'RELEASED';
}

export interface SeatStatusEvent {
  tripId: string;
  seatIds: string[];
  status: 'HELD' | 'AVAILABLE';
  expiresAt?: string | null;
  version: number;
  occurredAt: string;
}

export class SeatHoldClientError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'SeatHoldClientError';
  }
}

export async function fetchSeatMap(
  tripId: string,
  checkoutSessionId: string,
  holdToken?: string,
): Promise<SeatMap> {
  const data = await executeGraphQl<{ seatMap: SeatMap }>(
    `query SeatMap($tripId: ID!, $holdToken: String) {
      seatMap(tripId: $tripId, holdToken: $holdToken) {
        tripId layoutId layoutVersion layoutName deckCount generatedAt
        seats { id label deck row column status heldByRequester }
      }
    }`,
    { tripId, holdToken: holdToken ?? null },
    checkoutSessionId,
  );
  return data.seatMap;
}

export async function fetchSeatHold(
  holdToken: string,
  checkoutSessionId: string,
): Promise<SeatHold> {
  const data = await executeGraphQl<{ seatHold: SeatHold }>(
    `query SeatHold($holdToken: String!) {
      seatHold(holdToken: $holdToken) {
        token tripId seatIds expiresAt remainingTtlSeconds unitPriceVnd totalPriceVnd status
      }
    }`,
    { holdToken },
    checkoutSessionId,
  );
  return data.seatHold;
}

export async function createSeatHold(
  tripId: string,
  seatIds: string[],
  checkoutSessionId: string,
): Promise<SeatHold> {
  const data = await executeGraphQl<{ holdSeats: SeatHold }>(
    `mutation HoldSeats($input: HoldSeatsInput!) {
      holdSeats(input: $input) {
        token tripId seatIds expiresAt remainingTtlSeconds unitPriceVnd totalPriceVnd status
      }
    }`,
    {
      input: {
        tripId,
        seatIds,
        idempotencyKey: crypto.randomUUID(),
        ttlSeconds: 300,
      },
    },
    checkoutSessionId,
  );
  return data.holdSeats;
}

export async function releaseSeatHold(holdToken: string, checkoutSessionId: string): Promise<void> {
  await executeGraphQl(
    `mutation ReleaseSeatHold($input: ReleaseSeatHoldInput!) {
      releaseSeatHold(input: $input) { released }
    }`,
    { input: { holdToken, idempotencyKey: crypto.randomUUID() } },
    checkoutSessionId,
  );
}

export function subscribeToSeatStatus(
  tripId: string,
  callbacks: {
    onConnected: () => void;
    onEvent: (event: SeatStatusEvent) => void;
    onError: (error: unknown) => void;
  },
): () => void {
  const client = createClient({
    url: graphQlWebSocketUrl(),
    lazy: true,
    keepAlive: 15_000,
    retryAttempts: Number.POSITIVE_INFINITY,
    shouldRetry: () => true,
    on: {
      connected: callbacks.onConnected,
    },
  });
  const unsubscribe = client.subscribe<{ seatStatusChanged: SeatStatusEvent }>(
    {
      query: `subscription SeatStatusChanged($tripId: ID!) {
        seatStatusChanged(tripId: $tripId) {
          tripId seatIds status expiresAt version occurredAt
        }
      }`,
      variables: { tripId },
    },
    {
      next: (result) => {
        if (result.data?.seatStatusChanged) callbacks.onEvent(result.data.seatStatusChanged);
      },
      error: callbacks.onError,
      complete: () => undefined,
    },
  );

  return () => {
    unsubscribe();
    void client.dispose();
  };
}

async function executeGraphQl<T>(
  query: string,
  variables: Record<string, unknown>,
  checkoutSessionId: string,
): Promise<T> {
  const response = await fetch('/graphql', {
    method: 'POST',
    headers: authenticatedHeaders(checkoutSessionId),
    body: JSON.stringify({ query, variables }),
  });
  const body = (await response.json()) as {
    data?: T;
    errors?: Array<{ message: string; extensions?: { code?: string } }>;
  };
  const error = body.errors?.[0];
  if (!response.ok || error || !body.data) {
    throw new SeatHoldClientError(
      error?.message ?? 'Không thể cập nhật trạng thái ghế.',
      error?.extensions?.code,
    );
  }
  return body.data;
}

function graphQlWebSocketUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/graphql`;
}
