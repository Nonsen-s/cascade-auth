import type { FastifyRequest } from 'fastify';
import type { AccountService } from '../application/auth-service.js';
import type { RateLimiter } from '../application/ports.js';
import type { SecurityTokens } from '../infrastructure/security/tokens.js';
import type { SessionCookies } from './cookies.js';
import type { SessionGrant, StoredSession } from '../domain/models.js';
import type { SessionResponse } from '../../../shared/auth-contract.js';
import { AuthFailure } from '../domain/errors.js';

interface ContextDependencies {
  readonly accounts: AccountService;
  readonly limiter: RateLimiter;
  readonly tokens: SecurityTokens;
  readonly cookies: SessionCookies;
  readonly now: () => Date;
}
export function createAuthContext({
  accounts,
  limiter,
  tokens,
  cookies,
  now,
}: ContextDependencies) {
  async function accountLimit(
    request: FastifyRequest,
    email: string,
    kind: 'login' | 'mail' | 'register',
    purpose: 'email' | 'recovery' = 'email',
  ) {
    const limits = {
      login: { max: 15, window: 15 * 60_000 },
      register: { max: 5, window: 60 * 60_000 },
      mail: { max: 4, window: 60 * 60_000 },
    }[kind];
    await limiter.consume(
      tokens.privateKey(`${kind}:ip`, request.ip),
      kind === 'login' ? 30 : 15,
      kind === 'login' ? 5 * 60_000 : 60 * 60_000,
      now(),
    );
    await limiter.consume(
      tokens.privateKey(`${kind}:email`, email),
      limits.max,
      limits.window,
      now(),
    );
    if (kind !== 'login')
      await limiter.consume(
        tokens.privateKey(`${purpose}:mail-cooldown`, email),
        1,
        60_000,
        now(),
      );
  }
  async function current(
    request: FastifyRequest,
  ): Promise<{ session: StoredSession; raw: string } | null> {
    const recovery = cookies.recovery(request);
    if (recovery) {
      const session = await accounts.getSession(recovery, 'recovery');
      if (session) return { session, raw: recovery };
    }
    const access = cookies.access(request);
    if (access) {
      const session = await accounts.getSession(access, 'access');
      if (session) return { session, raw: access };
    }
    return null;
  }
  async function requireCsrf(
    request: FastifyRequest,
  ): Promise<{ session: StoredSession; raw: string }> {
    const value = await current(request);
    if (!value) throw new AuthFailure('sessionExpired');
    const header = request.headers['x-csrf-token'];
    if (typeof header !== 'string' || !tokens.matchesCsrf(value.raw, header))
      throw new AuthFailure('csrfRejected');
    return value;
  }
  function sessionResponse(grant: SessionGrant): SessionResponse {
    return {
      user: grant.user,
      recovery: grant.kind === 'recovery',
      csrfToken: tokens.csrf(grant.token.raw),
      expiresAt: grant.token.expiresAt.toISOString(),
    };
  }

  return { accountLimit, current, requireCsrf, sessionResponse };
}
