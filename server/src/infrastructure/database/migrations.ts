import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { Database } from './database.js';

export async function migrate(
  database: Database,
  directory: string,
): Promise<void> {
  const files = (await readdir(directory))
    .filter((file) => /^\d{4}_[a-z_]+\.sql$/.test(file))
    .sort();
  if (!files.length) throw new Error('No database migrations found');
  const migrations = await Promise.all(
    files.map(async (file) => ({
      file,
      source: await readFile(join(directory, file), 'utf8'),
    })),
  );
  await database.transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(173821, 1)');
    await tx.query('CREATE SCHEMA IF NOT EXISTS accounts');
    await tx.query(
      'CREATE TABLE IF NOT EXISTS accounts.schema_migrations (version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    for (const migration of migrations) {
      const checksum = createHash('sha256')
        .update(migration.source)
        .digest('hex');
      const existing = await tx.query(
        'SELECT checksum FROM accounts.schema_migrations WHERE version = $1',
        [migration.file],
      );
      if (existing.length) {
        if (
          z.object({ checksum: z.string() }).parse(existing[0]).checksum !==
          checksum
        )
          throw new Error(`Applied migration was modified: ${migration.file}`);
        continue;
      }
      // Migrations are trusted repository SQL, never request input.
      for (const statement of migration.source
        .split('-- statement-breakpoint')
        .map((part) => part.trim())
        .filter(Boolean))
        await tx.query(statement);
      await tx.query(
        'INSERT INTO accounts.schema_migrations(version, checksum) VALUES ($1, $2)',
        [migration.file, checksum],
      );
    }
  });
}

export async function assertSchema(database: Database): Promise<void> {
  const result = await database.query(
    "SELECT version FROM accounts.schema_migrations WHERE version = '0001_auth.sql'",
  );
  if (result.length !== 1)
    throw new Error('Run server:migrate before starting the API');
}
