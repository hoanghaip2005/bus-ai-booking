const checkoutSessionKey = 'bus:checkout-session:v1';

export function getCheckoutSessionId(): string {
  const existing = sessionStorage.getItem(checkoutSessionKey);
  if (existing) return existing;
  const created = crypto.randomUUID();
  sessionStorage.setItem(checkoutSessionKey, created);
  return created;
}
