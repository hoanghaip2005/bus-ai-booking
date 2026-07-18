import { describe, expect, it, vi } from 'vitest';

import { RequestContextMiddleware, type RequestWithContext } from './request-context.middleware';

describe('RequestContextMiddleware', () => {
  it('preserves a privacy-safe search session header for GraphQL context', () => {
    const request = {
      headers: {
        'x-request-id': 'req-search',
        'x-search-session-id': '00000000-0000-4000-8000-000000000901',
        'x-checkout-session-id': '00000000-0000-4000-8000-000000000902',
      },
      method: 'POST',
      originalUrl: '/graphql',
    } as unknown as RequestWithContext;
    const response = { setHeader: vi.fn(), once: vi.fn(), statusCode: 200 };
    const next = vi.fn();

    new RequestContextMiddleware().use(request, response as never, next);

    expect(request.searchSessionId).toBe('00000000-0000-4000-8000-000000000901');
    expect(response.setHeader).toHaveBeenCalledWith(
      'x-search-session-id',
      '00000000-0000-4000-8000-000000000901',
    );
    expect(request.checkoutSessionId).toBe('00000000-0000-4000-8000-000000000902');
    expect(response.setHeader).toHaveBeenCalledWith(
      'x-checkout-session-id',
      '00000000-0000-4000-8000-000000000902',
    );
    expect(response.setHeader).toHaveBeenCalledWith('x-gateway-instance', 'gateway-4000');
    expect(next).toHaveBeenCalledOnce();
  });

  it('replaces an invalid session value with an opaque UUID', () => {
    const request = {
      headers: { 'x-search-session-id': 'customer@example.com' },
      method: 'POST',
      originalUrl: '/graphql',
    } as unknown as RequestWithContext;

    new RequestContextMiddleware().use(
      request,
      { setHeader: vi.fn(), once: vi.fn(), statusCode: 200 } as never,
      vi.fn(),
    );

    expect(request.searchSessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
