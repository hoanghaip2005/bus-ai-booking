import {
  clearAuthSession,
  ensureActiveAuthSession,
  refreshStoredAuthSession,
  type StoredAuthSession,
  type StoredUserRole,
} from '../lib/auth-session';

export class AdminClientError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'AdminClientError';
  }
}

export function loadAuthorizedSession(
  allowedRoles: StoredUserRole[] = ['ADMIN'],
): Promise<StoredAuthSession | undefined> {
  return ensureActiveAuthSession(allowedRoles);
}

export async function authorizedGraphql<T>(
  query: string,
  variables: Record<string, unknown>,
  allowedRoles: StoredUserRole[] = ['ADMIN'],
): Promise<{ data: T; session: StoredAuthSession }> {
  const session = await ensureActiveAuthSession(allowedRoles);
  if (!session) throw new AdminClientError('Phiên đăng nhập đã hết hạn.', 'UNAUTHENTICATED');

  const first = await request<T>(query, variables, session.accessToken);
  if (first.error?.code !== 'UNAUTHENTICATED') {
    if (first.error) throw first.error;
    return { data: first.data!, session };
  }

  const refreshed = await refreshStoredAuthSession(session);
  if (!refreshed || !allowedRoles.includes(refreshed.user.role)) {
    clearAuthSession();
    throw new AdminClientError('Phiên đăng nhập đã hết hạn.', 'UNAUTHENTICATED');
  }
  const retried = await request<T>(query, variables, refreshed.accessToken);
  if (retried.error) throw retried.error;
  return { data: retried.data!, session: refreshed };
}

async function request<T>(
  query: string,
  variables: Record<string, unknown>,
  accessToken: string,
): Promise<{ data?: T; error?: AdminClientError }> {
  try {
    const response = await fetch('/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ query, variables }),
    });
    const body = (await response.json()) as {
      data?: T;
      errors?: Array<{ message: string; extensions?: { code?: string } }>;
    };
    const error = body.errors?.[0];
    if (!response.ok || error || body.data === undefined) {
      return {
        error: new AdminClientError(
          error?.message ?? 'Không thể hoàn tất thao tác quản trị.',
          error?.extensions?.code,
        ),
      };
    }
    return { data: body.data };
  } catch {
    return {
      error: new AdminClientError('Không thể kết nối hệ thống quản trị.', 'DEPENDENCY_UNAVAILABLE'),
    };
  }
}
