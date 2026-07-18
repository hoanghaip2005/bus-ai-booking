import { describe, expect, it } from 'vitest';

import { longScalar } from './long.scalar';

describe('Long GraphQL scalar', () => {
  it('serializes aggregate VND values above the GraphQL Int limit', () => {
    expect(longScalar.serialize(3_000_000_000)).toBe(3_000_000_000);
    expect(longScalar.serialize('9007199254740991')).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('rejects non-integers and values outside the JavaScript safe range', () => {
    expect(() => longScalar.serialize(1.5)).toThrow('safe integer');
    expect(() => longScalar.serialize('9007199254740992')).toThrow('safe integer');
  });
});
