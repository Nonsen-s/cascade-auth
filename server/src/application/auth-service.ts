import { z } from 'zod';
import {
  emailInputSchema,
  loginInputSchema,
  registerInputSchema,
  resetPasswordInputSchema,
  tokenInputSchema,
} from '../../../shared/auth-contract.js';
import type { AuthRepository, PasswordHasher, TokenIssuer } from './ports.js';
import { AuthFailure } from '../domain/errors.js';
import {
  authPolicy,
  type SessionGrant,
  type SessionKind,
  type StoredSession,
  type TokenGrant,
} from '../domain/models.js';

export function validate<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path[0];
    if (typeof key === 'string' && fields[key] === undefined)
      fields[key] = issue.message;
  }
  throw new AuthFailure('validation', fields);
}

export class AccountService {
  constructor(
    private readonly accounts: AuthRepository,
    private readonly passwords: PasswordHasher,
    private readonly tokens: TokenIssuer,
    private readonly now: () => Date,
  ) {}

  async register(input: unknown): Promise<void> {
    const { email, password } = validate(registerInputSchema, input);
    // Hash duplicates too: response shape and expensive work must not reveal account existence.
    const hash = await this.passwords.hash(password);
    const now = this.now();
    await this.accounts.createAccount(
      email,
      hash,
      this.grant(authPolicy.verificationLifetimeMs, now),
      now,
    );
  }

  async login(
    input: unknown,
    previousTokens: readonly string[] = [],
  ): Promise<SessionGrant> {
    const { email, password } = validate(loginInputSchema, input);
    const account = await this.accounts.findAccount(email);
    const validPassword = await this.passwords.verify(
      password,
      account?.passwordHash ?? null,
    );
    if (!account || !validPassword) throw new AuthFailure('invalidCredentials');
    if (!account.verifiedAt) throw new AuthFailure('emailUnconfirmed');
    const now = this.now();
    const token = this.grant(authPolicy.sessionLifetimeMs, now);
    const user = await this.accounts.createSession(
      account.id,
      account.authVersion,
      token,
      previousTokens.map((raw) => this.tokens.digest(raw)),
      now,
    );
    // A password reset may have committed while Argon2 was checking the old hash.
    if (!user) throw new AuthFailure('invalidCredentials');
    return { token, user, kind: 'access' };
  }

  async resend(input: unknown): Promise<void> {
    const { email } = validate(emailInputSchema, input);
    const now = this.now();
    await this.accounts.queueToken(
      email,
      'email',
      this.grant(authPolicy.verificationLifetimeMs, now),
      now,
    );
  }

  async forgotPassword(input: unknown): Promise<void> {
    const { email } = validate(emailInputSchema, input);
    const now = this.now();
    await this.accounts.queueToken(
      email,
      'recovery',
      this.grant(authPolicy.resetLinkLifetimeMs, now),
      now,
    );
  }

  async verifyEmail(
    input: unknown,
    previousTokens: readonly string[] = [],
  ): Promise<SessionGrant> {
    const { token } = this.readLink(input);
    const digest = this.tokens.digest(token);
    // Reject guessed/expired capabilities before Argon2; the transaction below
    // revalidates the proof under the account lock before changing any state.
    if (!(await this.accounts.canVerifyEmail(digest, this.now())))
      throw new AuthFailure('invalidLink');
    // Discard the pre-verification credential. This independent secret is never
    // returned, so neither the email token nor the setup cookie is a password.
    const disabledPasswordHash = await this.passwords.hash(
      this.tokens.issue().raw,
    );
    const now = this.now();
    const grant = this.grant(authPolicy.recoverySessionLifetimeMs, now);
    const user = await this.accounts.verifyEmail(
      digest,
      disabledPasswordHash,
      grant,
      previousTokens.map((raw) => this.tokens.digest(raw)),
      now,
    );
    if (!user) throw new AuthFailure('invalidLink');
    return { token: grant, user, kind: 'recovery' };
  }

  async beginRecovery(
    input: unknown,
    previousTokens: readonly string[] = [],
  ): Promise<SessionGrant> {
    const { token: raw } = this.readLink(input);
    const now = this.now();
    const token = this.grant(authPolicy.recoverySessionLifetimeMs, now);
    const user = await this.accounts.beginRecovery(
      this.tokens.digest(raw),
      token,
      previousTokens.map((value) => this.tokens.digest(value)),
      now,
    );
    if (!user) throw new AuthFailure('invalidLink');
    return { token, user, kind: 'recovery' };
  }

  async resetPassword(
    recoveryToken: string | null,
    input: unknown,
  ): Promise<SessionGrant> {
    const { password } = validate(resetPasswordInputSchema, input);
    if (!recoveryToken || !(await this.getSession(recoveryToken, 'recovery')))
      throw new AuthFailure('sessionExpired');
    const passwordHash = await this.passwords.hash(password);
    const now = this.now();
    const token = this.grant(authPolicy.sessionLifetimeMs, now);
    const user = await this.accounts.resetPassword(
      this.tokens.digest(recoveryToken),
      passwordHash,
      token,
      now,
    );
    if (!user) throw new AuthFailure('sessionExpired');
    return { token, user, kind: 'access' };
  }

  getSession(
    raw: string | null,
    kind: SessionKind,
  ): Promise<StoredSession | null> {
    if (!raw || !/^[A-Za-z0-9_-]{43}$/.test(raw)) return Promise.resolve(null);
    return this.accounts.getSession(this.tokens.digest(raw), kind, this.now());
  }

  async logout(tokens: readonly string[]): Promise<void> {
    await this.accounts.revoke(tokens.map((raw) => this.tokens.digest(raw)));
  }

  async logoutAll(raw: string | null): Promise<void> {
    const session = await this.getSession(raw, 'access');
    if (!session) throw new AuthFailure('sessionExpired');
    await this.accounts.revokeAll(session.user.id, this.now());
  }

  private grant(lifetime: number, now: Date): TokenGrant {
    return {
      ...this.tokens.issue(),
      expiresAt: new Date(now.getTime() + lifetime),
    };
  }

  private readLink(input: unknown): { token: string } {
    const result = tokenInputSchema.safeParse(input);
    if (!result.success) throw new AuthFailure('invalidLink');
    return result.data;
  }
}
