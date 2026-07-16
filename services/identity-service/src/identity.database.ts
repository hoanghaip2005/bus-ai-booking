import { logEvent } from '@bus/observability';
import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';

@Injectable()
export class IdentityDatabase implements OnModuleDestroy {
  private readonly pool = new Pool({
    connectionString:
      process.env.IDENTITY_DATABASE_URL ??
      'postgresql://bus:bus_local_password@localhost:5432/bus_platform',
    max: Number(process.env.IDENTITY_DATABASE_POOL_SIZE ?? 10),
    application_name: 'identity-service',
  });

  constructor() {
    this.pool.on('error', () => {
      logEvent({
        service: 'identity-service',
        level: 'error',
        event: 'identity.postgresql.idle-client-error',
        message: 'An idle PostgreSQL connection failed and was removed from the pool.',
        fields: { dependency: 'postgresql' },
      });
    });
  }

  query<Row extends QueryResultRow>(text: string, values: readonly unknown[] = []) {
    return this.pool.query<Row>(text, [...values]);
  }

  async withTransaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
