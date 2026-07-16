import { activePropagationHeaders, createRequestId, logEvent } from '@bus/observability';
import {
  IdentityRole,
  IdentityServiceClient,
  type HealthResponse,
  type ValidateAccessTokenResponse,
} from '@bus/contracts-proto/generated/identity';
import { credentials, Metadata, status, type CallOptions, type ServiceError } from '@grpc/grpc-js';

export type McpActorRole = 'CUSTOMER' | 'STAFF' | 'ADMIN';

export interface McpActor {
  id: string;
  role: McpActorRole;
  tokenId: string;
  expiresAt: string;
}

export class McpIdentityError extends Error {
  constructor(
    readonly code: 'AUTHENTICATION_REQUIRED' | 'UNAUTHENTICATED' | 'DEPENDENCY_UNAVAILABLE',
    options?: ErrorOptions,
  ) {
    super('Identity request could not be completed.', options);
    this.name = 'McpIdentityError';
  }
}

export interface IdentityClient {
  readiness(requestId?: string): Promise<void>;
  authenticate(authorizationHeader: string | undefined, requestId?: string): Promise<McpActor>;
}

export class GrpcIdentityClient implements IdentityClient {
  private readonly client: InstanceType<typeof IdentityServiceClient>;

  constructor(
    address = process.env.IDENTITY_GRPC_URL ?? '127.0.0.1:50056',
    private readonly timeoutMs = 2_000,
  ) {
    this.client = new IdentityServiceClient(address, credentials.createInsecure());
  }

  async readiness(requestId?: string): Promise<void> {
    const correlationId = createRequestId(requestId);
    try {
      const response = await this.call<HealthResponse>(
        (metadata, options, callback) =>
          this.client.health({ requestId: correlationId }, metadata, options, callback),
        correlationId,
      );
      if (response.status !== 'UP') throw new McpIdentityError('DEPENDENCY_UNAVAILABLE');
    } catch (error) {
      this.normalizeError(error, correlationId, 'health');
    }
  }

  async authenticate(
    authorizationHeader: string | undefined,
    requestId?: string,
  ): Promise<McpActor> {
    const correlationId = createRequestId(requestId);
    const token = bearerToken(authorizationHeader);
    if (!token) throw new McpIdentityError('AUTHENTICATION_REQUIRED');
    try {
      const response = await this.call<ValidateAccessTokenResponse>(
        (metadata, options, callback) =>
          this.client.validateAccessToken(
            { accessToken: token, requestId: correlationId },
            metadata,
            options,
            callback,
          ),
        correlationId,
      );
      const actor = response.actor;
      if (!actor) throw new McpIdentityError('DEPENDENCY_UNAVAILABLE');
      return {
        id: actor.id,
        role: identityRoleName(actor.role),
        tokenId: actor.tokenId,
        expiresAt: actor.expiresAt,
      };
    } catch (error) {
      this.normalizeError(error, correlationId, 'validateAccessToken');
    }
  }

  private call<T>(
    operation: (
      metadata: Metadata,
      options: Partial<CallOptions>,
      callback: (error: ServiceError | null, response: T) => void,
    ) => void,
    requestId: string,
  ): Promise<T> {
    const metadata = new Metadata();
    metadata.set('x-request-id', requestId);
    for (const [key, value] of Object.entries(activePropagationHeaders())) metadata.set(key, value);
    return new Promise((resolve, reject) => {
      operation(metadata, { deadline: new Date(Date.now() + this.timeoutMs) }, (error, response) =>
        error ? reject(error) : resolve(response),
      );
    });
  }

  private normalizeError(error: unknown, requestId: string, operation: string): never {
    if (error instanceof McpIdentityError) throw error;
    const grpcCode =
      typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
    const code =
      grpcCode === status.UNAUTHENTICATED || grpcCode === status.INVALID_ARGUMENT
        ? 'UNAUTHENTICATED'
        : 'DEPENDENCY_UNAVAILABLE';
    logEvent({
      service: 'mcp-server',
      level: code === 'UNAUTHENTICATED' ? 'info' : 'error',
      event: `identity.${operation}.failed`,
      message: 'MCP Identity request failed.',
      requestId,
      fields: { code },
    });
    throw new McpIdentityError(code, { cause: error });
  }
}

function bearerToken(header: string | undefined): string | undefined {
  const match = /^Bearer\s+([A-Za-z0-9._~-]+)$/i.exec(header?.trim() ?? '');
  return match?.[1];
}

function identityRoleName(role: IdentityRole): McpActorRole {
  if (role === IdentityRole.IDENTITY_ROLE_CUSTOMER) return 'CUSTOMER';
  if (role === IdentityRole.IDENTITY_ROLE_STAFF) return 'STAFF';
  if (role === IdentityRole.IDENTITY_ROLE_ADMIN) return 'ADMIN';
  throw new McpIdentityError('DEPENDENCY_UNAVAILABLE');
}
