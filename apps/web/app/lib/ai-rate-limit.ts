import { createHash } from 'node:crypto';

import { createClient } from 'redis';

const rateLimitScript = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
return { current, ttl }
`;

interface RateLimitRedisClient {
  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
}

export interface AiRateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export class AiRateLimitUnavailableError extends Error {
  constructor() {
    super('AI rate limiter is unavailable.');
    this.name = 'AiRateLimitUnavailableError';
  }
}

let client: ReturnType<typeof createClient> | undefined;
let connectPromise: Promise<unknown> | undefined;

export async function consumeAiRateLimit(
  identifier: string,
  options: {
    limit?: number;
    windowMs?: number;
    redisClient?: RateLimitRedisClient;
  } = {},
): Promise<AiRateLimitResult> {
  const limit = options.limit ?? 12;
  const windowMs = options.windowMs ?? 60_000;
  try {
    const redis = options.redisClient ?? (await getRedisClient());
    const raw = await redis.eval(rateLimitScript, {
      keys: [aiRateLimitKey(identifier)],
      arguments: [String(windowMs)],
    });
    if (!Array.isArray(raw) || raw.length !== 2) throw new Error('Invalid Redis result.');
    const count = Number(raw[0]);
    const ttlMs = Math.max(0, Number(raw[1]));
    if (!Number.isInteger(count) || !Number.isFinite(ttlMs)) {
      throw new Error('Invalid Redis rate-limit values.');
    }
    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      retryAfterSeconds: Math.max(1, Math.ceil(ttlMs / 1_000)),
    };
  } catch (error) {
    if (error instanceof AiRateLimitUnavailableError) throw error;
    throw new AiRateLimitUnavailableError();
  }
}

export function aiRateLimitKey(identifier: string): string {
  const digest = createHash('sha256').update(identifier).digest('hex');
  return `ai:rate-limit:v1:${digest}`;
}

async function getRedisClient() {
  if (!client) {
    client = createClient({
      url: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
      socket: { connectTimeout: 1_000, reconnectStrategy: false },
    });
    client.on('error', () => undefined);
  }
  if (!client.isOpen) {
    connectPromise ??= client.connect().finally(() => {
      connectPromise = undefined;
    });
    await connectPromise;
  }
  return client;
}
