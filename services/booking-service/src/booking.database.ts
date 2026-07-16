import { logEvent } from '@bus/observability';
import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';

@Injectable()
export class BookingDatabase implements OnModuleDestroy {
  private readonly connectionString =
    process.env.BOOKING_DATABASE_URL ??
    'postgresql://bus:bus_local_password@localhost:5432/bus_platform';
  private readonly poolSize = Number(process.env.BOOKING_DATABASE_POOL_SIZE ?? 10);
  private readonly pool = new Pool({
    connectionString: this.connectionString,
    max: this.poolSize,
    application_name: 'booking-service',
  });
  private readonly coordinationPool = new Pool({
    connectionString: this.connectionString,
    max: this.poolSize,
    statement_timeout: 10_000,
    application_name: 'booking-service-coordination',
  });

  constructor() {
    this.pool.on('error', () => {
      logEvent({
        service: 'booking-service',
        level: 'error',
        event: 'booking.postgresql.idle-client-error',
        message: 'An idle PostgreSQL connection failed and was removed from the pool.',
        fields: { dependency: 'postgresql' },
      });
    });
    this.coordinationPool.on('error', () => {
      logEvent({
        service: 'booking-service',
        level: 'error',
        event: 'booking.postgresql.coordination-idle-client-error',
        message: 'An idle PostgreSQL coordination connection failed and was removed.',
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

  async withPaymentCommandLock<T>(bookingId: string, operation: () => Promise<T>): Promise<T> {
    const client = await this.coordinationPool.connect();
    const lockName = `booking-payment:${bookingId}`;
    let destroyConnection: Error | boolean | undefined;
    try {
      await client.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [lockName]);
      let operationResult!: T;
      let operationFailed = false;
      let operationError: unknown;
      try {
        operationResult = await operation();
      } catch (error) {
        operationFailed = true;
        operationError = error;
      }

      let unlockError: unknown;
      try {
        const result = await client.query<{ unlocked: boolean }>(
          'SELECT pg_advisory_unlock(hashtextextended($1, 0)) AS unlocked',
          [lockName],
        );
        if (!result.rows[0]?.unlocked) {
          throw new Error('Booking payment advisory lock was not held by this connection.');
        }
      } catch (error) {
        unlockError = error;
        destroyConnection = error instanceof Error ? error : true;
        logEvent({
          service: 'booking-service',
          level: 'error',
          event: 'booking.payment-command-lock.release-failed',
          message: 'A booking payment advisory lock could not be released cleanly.',
          fields: { dependency: 'postgresql', bookingId },
        });
      }

      if (operationFailed) throw operationError;
      if (unlockError !== undefined) throw unlockError;
      return operationResult;
    } finally {
      client.release(destroyConnection);
    }
  }

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.pool.end(), this.coordinationPool.end()]);
  }
}
