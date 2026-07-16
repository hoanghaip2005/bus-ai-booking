import { Metadata, status } from '@grpc/grpc-js';
import { describe, expect, it, vi } from 'vitest';

import { IdentityController } from './identity.controller';
import type { IdentityService } from './identity.service';

const customerId = '00000000-0000-4000-8000-000000001401';

describe('IdentityController passenger profile authorization', () => {
  it('derives profile ownership from CUSTOMER actor metadata', async () => {
    const listPassengerProfiles = vi.fn(async () => ({
      profiles: [],
      requestId: 'request-profile',
    }));
    const controller = new IdentityController({
      listPassengerProfiles,
    } as unknown as IdentityService);

    await expect(
      controller.grpcListPassengerProfiles({ requestId: 'request-profile' }, customerMetadata()),
    ).resolves.toEqual({ profiles: [], requestId: 'request-profile' });
    expect(listPassengerProfiles).toHaveBeenCalledWith(customerId, 'request-profile');
  });

  it('rejects missing, STAFF or malformed actor metadata', async () => {
    const controller = new IdentityController({} as IdentityService);
    for (const metadata of [
      new Metadata(),
      actorMetadata('STAFF'),
      actorMetadata('CUSTOMER', 'bad-id'),
    ]) {
      await expect(controller.grpcListPassengerProfiles({}, metadata)).rejects.toMatchObject({
        error: expect.objectContaining({ code: status.PERMISSION_DENIED }),
      });
    }
  });
});

function customerMetadata(): Metadata {
  return actorMetadata('CUSTOMER');
}

function actorMetadata(role: string, actorId = customerId): Metadata {
  const metadata = new Metadata();
  metadata.set('x-actor-id', actorId);
  metadata.set('x-actor-role', role);
  metadata.set('x-actor-token-id', '00000000-0000-4000-8000-000000009001');
  return metadata;
}
