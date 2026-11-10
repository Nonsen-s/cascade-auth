import { DatabaseError, Pool, type PoolClient } from 'pg';
import { ConfigurationError, isPostgresConnectionUrl } from '../../config.js';
import type { Database, SqlExecutor, SqlValue } from './database.js';
import { rowsSchema } from './database.js';

const maximumDeadlockRetries = 2;

class Transaction implements SqlExecutor {
  constructor(private readonly client: PoolClient) {}
  async query(sql: string, values: readonly SqlValue[] = []) {
    return rowsSchema.parse(
      (await this.client.query<Record<string, unknown>>(sql, [...values])).rows,
    );
  }
}

export class PostgresDatabase implements Database {
  private readonly pool: Pool;
  constructor(
    url: string,
    poolSize: number,
    ssl: boolean,
    onIdleError: () => void,
  ) {
    // The migration CLI can supply a different URL after config validation.
    if (!isPostgresConnectionUrl(url))
      throw new ConfigurationError(['DATABASE_URL', 'MIGRATION_DATABASE_URL']);
    this.pool = new Pool({
      connectionString: url,
      max: poolSize,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30_000,
      statement_timeout: 10_000,
      application_name: 'cascade-auth',
      ssl: ssl ? { rejectUnauthorized: true } : false,
    });
    this.pool.on('error', onIdleError);
  }
  async query(sql: string, values: readonly SqlValue[] = []) {
    return rowsSchema.parse(
      (await this.pool.query<Record<string, unknown>>(sql, [...values])).rows,
    );
  }
  async transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    for (let retry = 0; ; retry += 1) {
      const connection = await this.pool.connect();
      let discard = false;
      let committing = false;
      try {
        await connection.query('BEGIN');
        const result = await work(new Transaction(connection));
        committing = true;
        await connection.query('COMMIT');
        return result;
      } catch (error) {
        // An acknowledged rollback is required before retrying any work.
        try {
          await connection.query('ROLLBACK');
        } catch {
          discard = true;
          throw error;
        }
        if (
          committing ||
          retry >= maximumDeadlockRetries ||
          !(error instanceof DatabaseError) ||
          error.code !== '40P01'
        )
          throw error;
      } finally {
        connection.release(discard);
      }
    }
  }
  async close() {
    await this.pool.end();
  }
}
