import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import type {
  AuthenticatedActor,
  IdentityRole,
  PublicIdentityUser,
  RefreshCredential,
} from './identity.types';
import { identityRoles } from './identity.types';

interface AccessTokenClaims {
  iss: 'bus-identity';
  aud: 'bus-platform';
  sub: string;
  role: IdentityRole;
  jti: string;
  sid: string;
  iat: number;
  exp: number;
}

export class InvalidAccessTokenError extends Error {
  constructor() {
    super('Access token is invalid or expired.');
    this.name = 'InvalidAccessTokenError';
  }
}

@Injectable()
export class IdentityTokenService {
  private readonly secret = Buffer.from(
    process.env.IDENTITY_ACCESS_TOKEN_SECRET ?? 'local_identity_access_secret_change_me_2026',
    'utf8',
  );
  private readonly accessTtlSeconds = positiveInteger(
    process.env.IDENTITY_ACCESS_TOKEN_TTL_SECONDS,
    900,
  );
  private readonly refreshTtlSeconds = positiveInteger(
    process.env.IDENTITY_REFRESH_TOKEN_TTL_SECONDS,
    2_592_000,
  );

  constructor() {
    if (this.secret.length < 32) {
      throw new Error('IDENTITY_ACCESS_TOKEN_SECRET must contain at least 32 bytes.');
    }
  }

  createAccessToken(
    user: PublicIdentityUser,
    sessionId: string,
    now = new Date(),
  ): {
    token: string;
    expiresAt: string;
  } {
    const issuedAt = Math.floor(now.getTime() / 1000);
    const expiresAt = issuedAt + this.accessTtlSeconds;
    const header = encodeJson({ alg: 'HS256', typ: 'JWT' });
    const payload = encodeJson({
      iss: 'bus-identity',
      aud: 'bus-platform',
      sub: user.id,
      role: user.role,
      jti: randomUUID(),
      sid: sessionId,
      iat: issuedAt,
      exp: expiresAt,
    } satisfies AccessTokenClaims);
    const unsigned = `${header}.${payload}`;
    return {
      token: `${unsigned}.${this.sign(unsigned)}`,
      expiresAt: new Date(expiresAt * 1000).toISOString(),
    };
  }

  validateAccessToken(
    token: string,
    now = new Date(),
  ): Omit<AuthenticatedActor, 'email' | 'displayName'> & { sessionId: string } {
    const [headerPart, payloadPart, signaturePart, extra] = token.split('.');
    if (!headerPart || !payloadPart || !signaturePart || extra !== undefined) {
      throw new InvalidAccessTokenError();
    }
    const unsigned = `${headerPart}.${payloadPart}`;
    const expected = Buffer.from(this.sign(unsigned), 'utf8');
    const actual = Buffer.from(signaturePart, 'utf8');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new InvalidAccessTokenError();
    }
    const header = decodeJson(headerPart);
    const claims = decodeJson(payloadPart);
    if (
      header.alg !== 'HS256' ||
      header.typ !== 'JWT' ||
      claims.iss !== 'bus-identity' ||
      claims.aud !== 'bus-platform' ||
      !isUuid(claims.sub) ||
      typeof claims.jti !== 'string' ||
      !isUuid(claims.jti) ||
      !isUuid(claims.sid) ||
      !identityRoles.includes(claims.role as IdentityRole) ||
      typeof claims.iat !== 'number' ||
      typeof claims.exp !== 'number' ||
      claims.iat > Math.floor(now.getTime() / 1000) + 30 ||
      claims.exp <= Math.floor(now.getTime() / 1000)
    ) {
      throw new InvalidAccessTokenError();
    }
    return {
      id: claims.sub,
      role: claims.role as IdentityRole,
      tokenId: claims.jti,
      sessionId: claims.sid,
      expiresAt: new Date(claims.exp * 1000).toISOString(),
    };
  }

  createRefreshCredential(now = new Date(), familyId = randomUUID()): RefreshCredential {
    const id = randomUUID();
    const token = `rt_${id}.${randomBytes(32).toString('base64url')}`;
    return {
      id,
      familyId,
      token,
      tokenHash: hashRefreshToken(token),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.refreshTtlSeconds * 1000).toISOString(),
    };
  }

  parseRefreshToken(token: string): { id: string; tokenHash: string } | null {
    const match = /^rt_([0-9a-f-]{36})\.([A-Za-z0-9_-]{40,64})$/i.exec(token);
    if (!match?.[1] || !isUuid(match[1])) return null;
    return { id: match[1], tokenHash: hashRefreshToken(token) };
  }

  private sign(value: string): string {
    return createHmac('sha256', this.secret).update(value).digest('base64url');
  }
}

function encodeJson(value: object): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodeJson(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Invalid token data is mapped to one neutral authentication error.
  }
  throw new InvalidAccessTokenError();
}

function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error('Token TTL must be positive.');
  return parsed;
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}
