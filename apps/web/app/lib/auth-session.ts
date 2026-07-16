export const authStorageKey = 'bus:auth-session:v1';

export interface StoredAuthSession {
  accessToken: string;
  user: { id: string; email: string; displayName: string; role: 'CUSTOMER' | 'STAFF' | 'ADMIN' };
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
