import { fileURLToPath } from 'node:url';
import { AccountService } from './application/auth-service.js';
import type { ServerConfig } from './config.js';
import { buildHttpServer } from './http/server.js';
import { openDatabase } from './infrastructure/database/open.js';
import { assertSchema, migrate } from './infrastructure/database/migrations.js';
import { PostgresAuthRepository } from './infrastructure/database/auth-repository.js';
import { PostgresRateLimiter } from './infrastructure/database/rate-limiter.js';
import { PostgresOutboxRepository } from './infrastructure/database/outbox-repository.js';
import { AesMailCipher } from './infrastructure/security/mail-cipher.js';
import { SecurityTokens } from './infrastructure/security/tokens.js';
import { Argon2PasswordHasher } from './infrastructure/security/password-hasher.js';
import { FileMailer } from './infrastructure/mail/file-mailer.js';
import { SmtpMailer } from './infrastructure/mail/smtp-mailer.js';
import { MailWorker } from './infrastructure/mail/mail-worker.js';

export const migrationsDirectory = fileURLToPath(
  new URL('../migrations/', import.meta.url),
);

/** The only place that assembles concrete backend implementations. */
export async function createRuntime(config: ServerConfig) {
  const database = await openDatabase(config.database);
  const sender =
    config.mail.transport === 'file'
      ? new FileMailer(config.mail.directory, config.appOrigin)
      : new SmtpMailer(config.mail, config.appOrigin);
  try {
    if (config.database.autoMigrate)
      await migrate(database, migrationsDirectory);
    else await assertSchema(database);
    const cipher = new AesMailCipher(config.mail.activeKeyId, config.mail.keys);
    const tokens = new SecurityTokens(config.secret);
    const passwords = await Argon2PasswordHasher.create(config.hashConcurrency);
    const accounts = new AccountService(
      new PostgresAuthRepository(database, cipher),
      passwords,
      tokens,
      () => new Date(),
    );
    const server = await buildHttpServer({
      config,
      accounts,
      tokens,
      limiter: new PostgresRateLimiter(database),
      database,
      now: () => new Date(),
    });
    const worker = new MailWorker(
      new PostgresOutboxRepository(database),
      cipher,
      sender,
      () => new Date(),
      server.log,
    );
    let closing: Promise<void> | null = null;
    return {
      server,
      worker,
      close(): Promise<void> {
        closing ??= (async () => {
          const stopped = await Promise.allSettled([
            server.close(),
            worker.stop(),
          ]);
          sender.close();
          await database.close();
          if (stopped.some((result) => result.status === 'rejected'))
            throw new Error('Runtime shutdown failed');
        })();
        return closing;
      },
    };
  } catch (error) {
    sender.close();
    await database.close();
    throw error;
  }
}
