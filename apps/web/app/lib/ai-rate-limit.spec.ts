import { describe, expect, it, vi } from 'vitest';

import { AiRateLimitUnavailableError, aiRateLimitKey, consumeAiRateLimit } from './ai-rate-limit';

describe('AI distributed rate limiter', () => {
  it('stores only a hash of the client identifier', () => {
    const key = aiRateLimitKey('203.0.113.25');
    expect(key).toMatch(/^ai:rate-limit:v1:[a-f0-9]{64}$/);
    expect(key).not.toContain('203.0.113.25');
  });

  it('maps the atomic Redis count and TTL to a stable decision', async () => {
    const evalCommand = vi.fn(async () => [13, 42_500]);
    await expect(
      consumeAiRateLimit('client-a', {
        redisClient: { eval: evalCommand },
        limit: 12,
      }),
    ).resolves.toEqual({ allowed: false, remaining: 0, retryAfterSeconds: 43 });
    expect(evalCommand).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('INCR'"),
      expect.objectContaining({ arguments: ['60000'] }),
    );
  });

  it('fails closed when Redis is unavailable', async () => {
    await expect(
      consumeAiRateLimit('client-b', {
        redisClient: { eval: vi.fn(async () => Promise.reject(new Error('connection refused'))) },
      }),
    ).rejects.toBeInstanceOf(AiRateLimitUnavailableError);
  });
});
