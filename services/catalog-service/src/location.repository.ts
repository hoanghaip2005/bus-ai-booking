import { Inject, Injectable } from '@nestjs/common';

import { CatalogDatabase } from './catalog.database';

export interface LocationSuggestionRecord {
  id: string;
  code: string;
  name: string;
  normalizedName: string;
  kind: 'CITY' | 'STATION';
  parentLocationId?: string;
}

interface LocationRow {
  id: string;
  code: string;
  name: string;
  normalized_name: string;
  kind: 'CITY' | 'STATION';
  parent_location_id: string | null;
}

@Injectable()
export class LocationRepository {
  constructor(@Inject(CatalogDatabase) private readonly database: CatalogDatabase) {}

  async suggest(normalizedQuery: string, limit: number): Promise<LocationSuggestionRecord[]> {
    const result = await this.database.query<LocationRow>(
      `
        SELECT
          location.id,
          location.code,
          location.name,
          location.normalized_name,
          location.kind,
          location.parent_location_id
        FROM catalog.locations AS location
        WHERE location.is_active
          AND (
            location.normalized_name LIKE $1 || '%'
            OR lower(location.code) LIKE $1 || '%'
            OR EXISTS (
              SELECT 1
              FROM catalog.location_aliases AS alias
              WHERE alias.location_id = location.id
                AND alias.normalized_alias LIKE $1 || '%'
            )
          )
        ORDER BY
          CASE
            WHEN location.normalized_name = $1 OR lower(location.code) = $1 THEN 0
            WHEN EXISTS (
              SELECT 1
              FROM catalog.location_aliases AS alias
              WHERE alias.location_id = location.id
                AND alias.normalized_alias = $1
            ) THEN 1
            WHEN location.normalized_name LIKE $1 || '%' OR lower(location.code) LIKE $1 || '%' THEN 2
            ELSE 3
          END,
          CASE location.kind WHEN 'CITY' THEN 0 ELSE 1 END,
          location.name,
          location.id
        LIMIT $2
      `,
      [normalizedQuery, limit],
    );

    return result.rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      normalizedName: row.normalized_name,
      kind: row.kind,
      ...(row.parent_location_id ? { parentLocationId: row.parent_location_id } : {}),
    }));
  }
}
