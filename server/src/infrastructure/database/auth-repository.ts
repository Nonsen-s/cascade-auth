import { z } from 'zod';
import type { AuthRepository, MailCipher } from '../../application/ports.js';
import {
  authPolicy,
  type Account,
  type SessionKind,
  type StoredSession,
  type TokenGrant,
  type TokenPurpose,
} from '../../domain/models.js';
import type { Database, SqlExecutor, SqlRow } from './database.js';
import type { Player } from '../../../../shared/auth-contract.js';

const accountSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  password_hash: z.string(),
  verified_at: z.coerce.date().nullable(),
  auth_version: z.number().int().positive(),
});
const ownerSchema = z.object({ user_id: z.uuid() });
const sessionSchema = z.object({
  digest: z.string(),
  id: z.uuid(),
  email: z.email(),
  verified_at: z.coerce.date().nullable(),
  kind: z.enum(['access', 'recovery']),
  expires_at: z.coerce.date(),
});

function account(row: SqlRow | undefined): Account | null {
  if (!row) return null;
  const value = accountSchema.parse(row);
  return {
    id: value.id,
    email: value.email,
    passwordHash: value.password_hash,
    verifiedAt: value.verified_at,
    authVersion: value.auth_version,
  };
}
function player(value: Account): Player {
  return {
    id: value.id,
    email: value.email,
    emailConfirmed: value.verifiedAt !== null,
  };
}

export class PostgresAuthRepository implements AuthRepository {
  constructor(
    private readonly db: Database,
    private readonly mailCipher: MailCipher,
  ) {}

  async findAccount(email: string): Promise<Account | null> {
    return account(
      (
        await this.db.query(
          'SELECT id, email, password_hash, verified_at, auth_version FROM accounts.users WHERE email = $1',
          [email],
        )
      )[0],
    );
  }

  async createAccount(
    email: string,
    passwordHash: string,
    verification: TokenGrant,
    now: Date,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const created = account(
        (
          await tx.query(
            'INSERT INTO accounts.users(email, password_hash, created_at, updated_at) VALUES ($1, $2, $3, $3) ON CONFLICT(email) DO NOTHING RETURNING id, email, password_hash, verified_at, auth_version',
            [email, passwordHash, now],
          )
        )[0],
      );
      if (created)
        await this.insertToken(tx, created, 'email', verification, now);
    });
  }

  async queueToken(
    email: string,
    purpose: TokenPurpose,
    grant: TokenGrant,
    now: Date,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const user = account(
        (
          await tx.query(
            'SELECT id, email, password_hash, verified_at, auth_version FROM accounts.users WHERE email = $1 FOR UPDATE',
            [email],
          )
        )[0],
      );
      if (
        !user ||
        (purpose === 'email' && user.verifiedAt) ||
        (purpose === 'recovery' && !user.verifiedAt)
      )
        return;
      await tx.query(
        'DELETE FROM accounts.tokens WHERE user_id = $1 AND purpose = $2',
        [user.id, purpose],
      );
      await this.insertToken(tx, user, purpose, grant, now);
    });
  }

  async canVerifyEmail(digest: string, now: Date): Promise<boolean> {
    const rows = await this.db.query(
      "SELECT t.digest FROM accounts.tokens t JOIN accounts.users u ON u.id = t.user_id AND u.auth_version = t.auth_version WHERE t.digest = $1 AND t.purpose = 'email' AND t.expires_at > $2 AND u.verified_at IS NULL",
      [digest, now],
    );
    return rows.length === 1;
  }

  async verifyEmail(
    digest: string,
    disabledPasswordHash: string,
    grant: TokenGrant,
    previousDigests: readonly string[],
    now: Date,
  ): Promise<Player | null> {
    return this.db.transaction(async (tx) => {
      const user = await this.lockTokenAccount(tx, digest, 'email');
      if (
        !user ||
        user.verifiedAt ||
        !(await this.validToken(tx, digest, 'email', user, now))
      )
        return null;
      const updated = account(
        (
          await tx.query(
            'UPDATE accounts.users SET password_hash = $2, verified_at = $3, auth_version = auth_version + 1, updated_at = $3 WHERE id = $1 RETURNING id, email, password_hash, verified_at, auth_version',
            [user.id, disabledPasswordHash, now],
          )
        )[0],
      );
      if (!updated) throw new Error('Locked account is missing');
      await tx.query('DELETE FROM accounts.sessions WHERE user_id = $1', [
        user.id,
      ]);
      await tx.query('DELETE FROM accounts.tokens WHERE user_id = $1', [
        user.id,
      ]);
      await this.deleteSessions(tx, previousDigests);
      await this.insertSession(tx, updated, grant, 'recovery', now);
      return player(updated);
    });
  }

  async createSession(
    accountId: string,
    expectedVersion: number,
    grant: TokenGrant,
    previousDigests: readonly string[],
    now: Date,
  ): Promise<Player | null> {
    return this.db.transaction(async (tx) => {
      const user = await this.lockAccount(tx, accountId);
      if (!user || !user.verifiedAt || user.authVersion !== expectedVersion)
        return null;
      await this.deleteSessions(tx, previousDigests);
      await this.insertSession(tx, user, grant, 'access', now);
      await tx.query(
        "DELETE FROM accounts.sessions WHERE digest IN (SELECT digest FROM accounts.sessions WHERE user_id = $1 AND kind = 'access' AND digest <> $3 ORDER BY created_at DESC, digest DESC OFFSET $2)",
        [user.id, authPolicy.maximumSessions - 1, grant.digest],
      );
      return player(user);
    });
  }

  async beginRecovery(
    digest: string,
    grant: TokenGrant,
    previousDigests: readonly string[],
    now: Date,
  ): Promise<Player | null> {
    return this.db.transaction(async (tx) => {
      const user = await this.lockTokenAccount(tx, digest, 'recovery');
      if (
        !user ||
        !user.verifiedAt ||
        !(await this.validToken(tx, digest, 'recovery', user, now))
      )
        return null;
      await tx.query(
        "DELETE FROM accounts.tokens WHERE user_id = $1 AND purpose = 'recovery'",
        [user.id],
      );
      await tx.query(
        "DELETE FROM accounts.sessions WHERE user_id = $1 AND kind = 'recovery'",
        [user.id],
      );
      await this.deleteSessions(tx, previousDigests);
      await this.insertSession(tx, user, grant, 'recovery', now);
      return player(user);
    });
  }

  async getSession(
    digest: string,
    kind: SessionKind,
    now: Date,
  ): Promise<StoredSession | null> {
    const row = (
      await this.db.query(
        'SELECT s.digest, s.kind, s.expires_at, u.id, u.email, u.verified_at FROM accounts.sessions s JOIN accounts.users u ON u.id = s.user_id AND u.auth_version = s.auth_version WHERE s.digest = $1 AND s.kind = $2 AND s.expires_at > $3 AND u.verified_at IS NOT NULL',
        [digest, kind, now],
      )
    )[0];
    if (!row) return null;
    const value = sessionSchema.parse(row);
    return {
      digest: value.digest,
      kind: value.kind,
      expiresAt: value.expires_at,
      user: {
        id: value.id,
        email: value.email,
        emailConfirmed: value.verified_at !== null,
      },
    };
  }

  async resetPassword(
    recoveryDigest: string,
    passwordHash: string,
    session: TokenGrant,
    now: Date,
  ): Promise<Player | null> {
    return this.db.transaction(async (tx) => {
      const row = (
        await tx.query(
          "SELECT user_id FROM accounts.sessions WHERE digest = $1 AND kind = 'recovery'",
          [recoveryDigest],
        )
      )[0];
      if (!row) return null;
      const user = await this.lockAccount(tx, ownerSchema.parse(row).user_id);
      if (!user || !user.verifiedAt) return null;
      const valid = await tx.query(
        "SELECT digest FROM accounts.sessions WHERE digest = $1 AND user_id = $2 AND kind = 'recovery' AND expires_at > $3 AND auth_version = $4 FOR UPDATE",
        [recoveryDigest, user.id, now, user.authVersion],
      );
      if (!valid.length) return null;
      const updated = account(
        (
          await tx.query(
            'UPDATE accounts.users SET password_hash = $2, auth_version = auth_version + 1, updated_at = $3 WHERE id = $1 RETURNING id, email, password_hash, verified_at, auth_version',
            [user.id, passwordHash, now],
          )
        )[0],
      );
      if (!updated) throw new Error('Locked account is missing');
      await tx.query('DELETE FROM accounts.sessions WHERE user_id = $1', [
        user.id,
      ]);
      await tx.query('DELETE FROM accounts.tokens WHERE user_id = $1', [
        user.id,
      ]);
      await this.insertSession(tx, updated, session, 'access', now);
      return player(updated);
    });
  }

  async revoke(digests: readonly string[]): Promise<void> {
    await this.deleteSessions(this.db, digests);
  }
  async revokeAll(accountId: string, now: Date): Promise<void> {
    await this.db.transaction(async (tx) => {
      if (!(await this.lockAccount(tx, accountId))) return;
      await tx.query(
        'UPDATE accounts.users SET auth_version = auth_version + 1, updated_at = $2 WHERE id = $1',
        [accountId, now],
      );
      await tx.query('DELETE FROM accounts.sessions WHERE user_id = $1', [
        accountId,
      ]);
      await tx.query('DELETE FROM accounts.tokens WHERE user_id = $1', [
        accountId,
      ]);
    });
  }

  private async lockAccount(
    tx: SqlExecutor,
    id: string,
  ): Promise<Account | null> {
    return account(
      (
        await tx.query(
          'SELECT id, email, password_hash, verified_at, auth_version FROM accounts.users WHERE id = $1 FOR UPDATE',
          [id],
        )
      )[0],
    );
  }
  private async lockTokenAccount(
    tx: SqlExecutor,
    digest: string,
    purpose: TokenPurpose,
  ): Promise<Account | null> {
    const row = (
      await tx.query(
        'SELECT user_id FROM accounts.tokens WHERE digest = $1 AND purpose = $2',
        [digest, purpose],
      )
    )[0];
    return row ? this.lockAccount(tx, ownerSchema.parse(row).user_id) : null;
  }
  private async validToken(
    tx: SqlExecutor,
    digest: string,
    purpose: TokenPurpose,
    user: Account,
    now: Date,
  ): Promise<boolean> {
    return (
      (
        await tx.query(
          'SELECT digest FROM accounts.tokens WHERE digest = $1 AND purpose = $2 AND user_id = $3 AND auth_version = $4 AND expires_at > $5 FOR UPDATE',
          [digest, purpose, user.id, user.authVersion, now],
        )
      ).length === 1
    );
  }
  private async insertSession(
    tx: SqlExecutor,
    user: Account,
    grant: TokenGrant,
    kind: SessionKind,
    now: Date,
  ): Promise<void> {
    await tx.query(
      'INSERT INTO accounts.sessions(digest, user_id, kind, auth_version, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6)',
      [grant.digest, user.id, kind, user.authVersion, now, grant.expiresAt],
    );
  }
  private async deleteSessions(
    tx: SqlExecutor,
    digests: readonly string[],
  ): Promise<void> {
    if (digests.length)
      await tx.query(
        'DELETE FROM accounts.sessions WHERE digest = ANY($1::text[])',
        [digests],
      );
  }
  private async insertToken(
    tx: SqlExecutor,
    user: Account,
    purpose: TokenPurpose,
    grant: TokenGrant,
    now: Date,
  ): Promise<void> {
    const ciphertext = this.mailCipher.seal({
      to: user.email,
      token: grant.raw,
      purpose,
    });
    await tx.query(
      'INSERT INTO accounts.tokens(digest, user_id, purpose, auth_version, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6)',
      [grant.digest, user.id, purpose, user.authVersion, now, grant.expiresAt],
    );
    await tx.query(
      'INSERT INTO accounts.email_outbox(token_digest, ciphertext, available_at, expires_at) VALUES ($1, $2, $3, $4)',
      [grant.digest, ciphertext, now, grant.expiresAt],
    );
  }
}
