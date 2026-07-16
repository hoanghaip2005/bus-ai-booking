import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient, QueryResultRow } from 'pg';

import { IdentityDatabase } from './identity.database';
import type {
  IdentityRole,
  IdentityUser,
  PassengerProfile,
  PassengerProfileInput,
  RefreshCredential,
} from './identity.types';

interface UserRow extends QueryResultRow {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  role: IdentityRole;
  is_active: boolean;
}

interface RefreshSessionRow extends UserRow {
  session_id: string;
  family_id: string;
  token_hash: string;
  expires_at: Date;
  revoked_at: Date | null;
  rotated_to_session_id: string | null;
}

interface PassengerProfileRow extends QueryResultRow {
  id: string;
  label: string;
  full_name: string;
  phone: string | null;
  created_at: Date;
  updated_at: Date;
}

export class PassengerProfileLimitError extends Error {
  constructor() {
    super('Passenger profile limit reached.');
    this.name = 'PassengerProfileLimitError';
  }
}

export class PassengerProfileLabelConflictError extends Error {
  constructor() {
    super('Passenger profile label already exists.');
    this.name = 'PassengerProfileLabelConflictError';
  }
}

@Injectable()
export class IdentityRepository {
  constructor(@Inject(IdentityDatabase) private readonly database: IdentityDatabase) {}

  async findActiveUserByEmail(normalizedEmail: string): Promise<IdentityUser | null> {
    const result = await this.database.query<UserRow>(
      `${userSelectSql}
       WHERE normalized_email = $1 AND is_active = true`,
      [normalizedEmail],
    );
    return result.rows[0] ? mapUser(result.rows[0]) : null;
  }

  async findActiveUserById(id: string): Promise<IdentityUser | null> {
    const result = await this.database.query<UserRow>(
      `${userSelectSql}
       WHERE id = $1 AND is_active = true`,
      [id],
    );
    return result.rows[0] ? mapUser(result.rows[0]) : null;
  }

  async createRefreshSession(userId: string, credential: RefreshCredential): Promise<void> {
    await this.database.query(
      `INSERT INTO identity.refresh_sessions (
        id, user_id, family_id, token_hash, expires_at, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        credential.id,
        userId,
        credential.familyId,
        credential.tokenHash,
        credential.expiresAt,
        credential.createdAt,
      ],
    );
  }

  async rotateRefreshSession(input: {
    sessionId: string;
    tokenHash: string;
    now: string;
    nextCredential: RefreshCredential;
  }): Promise<IdentityUser | null> {
    return this.database.withTransaction(async (client) => {
      const current = await selectRefreshSession(client, input.sessionId);
      if (!current) return null;
      if (current.revoked_at !== null) {
        if (current.rotated_to_session_id !== null) {
          await client.query(
            `UPDATE identity.refresh_sessions
             SET revoked_at = COALESCE(revoked_at, $2)
             WHERE family_id = $1 AND revoked_at IS NULL`,
            [current.family_id, input.now],
          );
        }
        return null;
      }
      if (
        current.token_hash.trim() !== input.tokenHash ||
        current.expires_at.getTime() <= Date.parse(input.now) ||
        !current.is_active
      ) {
        return null;
      }
      await insertRefreshSession(client, current.id, {
        ...input.nextCredential,
        familyId: current.family_id,
      });
      await client.query(
        `UPDATE identity.refresh_sessions
         SET revoked_at = $2, rotated_to_session_id = $3, last_used_at = $2
         WHERE id = $1`,
        [input.sessionId, input.now, input.nextCredential.id],
      );
      return mapUser(current);
    });
  }

  async revokeRefreshSession(sessionId: string, tokenHash: string, now: string): Promise<boolean> {
    const result = await this.database.query(
      `UPDATE identity.refresh_sessions
       SET revoked_at = $3, last_used_at = $3
       WHERE id = $1
         AND token_hash = $2
         AND revoked_at IS NULL
         AND expires_at > $3`,
      [sessionId, tokenHash, now],
    );
    return result.rowCount === 1;
  }

  async isRefreshSessionActive(sessionId: string, userId: string, now: string): Promise<boolean> {
    const result = await this.database.query(
      `SELECT 1
       FROM identity.refresh_sessions
       WHERE id = $1
         AND user_id = $2
         AND revoked_at IS NULL
         AND expires_at > $3`,
      [sessionId, userId, now],
    );
    return result.rowCount === 1;
  }

  async listPassengerProfiles(userId: string): Promise<PassengerProfile[]> {
    const result = await this.database.query<PassengerProfileRow>(
      `${passengerProfileSelectSql}
       WHERE user_id = $1
       ORDER BY updated_at DESC, id`,
      [userId],
    );
    return result.rows.map(mapPassengerProfile);
  }

  async createPassengerProfile(input: {
    id: string;
    userId: string;
    profile: PassengerProfileInput;
    occurredAt: string;
  }): Promise<PassengerProfile> {
    return this.database.withTransaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [input.userId]);
      const count = await client.query<{ count: string } & QueryResultRow>(
        'SELECT count(*)::text AS count FROM identity.passenger_profiles WHERE user_id = $1',
        [input.userId],
      );
      if (Number(count.rows[0]?.count ?? 0) >= 20) throw new PassengerProfileLimitError();
      try {
        const result = await client.query<PassengerProfileRow>(
          `INSERT INTO identity.passenger_profiles (
            id, user_id, label, full_name, phone, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $6)
          RETURNING id, label, full_name, phone, created_at, updated_at`,
          [
            input.id,
            input.userId,
            input.profile.label,
            input.profile.fullName,
            input.profile.phone ?? null,
            input.occurredAt,
          ],
        );
        return mapPassengerProfile(result.rows[0]!);
      } catch (error) {
        if (postgresCode(error) === '23505') throw new PassengerProfileLabelConflictError();
        throw error;
      }
    });
  }

  async updatePassengerProfile(input: {
    id: string;
    userId: string;
    profile: PassengerProfileInput;
    occurredAt: string;
  }): Promise<PassengerProfile | null> {
    try {
      const result = await this.database.query<PassengerProfileRow>(
        `UPDATE identity.passenger_profiles
         SET label = $3, full_name = $4, phone = $5, updated_at = $6
         WHERE id = $1 AND user_id = $2
         RETURNING id, label, full_name, phone, created_at, updated_at`,
        [
          input.id,
          input.userId,
          input.profile.label,
          input.profile.fullName,
          input.profile.phone ?? null,
          input.occurredAt,
        ],
      );
      return result.rows[0] ? mapPassengerProfile(result.rows[0]) : null;
    } catch (error) {
      if (postgresCode(error) === '23505') throw new PassengerProfileLabelConflictError();
      throw error;
    }
  }

  async deletePassengerProfile(id: string, userId: string): Promise<boolean> {
    const result = await this.database.query(
      'DELETE FROM identity.passenger_profiles WHERE id = $1 AND user_id = $2',
      [id, userId],
    );
    return result.rowCount === 1;
  }

  ping(): Promise<void> {
    return this.database.ping();
  }
}

const userSelectSql = `SELECT
  id, email, display_name, password_hash, role, is_active
FROM identity.users`;

const passengerProfileSelectSql = `SELECT
  id, label, full_name, phone, created_at, updated_at
FROM identity.passenger_profiles`;

async function selectRefreshSession(
  client: PoolClient,
  sessionId: string,
): Promise<RefreshSessionRow | null> {
  const result = await client.query<RefreshSessionRow>(
    `SELECT
      sessions.id AS session_id, sessions.family_id, sessions.token_hash,
      sessions.expires_at, sessions.revoked_at, sessions.rotated_to_session_id,
      users.id, users.email, users.display_name, users.password_hash,
      users.role, users.is_active
     FROM identity.refresh_sessions AS sessions
     JOIN identity.users AS users ON users.id = sessions.user_id
     WHERE sessions.id = $1
     FOR UPDATE OF sessions`,
    [sessionId],
  );
  return result.rows[0] ?? null;
}

async function insertRefreshSession(
  client: PoolClient,
  userId: string,
  credential: RefreshCredential,
): Promise<void> {
  await client.query(
    `INSERT INTO identity.refresh_sessions (
      id, user_id, family_id, token_hash, expires_at, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      credential.id,
      userId,
      credential.familyId,
      credential.tokenHash,
      credential.expiresAt,
      credential.createdAt,
    ],
  );
}

function mapUser(row: UserRow): IdentityUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    passwordHash: row.password_hash,
    role: row.role,
    active: row.is_active,
  };
}

function mapPassengerProfile(row: PassengerProfileRow): PassengerProfile {
  return {
    id: row.id,
    label: row.label,
    fullName: row.full_name,
    ...(row.phone !== null && { phone: row.phone }),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function postgresCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}
