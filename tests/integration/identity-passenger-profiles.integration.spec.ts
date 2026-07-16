import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { IdentityDatabase } from '../../services/identity-service/src/identity.database';
import { IdentityRepository } from '../../services/identity-service/src/identity.repository';
import {
  IdentityNotFoundError,
  IdentityService,
} from '../../services/identity-service/src/identity.service';
import { IdentityTokenService } from '../../services/identity-service/src/token.service';

const primaryCustomerId = '00000000-0000-4000-8000-000000001401';
const otherCustomerId = randomUUID();
const database = new IdentityDatabase();
const repository = new IdentityRepository(database);
const service = new IdentityService(database, repository, new IdentityTokenService());

describe('identity passenger profile integration', () => {
  beforeAll(async () => {
    await database.query(
      `INSERT INTO identity.users (
        id, email, normalized_email, display_name, password_hash, role, is_active
      ) VALUES ($1, $2, $2, 'Other Customer', $3, 'CUSTOMER', true)`,
      [
        otherCustomerId,
        `other-${otherCustomerId}@example.com`,
        'scrypt$00000000000000000000000000000000$36c758b0b46e56f70ad4027169e2a544e902b0fd4de55a6b2e35901bedb8405bb766fdbafe10880c0d4c0c08f62af48adc2d869f59ba768c405f7f960a0fe024',
      ],
    );
    await database.query(
      `DELETE FROM identity.passenger_profiles WHERE user_id IN ($1, $2) AND label LIKE 'E2E-%'`,
      [primaryCustomerId, otherCustomerId],
    );
  });

  afterAll(async () => {
    await database.query('DELETE FROM identity.passenger_profiles WHERE user_id = $1', [
      otherCustomerId,
    ]);
    await database.query('DELETE FROM identity.users WHERE id = $1', [otherCustomerId]);
    await database.query(
      `DELETE FROM identity.passenger_profiles WHERE user_id = $1 AND label LIKE 'E2E-%'`,
      [primaryCustomerId],
    );
    await database.onModuleDestroy();
  });

  it('creates, lists, updates and deletes only within the owning customer', async () => {
    const created = await service.createPassengerProfile(primaryCustomerId, {
      label: 'E2E-Mẹ',
      fullName: 'Nguyen Thi B',
      phone: '0902223344',
    });

    const listed = await service.listPassengerProfiles(primaryCustomerId);
    expect(listed.profiles).toContainEqual(expect.objectContaining({ id: created.profile.id }));
    await expect(
      service.updatePassengerProfile(otherCustomerId, created.profile.id, {
        label: 'E2E-Hijack',
        fullName: 'Other Customer',
      }),
    ).rejects.toBeInstanceOf(IdentityNotFoundError);

    const updated = await service.updatePassengerProfile(primaryCustomerId, created.profile.id, {
      label: 'E2E-Mẹ mới',
      fullName: 'Nguyen Thi B',
      phone: '+84 902 223 344',
    });
    expect(updated.profile).toMatchObject({ label: 'E2E-Mẹ mới', phone: '+84902223344' });

    await expect(
      service.deletePassengerProfile(primaryCustomerId, created.profile.id),
    ).resolves.toMatchObject({
      deleted: true,
    });
    await expect(
      service.deletePassengerProfile(primaryCustomerId, created.profile.id),
    ).rejects.toBeInstanceOf(IdentityNotFoundError);
  });
});
