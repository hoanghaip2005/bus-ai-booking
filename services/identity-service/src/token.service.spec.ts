import { describe, expect, it } from 'vitest';

import { IdentityTokenService, InvalidAccessTokenError } from './token.service';

const user = {
  id: '00000000-0000-4000-8000-000000001403',
  email: 'admin.demo@benviet.vn',
  displayName: 'Quản trị Demo',
  role: 'ADMIN' as const,
};
const sessionId = '00000000-0000-4000-8000-000000001499';

describe('IdentityTokenService', () => {
  it('signs and validates access tokens with minimal actor claims', () => {
    const service = new IdentityTokenService();
    const now = new Date('2030-06-20T00:00:00.000Z');
    const created = service.createAccessToken(user, sessionId, now);

    expect(service.validateAccessToken(created.token, now)).toMatchObject({
      id: user.id,
      role: 'ADMIN',
      sessionId,
    });
  });

  it('rejects tampered and expired access tokens', () => {
    const service = new IdentityTokenService();
    const now = new Date('2030-06-20T00:00:00.000Z');
    const created = service.createAccessToken(user, sessionId, now);
    const tampered = `${created.token.slice(0, -1)}${created.token.endsWith('a') ? 'b' : 'a'}`;

    expect(() => service.validateAccessToken(tampered, now)).toThrow(InvalidAccessTokenError);
    expect(() => service.validateAccessToken(created.token, new Date(created.expiresAt))).toThrow(
      InvalidAccessTokenError,
    );
  });

  it('stores only a digest-compatible representation of opaque refresh tokens', () => {
    const service = new IdentityTokenService();
    const credential = service.createRefreshCredential(new Date('2030-06-20T00:00:00.000Z'));
    const parsed = service.parseRefreshToken(credential.token);

    expect(parsed).toEqual({ id: credential.id, tokenHash: credential.tokenHash });
    expect(credential.tokenHash).not.toContain(credential.token);
    expect(service.parseRefreshToken(`${credential.token}tampered`)?.tokenHash).not.toBe(
      credential.tokenHash,
    );
  });
});
