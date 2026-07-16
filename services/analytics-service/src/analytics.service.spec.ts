import { describe, expect, it } from 'vitest';

import { AnalyticsValidationError, vietnamLocalDate } from './analytics.service';

describe('analytics projection date', () => {
  it('uses the Vietnam-local calendar date for event time', () => {
    expect(vietnamLocalDate('2026-07-14T18:30:00.000Z')).toBe('2026-07-15');
  });

  it('rejects invalid event time', () => {
    expect(() => vietnamLocalDate('not-a-date')).toThrow(AnalyticsValidationError);
  });
});
