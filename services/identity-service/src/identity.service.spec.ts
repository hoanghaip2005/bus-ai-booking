import { describe, expect, it, vi } from 'vitest';

import type { IdentityDatabase } from './identity.database';
import type { IdentityRepository } from './identity.repository';
import { IdentityService, IdentityUnauthenticatedError } from './identity.service';
import type { IdentityUser } from './identity.types';
import { IdentityTokenService } from './token.service';

const customer: IdentityUser = {
  id: '00000000-0000-4000-8000-000000001401',
  email: 'customer.demo@benviet.vn',
  displayName: 'Khách hàng Demo',
  passwordHash:
    'scrypt$11111111111111111111111111111111$7ab5eea4549840ef632deaf5ab7bbd8024bb820f85b88882043649c34d630cef1640482b51412632503aedd80921651e9b73c52529ff4d9ecc96f6dfca7bc182',
  role: 'CUSTOMER',
  active: true,
};

describe('IdentityService', () => {
  it('returns the same neutral authentication error for unknown user and wrong password', async () => {
    const repository = {
      findActiveUserByEmail: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(customer),
    };
    const service = createService(repository);

    await expect(
      service.login({ email: 'missing@example.com', password: 'WrongPassword!' }),
    ).rejects.toBeInstanceOf(IdentityUnauthenticatedError);
    await expect(
      service.login({ email: customer.email, password: 'WrongPassword!' }),
    ).rejects.toBeInstanceOf(IdentityUnauthenticatedError);
  });

  it('issues a session only after password verification and persists the refresh digest', async () => {
    const repository = {
      findActiveUserByEmail: vi.fn().mockResolvedValue(customer),
      createRefreshSession: vi.fn().mockResolvedValue(undefined),
    };
    const service = createService(repository);

    const result = await service.login({
      email: ` ${customer.email.toUpperCase()} `,
      password: 'Customer123!',
    });

    expect(result.session.user).toMatchObject({ id: customer.id, role: 'CUSTOMER' });
    expect(repository.createRefreshSession).toHaveBeenCalledWith(
      customer.id,
      expect.objectContaining({ tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/) }),
    );
  });

  it('rejects an access token after its issuing refresh session is revoked', async () => {
    const tokens = new IdentityTokenService();
    const sessionId = '00000000-0000-4000-8000-000000001499';
    const access = tokens.createAccessToken(customer, sessionId);
    const repository = {
      findActiveUserById: vi.fn().mockResolvedValue(customer),
      isRefreshSessionActive: vi.fn().mockResolvedValue(false),
    };
    const service = createService(repository, tokens);

    await expect(service.validateAccessToken({ accessToken: access.token })).rejects.toBeInstanceOf(
      IdentityUnauthenticatedError,
    );
    expect(repository.isRefreshSessionActive).toHaveBeenCalledWith(
      sessionId,
      customer.id,
      expect.any(String),
    );
  });

  it('normalizes passenger profiles and keeps the user ID inside Identity ownership', async () => {
    const createPassengerProfile = vi.fn(async (input) => ({
      id: input.id,
      ...input.profile,
      createdAt: input.occurredAt,
      updatedAt: input.occurredAt,
    }));
    const service = createService({
      findActiveUserById: vi.fn(async () => customer),
      createPassengerProfile,
    });

    const result = await service.createPassengerProfile(
      customer.id,
      { label: '  Mẹ  ', fullName: '  Nguyen   Thi B  ', phone: '090 222 3344' },
      'request-profile',
    );

    expect(result.profile).toMatchObject({
      label: 'Mẹ',
      fullName: 'Nguyen Thi B',
      phone: '0902223344',
    });
    expect(createPassengerProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: customer.id,
        profile: expect.objectContaining({ label: 'Mẹ' }),
      }),
    );
  });

  it('rejects invalid profile fields before writing', async () => {
    const createPassengerProfile = vi.fn();
    const service = createService({
      findActiveUserById: vi.fn(async () => customer),
      createPassengerProfile,
    });

    await expect(
      service.createPassengerProfile(customer.id, { label: '', fullName: 'A', phone: '123' }),
    ).rejects.toMatchObject({ name: 'IdentityValidationError' });
    expect(createPassengerProfile).not.toHaveBeenCalled();
  });
});

function createService(
  repository: object,
  tokens: IdentityTokenService = new IdentityTokenService(),
): IdentityService {
  return new IdentityService(
    { ping: vi.fn() } as unknown as IdentityDatabase,
    repository as IdentityRepository,
    tokens,
  );
}
