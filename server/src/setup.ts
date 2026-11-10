import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { z } from 'zod';

const environment =
  [
    'NODE_ENV=development',
    'HOST=127.0.0.1',
    'PORT=3001',
    'APP_ORIGIN=http://127.0.0.1:5173',
    `APP_SECRET=${randomBytes(32).toString('hex')}`,
    'DB_DRIVER=pglite',
    'PGLITE_DIRECTORY=.local/postgres',
    'AUTO_MIGRATE=true',
    'MAIL_TRANSPORT=file',
    'MAIL_DIRECTORY=.local/mail',
    'MAIL_FROM=accounts@example.com',
    'MAIL_ACTIVE_KEY_ID=v1',
    `MAIL_ENCRYPTION_KEYS={"v1":"${randomBytes(32).toString('hex')}"}`,
    'RUN_MAIL_WORKER=true',
  ].join('\n') + '\n';

try {
  await writeFile('.env.server', environment, { flag: 'wx', mode: 0o600 });
  process.stdout.write(
    'Created .env.server with private development keys. Existing files are never overwritten.\n',
  );
} catch (error) {
  if (z.object({ code: z.literal('EEXIST') }).safeParse(error).success)
    process.stdout.write('.env.server already exists; kept unchanged.\n');
  else {
    process.stderr.write('Could not create .env.server\n');
    process.exitCode = 1;
  }
}
