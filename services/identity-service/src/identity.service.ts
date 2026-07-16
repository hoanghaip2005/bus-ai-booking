import { randomUUID } from 'node:crypto';

import { incrementCounter } from '@bus/observability';
import { Inject, Injectable } from '@nestjs/common';

import { IdentityDatabase } from './identity.database';
import {
  IdentityRepository,
  PassengerProfileLabelConflictError,
  PassengerProfileLimitError,
} from './identity.repository';
import type {
  AuthSessionView,
  AuthenticatedActor,
  IdentityUser,
  PublicIdentityUser,
  PassengerProfileInput,
} from './identity.types';
import { dummyPasswordHash, verifyPassword } from './password';
import { IdentityTokenService, InvalidAccessTokenError } from './token.service';

export interface HealthResponse {
  service: string;
  status: string;
  version: string;
  requestId: string;
  traceId: string;
  checkedAt: string;
}

export class IdentityValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IdentityValidationError';
  }
}

export class IdentityUnauthenticatedError extends Error {
  constructor() {
    super('Authentication credentials are invalid or expired.');
    this.name = 'IdentityUnauthenticatedError';
  }
}

export class IdentityNotFoundError extends Error {
  constructor() {
    super('Passenger profile was not found.');
    this.name = 'IdentityNotFoundError';
  }
}

@Injectable()
export class IdentityService {
  constructor(
    @Inject(IdentityDatabase) private readonly database: IdentityDatabase,
    @Inject(IdentityRepository) private readonly repository: IdentityRepository,
    @Inject(IdentityTokenService) private readonly tokens: IdentityTokenService,
  ) {}

  health(requestId = 'missing-request-id', traceId = 'unavailable'): HealthResponse {
    return {
      service: 'identity-service',
      status: 'UP',
      version: '0.1.0',
      requestId,
      traceId,
      checkedAt: new Date().toISOString(),
    };
  }

  async readiness(requestId?: string, traceId?: string): Promise<HealthResponse> {
    await this.database.ping();
    return this.health(requestId, traceId);
  }

  async login(input: {
    email?: string;
    password?: string;
    requestId?: string;
  }): Promise<{ session: AuthSessionView; requestId: string }> {
    const email = normalizeEmail(input.email);
    const password = validatePasswordInput(input.password);
    const user = await this.repository.findActiveUserByEmail(email);
    const valid = await verifyPassword(password, user?.passwordHash ?? dummyPasswordHash);
    if (!user || !valid) {
      incrementCounter('bus.identity.login.rejected', { reason: 'INVALID_CREDENTIALS' });
      throw new IdentityUnauthenticatedError();
    }
    const session = await this.issueSession(user);
    incrementCounter('bus.identity.login.succeeded', { role: user.role });
    return { session, requestId: input.requestId ?? 'missing-request-id' };
  }

  async refresh(input: {
    refreshToken?: string;
    requestId?: string;
  }): Promise<{ session: AuthSessionView; requestId: string }> {
    const refreshToken = validateRefreshTokenInput(input.refreshToken);
    const parsed = this.tokens.parseRefreshToken(refreshToken);
    if (!parsed) throw new IdentityUnauthenticatedError();
    const now = new Date();
    const next = this.tokens.createRefreshCredential(now);
    const user = await this.repository.rotateRefreshSession({
      sessionId: parsed.id,
      tokenHash: parsed.tokenHash,
      now: now.toISOString(),
      nextCredential: next,
    });
    if (!user) {
      incrementCounter('bus.identity.refresh.rejected');
      throw new IdentityUnauthenticatedError();
    }
    const session = toAuthSession(
      user,
      this.tokens.createAccessToken(publicUser(user), next.id, now),
      next,
    );
    incrementCounter('bus.identity.refresh.succeeded', { role: user.role });
    return { session, requestId: input.requestId ?? 'missing-request-id' };
  }

  async logout(input: {
    refreshToken?: string;
    requestId?: string;
  }): Promise<{ revoked: boolean; requestId: string }> {
    const refreshToken = validateRefreshTokenInput(input.refreshToken);
    const parsed = this.tokens.parseRefreshToken(refreshToken);
    const revoked = parsed
      ? await this.repository.revokeRefreshSession(
          parsed.id,
          parsed.tokenHash,
          new Date().toISOString(),
        )
      : false;
    incrementCounter('bus.identity.logout', { revoked: String(revoked) });
    return { revoked, requestId: input.requestId ?? 'missing-request-id' };
  }

  async validateAccessToken(input: {
    accessToken?: string;
    requestId?: string;
  }): Promise<{ actor: AuthenticatedActor; requestId: string }> {
    const accessToken = input.accessToken?.trim() ?? '';
    if (accessToken.length < 32 || accessToken.length > 4096) {
      throw new IdentityUnauthenticatedError();
    }
    const now = new Date();
    let claims: ReturnType<IdentityTokenService['validateAccessToken']>;
    try {
      claims = this.tokens.validateAccessToken(accessToken, now);
    } catch (error) {
      if (error instanceof InvalidAccessTokenError) throw new IdentityUnauthenticatedError();
      throw error;
    }
    const user = await this.repository.findActiveUserById(claims.id);
    if (!user || user.role !== claims.role) throw new IdentityUnauthenticatedError();
    const sessionActive = await this.repository.isRefreshSessionActive(
      claims.sessionId,
      claims.id,
      now.toISOString(),
    );
    if (!sessionActive) throw new IdentityUnauthenticatedError();
    return {
      actor: {
        ...publicUser(user),
        tokenId: claims.tokenId,
        expiresAt: claims.expiresAt,
      },
      requestId: input.requestId ?? 'missing-request-id',
    };
  }

  async listPassengerProfiles(userId: string, requestId?: string) {
    await this.requireActiveCustomer(userId);
    const profiles = await this.repository.listPassengerProfiles(userId);
    return { profiles, requestId: requestId ?? 'missing-request-id' };
  }

  async createPassengerProfile(
    userId: string,
    input: Partial<PassengerProfileInput> | undefined,
    requestId?: string,
  ) {
    await this.requireActiveCustomer(userId);
    const profile = validatePassengerProfileInput(input);
    try {
      const created = await this.repository.createPassengerProfile({
        id: randomUUID(),
        userId,
        profile,
        occurredAt: new Date().toISOString(),
      });
      incrementCounter('bus.identity.passenger-profile.created');
      return { profile: created, requestId: requestId ?? 'missing-request-id' };
    } catch (error) {
      throw mapProfileWriteError(error);
    }
  }

  async updatePassengerProfile(
    userId: string,
    profileId: string | undefined,
    input: Partial<PassengerProfileInput> | undefined,
    requestId?: string,
  ) {
    await this.requireActiveCustomer(userId);
    if (!isUuid(profileId ?? '')) throw new IdentityValidationError('Profile ID is invalid.');
    const profile = validatePassengerProfileInput(input);
    try {
      const updated = await this.repository.updatePassengerProfile({
        id: profileId!,
        userId,
        profile,
        occurredAt: new Date().toISOString(),
      });
      if (!updated) throw new IdentityNotFoundError();
      incrementCounter('bus.identity.passenger-profile.updated');
      return { profile: updated, requestId: requestId ?? 'missing-request-id' };
    } catch (error) {
      if (error instanceof IdentityNotFoundError) throw error;
      throw mapProfileWriteError(error);
    }
  }

  async deletePassengerProfile(userId: string, profileId: string | undefined, requestId?: string) {
    await this.requireActiveCustomer(userId);
    if (!isUuid(profileId ?? '')) throw new IdentityValidationError('Profile ID is invalid.');
    const deleted = await this.repository.deletePassengerProfile(profileId!, userId);
    if (!deleted) throw new IdentityNotFoundError();
    incrementCounter('bus.identity.passenger-profile.deleted');
    return { profileId, deleted: true, requestId: requestId ?? 'missing-request-id' };
  }

  private async issueSession(user: IdentityUser): Promise<AuthSessionView> {
    const now = new Date();
    const refresh = this.tokens.createRefreshCredential(now);
    await this.repository.createRefreshSession(user.id, refresh);
    return toAuthSession(
      user,
      this.tokens.createAccessToken(publicUser(user), refresh.id, now),
      refresh,
    );
  }

  private async requireActiveCustomer(userId: string): Promise<void> {
    if (!isUuid(userId)) throw new IdentityUnauthenticatedError();
    const user = await this.repository.findActiveUserById(userId);
    if (!user || user.role !== 'CUSTOMER') throw new IdentityUnauthenticatedError();
  }
}

function toAuthSession(
  user: IdentityUser,
  access: { token: string; expiresAt: string },
  refresh: { token: string; expiresAt: string },
): AuthSessionView {
  return {
    accessToken: access.token,
    refreshToken: refresh.token,
    accessExpiresAt: access.expiresAt,
    refreshExpiresAt: refresh.expiresAt,
    user: publicUser(user),
  };
}

function publicUser(user: IdentityUser): PublicIdentityUser {
  return { id: user.id, email: user.email, displayName: user.displayName, role: user.role };
}

function normalizeEmail(value: string | undefined): string {
  const email = value?.trim().toLowerCase() ?? '';
  if (email.length < 3 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new IdentityValidationError('Email format is invalid.');
  }
  return email;
}

function validatePasswordInput(value: string | undefined): string {
  if (!value || value.length < 8 || value.length > 128) {
    throw new IdentityValidationError('Password must contain between 8 and 128 characters.');
  }
  return value;
}

function validateRefreshTokenInput(value: string | undefined): string {
  const token = value?.trim() ?? '';
  if (token.length < 64 || token.length > 512) {
    throw new IdentityValidationError('Refresh token format is invalid.');
  }
  return token;
}

function validatePassengerProfileInput(
  value: Partial<PassengerProfileInput> | undefined,
): PassengerProfileInput {
  const label = value?.label?.trim().replace(/\s+/g, ' ') ?? '';
  const fullName = value?.fullName?.trim().replace(/\s+/g, ' ') ?? '';
  const phoneCandidate = value?.phone?.trim() ?? '';
  const phone = phoneCandidate
    ? phoneCandidate.startsWith('+')
      ? `+${phoneCandidate.slice(1).replace(/[^0-9]/g, '')}`
      : phoneCandidate.replace(/[^0-9]/g, '')
    : undefined;
  if (label.length < 1 || label.length > 40) {
    throw new IdentityValidationError('Profile label must contain between 1 and 40 characters.');
  }
  if (fullName.length < 2 || fullName.length > 100) {
    throw new IdentityValidationError('Passenger name must contain between 2 and 100 characters.');
  }
  const phoneDigits = phone?.startsWith('+') ? phone.slice(1) : phone;
  if (phoneDigits && (phoneDigits.length < 8 || phoneDigits.length > 15)) {
    throw new IdentityValidationError('Passenger phone must contain between 8 and 15 digits.');
  }
  return { label, fullName, ...(phone && { phone }) };
}

function mapProfileWriteError(error: unknown): Error {
  if (error instanceof PassengerProfileLabelConflictError) {
    return new IdentityValidationError('Passenger profile label already exists.');
  }
  if (error instanceof PassengerProfileLimitError) {
    return new IdentityValidationError('A customer can save at most 20 passenger profiles.');
  }
  return error instanceof Error ? error : new Error('Passenger profile write failed.');
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
