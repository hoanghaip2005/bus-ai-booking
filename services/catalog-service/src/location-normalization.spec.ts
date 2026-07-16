import { describe, expect, it } from 'vitest';

import { normalizeLocationQuery } from './location-normalization';

describe('normalizeLocationQuery', () => {
  it.each([
    ['Sài Gòn', 'sai gon'],
    ['Đà Lạt', 'da lat'],
    ['TP.HCM', 'tp hcm'],
    ['  Bến   xe Miền Đông  ', 'ben xe mien dong'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeLocationQuery(input)).toBe(expected);
  });
});
