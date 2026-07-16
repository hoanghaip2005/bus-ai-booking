import { describe, expect, it } from 'vitest';

import { createRequestId, currentRequestId, withRequestContext } from './index';

describe('request observability context', () => {
  it('keeps a valid inbound request id through async work', async () => {
    const requestId = createRequestId('request-123');
    const observed = await withRequestContext(requestId, async () => {
      await Promise.resolve();
      return currentRequestId();
    });

    expect(observed).toBe('request-123');
  });

  it('replaces unsafe request ids', () => {
    expect(createRequestId('contains spaces')).not.toBe('contains spaces');
  });
});
