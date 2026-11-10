import { PGlite } from '@electric-sql/pglite';
import type { Database, SqlExecutor, SqlValue } from './database.js';
import { rowsSchema } from './database.js';

/** Explicit development/test adapter; production is rejected by configuration validation. */
export class PgliteDatabase implements Database {
  private constructor(private readonly engine: PGlite) {}
  static async create(directory?: string): Promise<PgliteDatabase> {
    const engine = directory ? new PGlite(directory) : new PGlite();
    await engine.waitReady;
    return new PgliteDatabase(engine);
  }
  async query(sql: string, values: readonly SqlValue[] = []) {
    return rowsSchema.parse(
      (await this.engine.query<Record<string, unknown>>(sql, [...values])).rows,
    );
  }
  async transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    return this.engine.transaction(async (connection) =>
      work({
        query: async (sql, values = []) =>
          rowsSchema.parse(
            (await connection.query<Record<string, unknown>>(sql, [...values]))
              .rows,
          ),
      }),
    );
  }
  async close() {
    await this.engine.close();
  }
}
