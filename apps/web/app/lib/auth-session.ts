export const authStorageKey = 'bus:auth-session:v1';
export const authSessionChangedEvent = 'bus:auth-session-changed';

export type StoredUserRole = 'CUSTOMER' | 'STAFF' | 'ADMIN';

export interface StoredAuthSession {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
  user: { id: string; email: string; displayName: string; role: StoredUserRole };
}

export function getStoredAuthSession(): StoredAuthSession | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const raw = sessionStorage.getItem(authStorageKey);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<StoredAuthSession>;
    return typeof parsed.accessToken === 'string' && parsed.user?.id
      ? (parsed as StoredAuthSession)
      : undefined;
  } catch {
    return undefined;
  }
}

export function storeAuthSession(session: StoredAuthSession): void {
  sessionStorage.setItem(authStorageKey, JSON.stringify(session));
  window.dispatchEvent(new Event(authSessionChangedEvent));
}

export function clearAuthSession(): void {
  sessionStorage.removeItem(authStorageKey);
  window.dispatchEvent(new Event(authSessionChangedEvent));
}

export async function ensureActiveAuthSession(
  allowedRoles?: StoredUserRole[],
): Promise<StoredAuthSession | undefined> {
  const session = getStoredAuthSession();
  if (!session || (allowedRoles && !allowedRoles.includes(session.user.role))) return undefined;
  const accessExpiry = Date.parse(session.accessExpiresAt);
  if (Number.isFinite(accessExpiry) && accessExpiry > Date.now() + 30_000) return session;
  const refreshed = await refreshStoredAuthSession(session);
  return refreshed && (!allowedRoles || allowedRoles.includes(refreshed.user.role))
    ? refreshed
    : undefined;
}

export async function refreshStoredAuthSession(
  session = getStoredAuthSession(),
): Promise<StoredAuthSession | undefined> {
  if (!session?.refreshToken) {
    clearAuthSession();
    return undefined;
  }
  const refreshExpiry = Date.parse(session.refreshExpiresAt);
  if (Number.isFinite(refreshExpiry) && refreshExpiry <= Date.now()) {
    clearAuthSession();
    return undefined;
  }

  try {
    const response = await fetch('/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: `mutation RefreshStoredSession($input: RefreshSessionInput!) {
          refreshSession(input: $input) {
            accessToken refreshToken accessExpiresAt refreshExpiresAt
            user { id email displayName role }
          }
        }`,
        variables: { input: { refreshToken: session.refreshToken } },
      }),
    });
    const body = (await response.json()) as {
      data?: { refreshSession?: StoredAuthSession };
      errors?: Array<{ extensions?: { code?: string } }>;
    };
    const refreshed = body.data?.refreshSession;
    if (!response.ok || body.errors?.length || !refreshed) {
      clearAuthSession();
      return undefined;
    }
    storeAuthSession(refreshed);
    return refreshed;
  } catch {
    return undefined;
  }
}

export function getStoredAccessToken(): string | undefined {
  return getStoredAuthSession()?.accessToken;
}

export function authenticatedHeaders(checkoutSessionId?: string): Record<string, string> {
  const accessToken = getStoredAccessToken();
  return {
    'content-type': 'application/json',
    ...(checkoutSessionId ? { 'x-checkout-session-id': checkoutSessionId } : {}),
    ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
  };
}
