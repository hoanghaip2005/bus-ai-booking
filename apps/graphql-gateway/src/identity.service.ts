import { activePropagationHeaders, createRequestId } from '@bus/observability';
import { Metadata, status } from '@grpc/grpc-js';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom, type Observable, timeout } from 'rxjs';

export type GatewayRole = 'CUSTOMER' | 'STAFF' | 'ADMIN';

export interface GatewayAuthUser {
  id: string;
  email: string;
  displayName: string;
  role: GatewayRole;
}

export interface GatewayAuthSession {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
  user: GatewayAuthUser;
}

export interface GatewayActor extends GatewayAuthUser {
  tokenId: string;
  expiresAt: string;
}

export interface GatewayPassengerProfile {
  id: string;
  label: string;
  fullName: string;
  phone?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GatewayPassengerProfileInput {
  label: string;
  fullName: string;
  phone?: string | null;
}

interface IdentityClient {
  health(
    input: { requestId: string },
    metadata?: Metadata,
  ): Observable<{ service: string; status: string; requestId: string }>;
  login(
    input: { email: string; password: string; requestId: string },
    metadata?: Metadata,
  ): Observable<{ session?: GrpcAuthSession; requestId: string }>;
  refresh(
    input: { refreshToken: string; requestId: string },
    metadata?: Metadata,
  ): Observable<{ session?: GrpcAuthSession; requestId: string }>;
  logout(
    input: { refreshToken: string; requestId: string },
    metadata?: Metadata,
  ): Observable<{ revoked: boolean; requestId: string }>;
  validateAccessToken(
    input: { accessToken: string; requestId: string },
    metadata?: Metadata,
  ): Observable<{ actor?: GrpcActor; requestId: string }>;
  listPassengerProfiles(
    input: { requestId: string },
    metadata?: Metadata,
  ): Observable<{ profiles?: GatewayPassengerProfile[]; requestId: string }>;
  createPassengerProfile(
    input: { input: GatewayPassengerProfileInput; requestId: string },
    metadata?: Metadata,
  ): Observable<{ profile?: GatewayPassengerProfile; requestId: string }>;
  updatePassengerProfile(
    input: { profileId: string; input: GatewayPassengerProfileInput; requestId: string },
    metadata?: Metadata,
  ): Observable<{ profile?: GatewayPassengerProfile; requestId: string }>;
  deletePassengerProfile(
    input: { profileId: string; requestId: string },
    metadata?: Metadata,
  ): Observable<{ profileId: string; deleted: boolean; requestId: string }>;
}

interface GrpcUser {
  id: string;
  email: string;
  displayName: string;
  role: number | string;
}

interface GrpcAuthSession {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
  user?: GrpcUser;
}

interface GrpcActor extends GrpcUser {
  tokenId: string;
  expiresAt: string;
}

export class IdentityDependencyError extends Error {
  constructor(
    readonly requestId: string,
    options?: ErrorOptions,
  ) {
    super('Identity Service is unavailable.', options);
    this.name = 'IdentityDependencyError';
  }
}

export class IdentityValidationGatewayError extends Error {
  constructor(
    readonly requestId: string,
    message: string,
  ) {
    super(message);
    this.name = 'IdentityValidationGatewayError';
  }
}

export class IdentityUnauthenticatedGatewayError extends Error {
  constructor(readonly requestId: string) {
    super('Authentication credentials are invalid or expired.');
    this.name = 'IdentityUnauthenticatedGatewayError';
  }
}

export class IdentityForbiddenGatewayError extends Error {
  constructor(readonly requestId: string) {
    super('Customer role is required.');
    this.name = 'IdentityForbiddenGatewayError';
  }
}

export class IdentityNotFoundGatewayError extends Error {
  constructor(readonly requestId: string) {
    super('Passenger profile was not found.');
    this.name = 'IdentityNotFoundGatewayError';
  }
}

@Injectable()
export class IdentityGatewayService implements OnModuleInit {
  private client?: IdentityClient;

  constructor(@Inject('IDENTITY_GRPC') private readonly grpcClient: ClientGrpc) {}

  onModuleInit(): void {
    this.client = this.grpcClient.getService<IdentityClient>('IdentityService');
  }

  check(inboundRequestId?: string): Promise<unknown> {
    return this.call(
      (client, requestId, metadata) => client.health({ requestId }, metadata),
      inboundRequestId,
    );
  }

  async login(
    email: string,
    password: string,
    inboundRequestId?: string,
  ): Promise<GatewayAuthSession> {
    const response = await this.call(
      (client, requestId, metadata) => client.login({ email, password, requestId }, metadata),
      inboundRequestId,
    );
    return mapSession(response.session, response.requestId);
  }

  async refresh(refreshToken: string, inboundRequestId?: string): Promise<GatewayAuthSession> {
    const response = await this.call(
      (client, requestId, metadata) => client.refresh({ refreshToken, requestId }, metadata),
      inboundRequestId,
    );
    return mapSession(response.session, response.requestId);
  }

  logout(refreshToken: string, inboundRequestId?: string): Promise<{ revoked: boolean }> {
    return this.call(
      (client, requestId, metadata) => client.logout({ refreshToken, requestId }, metadata),
      inboundRequestId,
    );
  }

  async authenticate(
    authorizationHeader: string | undefined,
    inboundRequestId?: string,
  ): Promise<GatewayActor> {
    const requestId = createRequestId(inboundRequestId);
    const accessToken = bearerToken(authorizationHeader);
    if (!accessToken) throw new IdentityUnauthenticatedGatewayError(requestId);
    const response = await this.call(
      (client, resolvedRequestId, metadata) =>
        client.validateAccessToken({ accessToken, requestId: resolvedRequestId }, metadata),
      requestId,
    );
    const actor = response.actor;
    if (!actor) throw new IdentityDependencyError(response.requestId);
    return { ...mapUser(actor), tokenId: actor.tokenId, expiresAt: actor.expiresAt };
  }

  async listPassengerProfiles(actor: GatewayActor, inboundRequestId?: string) {
    const response = await this.call(
      (client, requestId, metadata) => client.listPassengerProfiles({ requestId }, metadata),
      inboundRequestId,
      actor,
    );
    return response.profiles ?? [];
  }

  async createPassengerProfile(
    actor: GatewayActor,
    input: GatewayPassengerProfileInput,
    inboundRequestId?: string,
  ) {
    const response = await this.call(
      (client, requestId, metadata) =>
        client.createPassengerProfile({ input: cleanProfileInput(input), requestId }, metadata),
      inboundRequestId,
      actor,
    );
    if (!response.profile) throw new IdentityDependencyError(response.requestId);
    return response.profile;
  }

  async updatePassengerProfile(
    actor: GatewayActor,
    profileId: string,
    input: GatewayPassengerProfileInput,
    inboundRequestId?: string,
  ) {
    const response = await this.call(
      (client, requestId, metadata) =>
        client.updatePassengerProfile(
          { profileId, input: cleanProfileInput(input), requestId },
          metadata,
        ),
      inboundRequestId,
      actor,
    );
    if (!response.profile) throw new IdentityDependencyError(response.requestId);
    return response.profile;
  }

  deletePassengerProfile(actor: GatewayActor, profileId: string, inboundRequestId?: string) {
    return this.call(
      (client, requestId, metadata) =>
        client.deletePassengerProfile({ profileId, requestId }, metadata),
      inboundRequestId,
      actor,
    );
  }

  private async call<T>(
    operation: (client: IdentityClient, requestId: string, metadata: Metadata) => Observable<T>,
    inboundRequestId?: string,
    actor?: GatewayActor,
  ): Promise<T> {
    const requestId = createRequestId(inboundRequestId);
    if (!this.client) throw new IdentityDependencyError(requestId);
    const metadata = new Metadata();
    metadata.set('x-request-id', requestId);
    if (actor) {
      metadata.set('x-actor-id', actor.id);
      metadata.set('x-actor-role', actor.role);
      metadata.set('x-actor-token-id', actor.tokenId);
    }
    for (const [key, value] of Object.entries(activePropagationHeaders())) metadata.set(key, value);
    try {
      return await firstValueFrom(operation(this.client, requestId, metadata).pipe(timeout(3_000)));
    } catch (error) {
      if (grpcCode(error) === status.INVALID_ARGUMENT) {
        throw new IdentityValidationGatewayError(requestId, grpcDetails(error));
      }
      if (grpcCode(error) === status.UNAUTHENTICATED) {
        throw new IdentityUnauthenticatedGatewayError(requestId);
      }
      if (grpcCode(error) === status.PERMISSION_DENIED) {
        throw new IdentityForbiddenGatewayError(requestId);
      }
      if (grpcCode(error) === status.NOT_FOUND) {
        throw new IdentityNotFoundGatewayError(requestId);
      }
      throw new IdentityDependencyError(requestId, { cause: error });
    }
  }
}

function cleanProfileInput(input: GatewayPassengerProfileInput): GatewayPassengerProfileInput {
  return {
    label: input.label,
    fullName: input.fullName,
    ...(input.phone ? { phone: input.phone } : {}),
  };
}

function mapSession(session: GrpcAuthSession | undefined, requestId: string): GatewayAuthSession {
  if (!session?.user) throw new IdentityDependencyError(requestId);
  return {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    accessExpiresAt: session.accessExpiresAt,
    refreshExpiresAt: session.refreshExpiresAt,
    user: mapUser(session.user),
  };
}

function mapUser(user: GrpcUser): GatewayAuthUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: mapRole(user.role),
  };
}

function mapRole(role: number | string): GatewayRole {
  if (role === 1 || role === 'IDENTITY_ROLE_CUSTOMER' || role === 'CUSTOMER') return 'CUSTOMER';
  if (role === 2 || role === 'IDENTITY_ROLE_STAFF' || role === 'STAFF') return 'STAFF';
  if (role === 3 || role === 'IDENTITY_ROLE_ADMIN' || role === 'ADMIN') return 'ADMIN';
  throw new Error('Identity role is invalid.');
}

function bearerToken(header: string | undefined): string | null {
  const match = /^Bearer ([^\s]+)$/i.exec(header?.trim() ?? '');
  return match?.[1] ?? null;
}

function grpcCode(error: unknown): number | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? Number((error as { code?: unknown }).code)
    : undefined;
}

function grpcDetails(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'details' in error) {
    const details = (error as { details?: unknown }).details;
    if (typeof details === 'string' && details.length > 0) return details;
  }
  return 'Identity input is invalid.';
}
