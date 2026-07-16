import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { logEvent } from '@bus/observability';
import { Pool, type QueryResult, type QueryResultRow } from 'pg';

export interface CatalogTransaction {
  query<Row extends QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<Row>>;
}

@Injectable()
export class CatalogDatabase implements OnModuleDestroy {
  private readonly pool = new Pool({
    connectionString:
      process.env.CATALOG_DATABASE_URL ??
      'postgresql://bus:bus_local_password@localhost:5432/bus_platform',
    max: Number(process.env.CATALOG_DATABASE_POOL_SIZE ?? 10),
    application_name: 'catalog-service',
  });

  constructor() {
    this.pool.on('error', () => {
      logEvent({
        service: 'catalog-service',
        level: 'error',
        event: 'catalog.postgresql.idle-client-error',
        message: 'An idle PostgreSQL connection failed and was removed from the pool.',
        fields: { dependency: 'postgresql' },
      });
    });
  }

  query<Row extends QueryResultRow>(text: string, values: readonly unknown[] = []) {
    return this.pool.query<Row>(text, [...values]);
  }

  async transaction<T>(work: (transaction: CatalogTransaction) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work({
        query: <Row extends QueryResultRow>(text: string, values: readonly unknown[] = []) =>
          client.query<Row>(text, [...values]),
      });
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
