import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function port(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) {
    throw new Error(`${name} must be a port between 1 and 65535.`);
  }
  return Number(value);
}

try {
  const webPort = port('WEB_PORT', '8080');
  const mailPort = port('MAILPIT_PORT', '8025');
  if (webPort === mailPort)
    throw new Error('WEB_PORT and MAILPIT_PORT must differ.');
  const key = () => randomBytes(32).toString('hex');
  const contents = [
    '# Private local Docker configuration. Do not publish this file.',
    `WEB_PORT=${webPort}`,
    `MAILPIT_PORT=${mailPort}`,
    `APP_ORIGIN=http://127.0.0.1:${webPort}`,
    `POSTGRES_PASSWORD=${key()}`,
    `APP_SECRET=${key()}`,
    `MAIL_ENCRYPTION_KEYS=${JSON.stringify({ v1: key() })}`,
    '',
  ].join('\n');
  await writeFile(resolve(root, '.env.docker'), contents, {
    flag: 'wx',
    mode: 0o600,
  });
  console.log(`Created .env.docker. Application: http://127.0.0.1:${webPort}`);
  console.log(`Local mail: http://127.0.0.1:${mailPort}`);
} catch (error) {
  if (error.code === 'EEXIST') {
    console.log(
      '.env.docker already exists; its settings have been preserved.',
    );
  } else {
    console.error(error.message);
    process.exitCode = 1;
  }
}
