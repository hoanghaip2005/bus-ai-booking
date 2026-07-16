import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { IdentityDatabase } from '../../services/identity-service/src/identity.database';
import { IdentityRepository } from '../../services/identity-service/src/identity.repository';
import {
  IdentityService,
  IdentityUnauthenticatedError,
} from '../../services/identity-service/src/identity.service';
import { IdentityTokenService } from '../../services/identity-service/src/token.service';

describe('identity refresh lifecycle integration', () => {
  const database = new IdentityDatabase();
  const repository = new IdentityRepository(database);
  const service = new IdentityService(database, repository, new IdentityTokenService());

  beforeAll(async () => {
    await database.query(`DELETE FROM identity.refresh_sessions WHERE user_id = $1`, [
      '00000000-0000-4000-8000-000000001401',
    ]);
  });

  afterAll(async () => {
    await database.query(`DELETE FROM identity.refresh_sessions WHERE user_id = $1`, [
      '00000000-0000-4000-8000-000000001401',
    ]);
    await database.onModuleDestroy();
  });

  it('logs in, validates, rotates once, rejects replay, then revokes the replacement', async () => {
    const login = await service.login({
      email: 'customer.demo@benviet.vn',
      password: 'Customer123!',
    });
    await expect(
      service.validateAccessToken({ accessToken: login.session.accessToken }),
    ).resolves.toMatchObject({ actor: { id: login.session.user.id, role: 'CUSTOMER' } });

    const refreshed = await service.refresh({ refreshToken: login.session.refreshToken });
    expect(refreshed.session.refreshToken).not.toBe(login.session.refreshToken);
    await expect(
      service.refresh({ refreshToken: login.session.refreshToken }),
    ).rejects.toBeInstanceOf(IdentityUnauthenticatedError);

    await expect(
      service.logout({ refreshToken: refreshed.session.refreshToken }),
    ).resolves.toMatchObject({
      revoked: false,
    });
    await expect(
      service.refresh({ refreshToken: refreshed.session.refreshToken }),
    ).rejects.toBeInstanceOf(IdentityUnauthenticatedError);
  });

  it('rejects an access token immediately after logout revokes its issuing session', async () => {
    const login = await service.login({
      email: 'customer.demo@benviet.vn',
      password: 'Customer123!',
    });

    await expect(
      service.validateAccessToken({ accessToken: login.session.accessToken }),
    ).resolves.toMatchObject({ actor: { id: login.session.user.id } });
    await expect(
      service.logout({ refreshToken: login.session.refreshToken }),
    ).resolves.toMatchObject({ revoked: true });
    await expect(
      service.validateAccessToken({ accessToken: login.session.accessToken }),
    ).rejects.toBeInstanceOf(IdentityUnauthenticatedError);
  });
});
