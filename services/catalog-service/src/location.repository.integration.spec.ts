import { afterAll, describe, expect, it } from 'vitest';

import { CatalogDatabase } from './catalog.database';
import { LocationRepository } from './location.repository';

const database = new CatalogDatabase();
const repository = new LocationRepository(database);

describe('LocationRepository', () => {
  afterAll(async () => database.onModuleDestroy());

  it('finds a city by an unaccented alias', async () => {
    const suggestions = await repository.suggest('sai gon', 8);

    expect(suggestions[0]).toMatchObject({ code: 'HCM', name: 'TP.HCM', kind: 'CITY' });
  });

  it('finds stations and keeps their parent city', async () => {
    const suggestions = await repository.suggest('mien', 8);

    expect(suggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'BX-MD', kind: 'STATION' }),
        expect.objectContaining({ code: 'BX-MT', kind: 'STATION' }),
      ]),
    );
    expect(suggestions.every((suggestion) => suggestion.parentLocationId)).toBe(true);
  });
});
