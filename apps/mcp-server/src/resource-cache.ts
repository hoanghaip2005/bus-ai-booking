import { createClient } from 'redis';

export interface McpResourceCache {
  getOrLoad<T>(key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T>;
}

interface ResourceCacheRedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options: { EX: number }): Promise<unknown>;
}

export class RedisMcpResourceCache implements McpResourceCache {
  private client: ReturnType<typeof createClient> | undefined;
  private connectPromise: Promise<unknown> | undefined;

  constructor(
    private readonly redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
    private readonly redisClient?: ResourceCacheRedisClient,
  ) {}

  async getOrLoad<T>(key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T> {
    try {
      const redis = this.redisClient ?? (await this.getClient());
      const cached = await redis.get(key);
      if (cached !== null) return JSON.parse(cached) as T;
      const value = await loader();
      await redis.set(key, JSON.stringify(value), { EX: ttlSeconds });
      return value;
    } catch {
      // Public resources remain available when their optional cache is unavailable.
      return loader();
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

export const popularRoutesResourceCacheKey = 'mcp:resource:v1:popular-routes';
