import { createHash } from 'node:crypto';

import { createClient } from 'redis';

const rateLimitScript = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
return { current, ttl }
`;

export type McpRateLimitBucket = 'public' | 'booking_lookup';

export interface McpRateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
}

export interface McpRateLimiter {
  readiness(): Promise<void>;
  consume(identifier: string, bucket: McpRateLimitBucket): Promise<McpRateLimitResult>;
}

export class McpRateLimitUnavailableError extends Error {
  constructor(options?: ErrorOptions) {
    super('MCP rate limiter is unavailable.', options);
    this.name = 'McpRateLimitUnavailableError';
  }
}

interface RateLimitRedisClient {
  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
  ping(): Promise<string>;
}

export class RedisMcpRateLimiter implements McpRateLimiter {
  private client: ReturnType<typeof createClient> | undefined;
  private connectPromise: Promise<unknown> | undefined;

  constructor(
    private readonly redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
    private readonly redisClient?: RateLimitRedisClient,
  ) {}

  async readiness(): Promise<void> {
    try {
      const response = await (this.redisClient ?? (await this.getClient())).ping();
      if (response !== 'PONG') throw new Error('Unexpected Redis health response.');
    } catch (error) {
      throw new McpRateLimitUnavailableError({ cause: error });
    }
  }

  async consume(identifier: string, bucket: McpRateLimitBucket): Promise<McpRateLimitResult> {
    const limit = bucket === 'booking_lookup' ? 5 : 30;
    const windowMs = 60_000;
    try {
      const redis = this.redisClient ?? (await this.getClient());
      const raw = await redis.eval(rateLimitScript, {
        keys: [mcpRateLimitKey(identifier, bucket)],
        arguments: [String(windowMs)],
      });
      if (!Array.isArray(raw) || raw.length !== 2) throw new Error('Invalid Redis result.');
      const count = Number(raw[0]);
      const ttlMs = Math.max(0, Number(raw[1]));
      if (!Number.isInteger(count) || !Number.isFinite(ttlMs)) throw new Error('Invalid values.');
      return {
        allowed: count <= limit,
        limit,
        remaining: Math.max(0, limit - count),
        retryAfterSeconds: Math.max(1, Math.ceil(ttlMs / 1_000)),
      };
    } catch (error) {
      throw new McpRateLimitUnavailableError({ cause: error });
    }
  }

  private async getClient() {
    if (!this.client) {
      this.client = createClient({
        url: this.redisUrl,
        socket: { connectTimeout: 1_000, reconnectStrategy: false },
      });
      this.client.on('error', () => undefined);
    }
    if (!this.client.isOpen) {
      this.connectPromise ??= this.client.connect().finally(() => {
        this.connectPromise = undefined;
      });
      await this.connectPromise;
    }
    return this.client;
  }
}

export function mcpRateLimitKey(identifier: string, bucket: McpRateLimitBucket): string {
  const digest = createHash('sha256').update(identifier).digest('hex');
  return `mcp:rate-limit:v1:${bucket}:${digest}`;
}
