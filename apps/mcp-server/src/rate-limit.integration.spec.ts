import { createClient } from 'redis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { mcpRateLimitKey, RedisMcpRateLimiter } from './rate-limit.js';
import { popularRoutesResourceCacheKey, RedisMcpResourceCache } from './resource-cache.js';

const redis = createClient({ url: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379' });
const identifier = '198.51.100.42';

describe('mcp distributed rate limit', () => {
  beforeAll(async () => {
    await redis.connect();
    await redis.del([
      mcpRateLimitKey(identifier, 'booking_lookup'),
      mcpRateLimitKey(identifier, 'public'),
      popularRoutesResourceCacheKey,
    ]);
  });

  afterAll(async () => {
    await redis.del([
      mcpRateLimitKey(identifier, 'booking_lookup'),
      mcpRateLimitKey(identifier, 'public'),
      popularRoutesResourceCacheKey,
    ]);
    await redis.quit();
  });

  it('allows five booking lookups and rejects the sixth atomically', async () => {
    const limiter = new RedisMcpRateLimiter(undefined, redis);
    const results = [];
    for (let index = 0; index < 6; index += 1) {
      results.push(await limiter.consume(identifier, 'booking_lookup'));
    }
    expect(results.map((result) => result.allowed)).toEqual([true, true, true, true, true, false]);
    expect(results[5]).toMatchObject({ limit: 5, remaining: 0 });
  });

  it('uses an independent public-tool bucket with a limit of thirty', async () => {
    const limiter = new RedisMcpRateLimiter(undefined, redis);
    const result = await limiter.consume(identifier, 'public');
    expect(result).toMatchObject({ allowed: true, limit: 30, remaining: 29 });
  });

  it('stores only a SHA-256 digest of the client identifier', () => {
    const key = mcpRateLimitKey(identifier, 'booking_lookup');
    expect(key).toMatch(/^mcp:rate-limit:v1:booking_lookup:[a-f0-9]{64}$/);
    expect(key).not.toContain(identifier);
  });

  it('caches the public popular-route resource without storing client data', async () => {
    const cache = new RedisMcpResourceCache(undefined, redis);
    let loads = 0;
    const loader = async () => ({ routes: [], generation: ++loads });

    await expect(cache.getOrLoad(popularRoutesResourceCacheKey, 60, loader)).resolves.toMatchObject(
      {
        generation: 1,
      },
    );
    await expect(cache.getOrLoad(popularRoutesResourceCacheKey, 60, loader)).resolves.toMatchObject(
      {
        generation: 1,
      },
    );
    expect(loads).toBe(1);
    expect(popularRoutesResourceCacheKey).toBe('mcp:resource:v1:popular-routes');
  });
});
