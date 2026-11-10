import { fileURLToPath } from 'node:url';
import { loadServerConfig } from './environment.js';
import { openDatabase } from './infrastructure/database/open.js';
import { migrate } from './infrastructure/database/migrations.js';
import { ConfigurationError } from './config.js';

async function main() {
  const config = loadServerConfig();
  const database = await openDatabase({
    ...config.database,
    url: process.env.MIGRATION_DATABASE_URL ?? config.database.url,
  });
  try {
    await migrate(
      database,
      fileURLToPath(new URL('../migrations/', import.meta.url)),
    );
    process.stdout.write('Database migrations applied\n');
  } finally {
    await database.close();
  }
}
void main().catch((error: unknown) => {
  process.stderr.write(
    error instanceof ConfigurationError
      ? `${error.message}\n`
      : 'Database migration failed\n',
  );
  process.exitCode = 1;
});
