import { logEvent } from '@bus/observability';
import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';

@Injectable()
export class AnalyticsDatabase implements OnModuleDestroy {
  private readonly pool = new Pool({
    connectionString:
      process.env.ANALYTICS_DATABASE_URL ??
      'postgresql://bus:bus_local_password@localhost:5432/bus_platform',
    max: Number(process.env.ANALYTICS_DATABASE_POOL_SIZE ?? 10),
    application_name: 'analytics-service',
  });

  constructor() {
    this.pool.on('error', () => {
      logEvent({
        service: 'analytics-service',
        level: 'error',
        event: 'analytics.postgresql.idle-client-error',
        message: 'An idle PostgreSQL client failed and was removed.',
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
