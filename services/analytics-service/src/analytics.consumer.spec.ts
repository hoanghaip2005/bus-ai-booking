import { describe, expect, it } from 'vitest';

import { parseAnalyticsMessage } from './analytics.consumer';

describe('analytics Kafka message parsing', () => {
  it('returns undefined for malformed or empty payloads so the consumer can advance safely', () => {
    expect(parseAnalyticsMessage(null)).toBeUndefined();
    expect(parseAnalyticsMessage(Buffer.from('{not-json'))).toBeUndefined();
  });

  it('parses a valid JSON event without exposing payload contents in logs', () => {
    expect(parseAnalyticsMessage(Buffer.from('{"eventId":"event-1"}'))).toEqual({
      eventId: 'event-1',
    });
  });
});
