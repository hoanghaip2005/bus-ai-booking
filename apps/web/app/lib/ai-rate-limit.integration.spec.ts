import { randomUUID } from 'node:crypto';

import { createClient } from 'redis';
import { afterAll, beforeAll, expect, test } from 'vitest';

import { aiRateLimitKey, consumeAiRateLimit } from './ai-rate-limit';

const redis = createClient({ url: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379' });
const identifier = `integration-${randomUUID()}`;

beforeAll(async () => redis.connect());
afterAll(async () => {
  await redis.del(aiRateLimitKey(identifier));
  await redis.quit();
});

test('AI rate limit is atomic and shared through real Redis', async () => {
  const first = await consumeAiRateLimit(identifier, {
    limit: 2,
    windowMs: 30_000,
    redisClient: redis,
  });
  const second = await consumeAiRateLimit(identifier, {
    limit: 2,
    windowMs: 30_000,
    redisClient: redis,
  });
  const rejected = await consumeAiRateLimit(identifier, {
    limit: 2,
    windowMs: 30_000,
    redisClient: redis,
  });

  expect(first).toMatchObject({ allowed: true, remaining: 1 });
  expect(second).toMatchObject({ allowed: true, remaining: 0 });
  expect(rejected).toMatchObject({ allowed: false, remaining: 0 });
  await expect(redis.pTTL(aiRateLimitKey(identifier))).resolves.toBeGreaterThan(0);
});
