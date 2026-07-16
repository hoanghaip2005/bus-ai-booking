export type UserRole = 'CUSTOMER' | 'STAFF' | 'ADMIN';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
  user: AuthUser;
}

export class AuthClientError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'AuthClientError';
  }
}

export function login(email: string, password: string): Promise<AuthSession> {
  return graphql<AuthSession>(
    `
      mutation Login($input: LoginInput!) {
        login(input: $input) {
          accessToken
          refreshToken
          accessExpiresAt
          refreshExpiresAt
          user {
            id
            email
            displayName
            role
          }
        }
      }
    `,
    { input: { email, password } },
    'login',
  );
}

export function refreshSession(refreshToken: string): Promise<AuthSession> {
  return graphql<AuthSession>(
    `
      mutation RefreshSession($input: RefreshSessionInput!) {
        refreshSession(input: $input) {
          accessToken
          refreshToken
          accessExpiresAt
          refreshExpiresAt
          user {
            id
            email
            displayName
            role
          }
        }
      }
    `,
    { input: { refreshToken } },
    'refreshSession',
  );
}

export function logout(refreshToken: string): Promise<{ revoked: boolean }> {
  return graphql<{ revoked: boolean }>(
    `
      mutation Logout($input: LogoutInput!) {
        logout(input: $input) {
          revoked
        }
      }
    `,
    { input: { refreshToken } },
    'logout',
  );
}

export function viewer(accessToken: string): Promise<AuthUser> {
  return graphql<AuthUser>(
    `
      query Viewer {
        viewer {
          id
          email
          displayName
          role
        }
      }
    `,
    {},
    'viewer',
    accessToken,
  );
}

export function setTripActive(
  accessToken: string,
  tripId: string,
  isActive: boolean,
): Promise<{ tripId: string; isActive: boolean; changed: boolean }> {
  return graphql(
    `
      mutation SetTripActive($input: SetTripActiveInput!) {
        setTripActive(input: $input) {
          tripId
          isActive
          changed
        }
      }
    `,
    { input: { tripId, isActive } },
    'setTripActive',
    accessToken,
  );
}

export function transitionTripStatus(
  accessToken: string,
  tripId: string,
  targetStatus: 'DEPARTED' | 'COMPLETED',
): Promise<{
  tripId: string;
  previousStatus: string;
  status: 'DEPARTED' | 'COMPLETED';
  changed: boolean;
  transitionedAt: string;
}> {
  return graphql(
    `
      mutation TransitionTripStatus($input: TransitionTripStatusInput!) {
        transitionTripStatus(input: $input) {
          tripId
          previousStatus
          status
          changed
          transitionedAt
        }
      }
    `,
    {
      input: {
        tripId,
        targetStatus,
        idempotencyKey: `trip-lifecycle-${crypto.randomUUID()}`,
      },
    },
    'transitionTripStatus',
    accessToken,
  );
}

async function graphql<T>(
  query: string,
  variables: Record<string, unknown>,
  field: string,
  accessToken?: string,
): Promise<T> {
  const response = await fetch('/graphql', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = (await response.json()) as {
    data?: Record<string, T>;
    errors?: Array<{ message: string; extensions?: { code?: string } }>;
  };
  const error = body.errors?.[0];
  const data = body.data?.[field];
  if (!response.ok || error || data === undefined) {
    throw new AuthClientError(
      error?.message ?? 'Không thể xác thực lúc này.',
      error?.extensions?.code,
    );
  }
  return data;
}
