import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ServerConfig } from '../../config.js';
import type { Database } from './database.js';
import { PostgresDatabase } from './postgres.js';

export async function openDatabase(
  config: ServerConfig['database'],
): Promise<Database> {
  if (config.driver === 'pglite') {
    const { PgliteDatabase } = await import('./pglite.js');
    await mkdir(resolve(config.directory), { recursive: true, mode: 0o700 });
    return PgliteDatabase.create(config.directory);
  }
  if (!config.url) throw new Error('Database URL is missing');
  return new PostgresDatabase(config.url, config.poolSize, config.ssl, () => {
    process.stderr.write('Database pool connection error\n');
  });
}
