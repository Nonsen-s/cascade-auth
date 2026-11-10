import { loadServerConfig } from './environment.js';
import { ConfigurationError } from './config.js';
import { openDatabase } from './infrastructure/database/open.js';
import { assertSchema } from './infrastructure/database/migrations.js';
import { PostgresOutboxRepository } from './infrastructure/database/outbox-repository.js';
import { AesMailCipher } from './infrastructure/security/mail-cipher.js';
import { SmtpMailer } from './infrastructure/mail/smtp-mailer.js';
import { MailWorker } from './infrastructure/mail/mail-worker.js';

async function main() {
  const config = loadServerConfig();
  if (config.database.driver !== 'postgres' || config.mail.transport !== 'smtp')
    throw new ConfigurationError([
      'standalone-worker-requires-postgres-and-smtp',
    ]);
  const database = await openDatabase(config.database);
  const sender = new SmtpMailer(config.mail, config.appOrigin);
  try {
    await assertSchema(database);
  } catch (error) {
    sender.close();
    await database.close();
    throw error;
  }
  const safeLog = {
    warn: () => process.stderr.write('Email delivery deferred\n'),
    error: () => process.stderr.write('Email worker requires attention\n'),
  };
  const worker = new MailWorker(
    new PostgresOutboxRepository(database),
    new AesMailCipher(config.mail.activeKeyId, config.mail.keys),
    sender,
    () => new Date(),
    safeLog,
  );
  worker.start();
  // Standalone workers need a referenced timer to keep the process alive.
  const keepAlive = setInterval(() => undefined, 60_000);
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    clearInterval(keepAlive);
    void (async () => {
      try {
        await worker.stop();
      } finally {
        sender.close();
        await database.close();
      }
    })().catch(() => {
      process.stderr.write('Worker shutdown failed\n');
      process.exitCode = 1;
    });
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
void main().catch((error: unknown) => {
  process.stderr.write(
    error instanceof ConfigurationError
      ? `${error.message}\n`
      : 'Worker startup failed\n',
  );
  process.exitCode = 1;
});
