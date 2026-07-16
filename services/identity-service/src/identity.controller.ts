import {
  currentTraceContext,
  createRequestId,
  logEvent,
  withRequestContext,
} from '@bus/observability';
import type { Metadata } from '@grpc/grpc-js';
import { status } from '@grpc/grpc-js';
import { Controller, Get, Inject, Req, ServiceUnavailableException } from '@nestjs/common';
import { GrpcMethod, RpcException } from '@nestjs/microservices';

import {
  type HealthResponse,
  IdentityNotFoundError,
  IdentityService,
  IdentityUnauthenticatedError,
  IdentityValidationError,
} from './identity.service';
import type {
  AuthSessionView,
  AuthenticatedActor,
  IdentityRole as DomainRole,
} from './identity.types';
import type { RequestWithContext } from './request-context.middleware';

type HealthRequest = { requestId?: string };
type LoginRequest = { email?: string; password?: string; requestId?: string };
type RefreshRequest = { refreshToken?: string; requestId?: string };
type LogoutRequest = { refreshToken?: string; requestId?: string };
type ValidateAccessTokenRequest = { accessToken?: string; requestId?: string };
type GrpcIdentityUser = {
  id: string;
  email: string;
  displayName: string;
  role: 1 | 2 | 3;
};
type GrpcAuthSession = {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
  user: GrpcIdentityUser;
};
type LoginResponse = { session: GrpcAuthSession; requestId: string };
type RefreshResponse = LoginResponse;
type LogoutResponse = { revoked: boolean; requestId: string };
type GrpcAuthenticatedActor = GrpcIdentityUser & {
  tokenId: string;
  expiresAt: string;
};
type ValidateAccessTokenResponse = { actor: GrpcAuthenticatedActor; requestId: string };
type PassengerProfileInput = { label?: string; fullName?: string; phone?: string };
type CreatePassengerProfileRequest = { input?: PassengerProfileInput; requestId?: string };
type UpdatePassengerProfileRequest = CreatePassengerProfileRequest & { profileId?: string };
type DeletePassengerProfileRequest = { profileId?: string; requestId?: string };

@Controller()
export class IdentityController {
  constructor(@Inject(IdentityService) private readonly identityService: IdentityService) {}

  @Get('health')
  httpHealth(@Req() request: RequestWithContext): HealthResponse {
    return this.identityService.health(
      request.requestId,
      currentTraceContext().traceId ?? 'unavailable',
    );
  }

  @Get('health/live')
  httpLiveness(@Req() request: RequestWithContext): HealthResponse {
    return this.httpHealth(request);
  }

  @Get('health/ready')
  async httpReadiness(@Req() request: RequestWithContext): Promise<HealthResponse> {
    try {
      return await this.identityService.readiness(
        request.requestId,
        currentTraceContext().traceId ?? 'unavailable',
      );
    } catch {
      throw new ServiceUnavailableException({
        code: 'DEPENDENCY_UNAVAILABLE',
        message: 'Identity PostgreSQL is unavailable.',
      });
    }
  }

  @GrpcMethod('IdentityService', 'Health')
  async grpcHealth(request: HealthRequest, metadata: Metadata): Promise<HealthResponse> {
    const requestId = grpcRequestId(request.requestId, metadata);
    return withRequestContext(requestId, () =>
      this.identityService.readiness(requestId, currentTraceContext().traceId ?? 'unavailable'),
    );
  }

  @GrpcMethod('IdentityService', 'Login')
  async grpcLogin(request: LoginRequest, metadata: Metadata): Promise<LoginResponse> {
    const requestId = grpcRequestId(request.requestId, metadata);
    return withRequestContext(requestId, async () => {
      const startedAt = performance.now();
      try {
        const response = await this.identityService.login({ ...request, requestId });
        logEvent({
          service: 'identity-service',
          event: 'grpc.identity.login',
          message: 'Identity login succeeded.',
          requestId,
          fields: {
            rpc: 'IdentityService.Login',
            actorId: response.session.user.id,
            actorRole: response.session.user.role,
            durationMs: Math.round(performance.now() - startedAt),
          },
        });
        return { session: mapSession(response.session), requestId: response.requestId };
      } catch (error) {
        logRejected('login', requestId, startedAt, error);
        throwIdentityError(error);
      }
    });
  }

  @GrpcMethod('IdentityService', 'Refresh')
  async grpcRefresh(request: RefreshRequest, metadata: Metadata): Promise<RefreshResponse> {
    const requestId = grpcRequestId(request.requestId, metadata);
    return withRequestContext(requestId, async () => {
      const startedAt = performance.now();
      try {
        const response = await this.identityService.refresh({ ...request, requestId });
        logEvent({
          service: 'identity-service',
          event: 'grpc.identity.refresh',
          message: 'Identity refresh session rotated.',
          requestId,
          fields: {
            rpc: 'IdentityService.Refresh',
            actorId: response.session.user.id,
            actorRole: response.session.user.role,
            durationMs: Math.round(performance.now() - startedAt),
          },
        });
        return { session: mapSession(response.session), requestId: response.requestId };
      } catch (error) {
        logRejected('refresh', requestId, startedAt, error);
        throwIdentityError(error);
      }
    });
  }

  @GrpcMethod('IdentityService', 'Logout')
  async grpcLogout(request: LogoutRequest, metadata: Metadata): Promise<LogoutResponse> {
    const requestId = grpcRequestId(request.requestId, metadata);
    return withRequestContext(requestId, async () => {
      try {
        return await this.identityService.logout({ ...request, requestId });
      } catch (error) {
        throwIdentityError(error);
      }
    });
  }

  @GrpcMethod('IdentityService', 'ValidateAccessToken')
  async grpcValidateAccessToken(
    request: ValidateAccessTokenRequest,
    metadata: Metadata,
  ): Promise<ValidateAccessTokenResponse> {
    const requestId = grpcRequestId(request.requestId, metadata);
    return withRequestContext(requestId, async () => {
      try {
        const response = await this.identityService.validateAccessToken({ ...request, requestId });
        return { actor: mapActor(response.actor), requestId: response.requestId };
      } catch (error) {
        throwIdentityError(error);
      }
    });
  }

  @GrpcMethod('IdentityService', 'ListPassengerProfiles')
  async grpcListPassengerProfiles(request: HealthRequest, metadata: Metadata) {
    const requestId = grpcRequestId(request.requestId, metadata);
    const userId = requireCustomerActor(metadata);
    return withRequestContext(requestId, async () => {
      try {
        const response = await this.identityService.listPassengerProfiles(userId, requestId);
        logProfileOperation('list', requestId, userId, { count: response.profiles.length });
        return response;
      } catch (error) {
        throwIdentityError(error);
      }
    });
  }

  @GrpcMethod('IdentityService', 'CreatePassengerProfile')
  async grpcCreatePassengerProfile(request: CreatePassengerProfileRequest, metadata: Metadata) {
    const requestId = grpcRequestId(request.requestId, metadata);
    const userId = requireCustomerActor(metadata);
    return withRequestContext(requestId, async () => {
      try {
        const response = await this.identityService.createPassengerProfile(
          userId,
          request.input,
          requestId,
        );
        logProfileOperation('create', requestId, userId, { profileId: response.profile.id });
        return response;
      } catch (error) {
        throwIdentityError(error);
      }
    });
  }

  @GrpcMethod('IdentityService', 'UpdatePassengerProfile')
  async grpcUpdatePassengerProfile(request: UpdatePassengerProfileRequest, metadata: Metadata) {
    const requestId = grpcRequestId(request.requestId, metadata);
    const userId = requireCustomerActor(metadata);
    return withRequestContext(requestId, async () => {
      try {
        const response = await this.identityService.updatePassengerProfile(
          userId,
          request.profileId,
          request.input,
          requestId,
        );
        logProfileOperation('update', requestId, userId, { profileId: response.profile.id });
        return response;
      } catch (error) {
        throwIdentityError(error);
      }
    });
  }

  @GrpcMethod('IdentityService', 'DeletePassengerProfile')
  async grpcDeletePassengerProfile(request: DeletePassengerProfileRequest, metadata: Metadata) {
    const requestId = grpcRequestId(request.requestId, metadata);
    const userId = requireCustomerActor(metadata);
    return withRequestContext(requestId, async () => {
      try {
        const response = await this.identityService.deletePassengerProfile(
          userId,
          request.profileId,
          requestId,
        );
        logProfileOperation('delete', requestId, userId, { profileId: response.profileId });
        return response;
      } catch (error) {
        throwIdentityError(error);
      }
    });
  }
}

function mapSession(session: AuthSessionView): GrpcAuthSession {
  return {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    accessExpiresAt: session.accessExpiresAt,
    refreshExpiresAt: session.refreshExpiresAt,
    user: {
      id: session.user.id,
      email: session.user.email,
      displayName: session.user.displayName,
      role: mapRole(session.user.role),
    },
  };
}

function mapActor(actor: AuthenticatedActor): GrpcAuthenticatedActor {
  return {
    id: actor.id,
    email: actor.email,
    displayName: actor.displayName,
    role: mapRole(actor.role),
    tokenId: actor.tokenId,
    expiresAt: actor.expiresAt,
  };
}

function mapRole(role: DomainRole): 1 | 2 | 3 {
  if (role === 'CUSTOMER') return 1;
  if (role === 'STAFF') return 2;
  return 3;
}

function grpcRequestId(requestId: string | undefined, metadata: Metadata): string {
  const metadataRequestId = metadata.get('x-request-id')[0];
  return createRequestId(typeof metadataRequestId === 'string' ? metadataRequestId : requestId);
}

function throwIdentityError(error: unknown): never {
  if (error instanceof IdentityValidationError) {
    throw new RpcException({ code: status.INVALID_ARGUMENT, message: error.message });
  }
  if (error instanceof IdentityUnauthenticatedError) {
    throw new RpcException({ code: status.UNAUTHENTICATED, message: error.message });
  }
  if (error instanceof IdentityNotFoundError) {
    throw new RpcException({ code: status.NOT_FOUND, message: error.message });
  }
  throw new RpcException({ code: status.UNAVAILABLE, message: 'Identity Service unavailable.' });
}

function requireCustomerActor(metadata: Metadata): string {
  const actorId = metadata.get('x-actor-id')[0];
  const role = metadata.get('x-actor-role')[0];
  const tokenId = metadata.get('x-actor-token-id')[0];
  if (
    role !== 'CUSTOMER' ||
    typeof actorId !== 'string' ||
    !isUuid(actorId) ||
    typeof tokenId !== 'string' ||
    !isUuid(tokenId)
  ) {
    throw new RpcException({ code: status.PERMISSION_DENIED, message: 'Customer actor required.' });
  }
  return actorId;
}

function logProfileOperation(
  operation: 'list' | 'create' | 'update' | 'delete',
  requestId: string,
  actorId: string,
  fields: Record<string, unknown>,
): void {
  logEvent({
    service: 'identity-service',
    event: `grpc.identity.passenger-profile.${operation}`,
    message: 'Passenger profile operation completed.',
    requestId,
    fields: { actorId, ...fields },
  });
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function logRejected(
  operation: 'login' | 'refresh',
  requestId: string,
  startedAt: number,
  error: unknown,
): void {
  logEvent({
    service: 'identity-service',
    level: error instanceof IdentityUnauthenticatedError ? 'warn' : 'error',
    event: `grpc.identity.${operation}.rejected`,
    message: 'Identity operation was rejected.',
    requestId,
    fields: {
      rpc: `IdentityService.${operation === 'login' ? 'Login' : 'Refresh'}`,
      reason: error instanceof Error ? error.name : 'UnknownError',
      durationMs: Math.round(performance.now() - startedAt),
    },
  });
}
