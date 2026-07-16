import { describe, expect, it } from 'vitest';

import { dummyPasswordHash, verifyPassword } from './password';

describe('identity password verification', () => {
  it('accepts the seeded customer password and rejects an incorrect password', async () => {
    const seededHash =
      'scrypt$11111111111111111111111111111111$7ab5eea4549840ef632deaf5ab7bbd8024bb820f85b88882043649c34d630cef1640482b51412632503aedd80921651e9b73c52529ff4d9ecc96f6dfca7bc182';

    await expect(verifyPassword('Customer123!', seededHash)).resolves.toBe(true);
    await expect(verifyPassword('WrongPassword!', seededHash)).resolves.toBe(false);
  });

  it('performs valid scrypt work for the unknown-user dummy hash', async () => {
    await expect(verifyPassword('irrelevant-password', dummyPasswordHash)).resolves.toBe(false);
  });
});
