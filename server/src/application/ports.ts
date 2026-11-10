import type {
  Account,
  MailContent,
  SessionKind,
  StoredSession,
  TokenGrant,
  TokenPurpose,
  IssuedToken,
} from '../domain/models.js';
import type { Player } from '../../../shared/auth-contract.js';

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, hash: string | null): Promise<boolean>;
}

export interface TokenIssuer {
  issue(): IssuedToken;
  digest(raw: string): string;
}

/** Each state-changing method is one database transaction, including its email job. */
export interface AuthRepository {
  findAccount(email: string): Promise<Account | null>;
  createAccount(
    email: string,
    passwordHash: string,
    verification: TokenGrant,
    now: Date,
  ): Promise<void>;
  queueToken(
    email: string,
    purpose: TokenPurpose,
    grant: TokenGrant,
    now: Date,
  ): Promise<void>;
  canVerifyEmail(digest: string, now: Date): Promise<boolean>;
  verifyEmail(
    digest: string,
    disabledPasswordHash: string,
    grant: TokenGrant,
    previousDigests: readonly string[],
    now: Date,
  ): Promise<Player | null>;
  createSession(
    accountId: string,
    expectedVersion: number,
    grant: TokenGrant,
    previousDigests: readonly string[],
    now: Date,
  ): Promise<Player | null>;
  beginRecovery(
    digest: string,
    grant: TokenGrant,
    previousDigests: readonly string[],
    now: Date,
  ): Promise<Player | null>;
  getSession(
    digest: string,
    kind: SessionKind,
    now: Date,
  ): Promise<StoredSession | null>;
  resetPassword(
    recoveryDigest: string,
    passwordHash: string,
    session: TokenGrant,
    now: Date,
  ): Promise<Player | null>;
  revoke(digests: readonly string[]): Promise<void>;
  revokeAll(accountId: string, now: Date): Promise<void>;
}

export interface MailCipher {
  seal(message: MailContent): string;
  open(ciphertext: string): MailContent;
}

export interface MailSender {
  send(jobId: string, content: MailContent): Promise<void>;
  close(): void;
}

export interface OutboxJob {
  readonly id: string;
  readonly ciphertext: string;
  readonly attempts: number;
}

export interface OutboxRepository {
  claim(owner: string, now: Date): Promise<OutboxJob | null>;
  delivered(id: string, owner: string): Promise<void>;
  failed(
    id: string,
    owner: string,
    retryAt: Date,
    permanent: boolean,
  ): Promise<void>;
  cleanup(now: Date): Promise<void>;
}

export interface RateLimiter {
  consume(
    key: string,
    limit: number,
    windowMs: number,
    now: Date,
  ): Promise<void>;
}
