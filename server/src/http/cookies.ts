import type { FastifyReply, FastifyRequest } from 'fastify';
import type { SessionGrant } from '../domain/models.js';

export class SessionCookies {
  readonly accessName: string;
  readonly recoveryName: string;
  constructor(private readonly secure: boolean) {
    this.accessName = secure ? '__Host-cascade_session' : 'cascade_session';
    this.recoveryName = secure ? '__Host-cascade_recovery' : 'cascade_recovery';
  }
  access(request: FastifyRequest): string | null {
    return request.cookies[this.accessName] ?? null;
  }
  recovery(request: FastifyRequest): string | null {
    return request.cookies[this.recoveryName] ?? null;
  }
  all(request: FastifyRequest): string[] {
    return [this.access(request), this.recovery(request)].filter(
      (value): value is string => value !== null,
    );
  }
  set(reply: FastifyReply, grant: SessionGrant, now: Date): void {
    this.clear(reply);
    reply.setCookie(
      grant.kind === 'access' ? this.accessName : this.recoveryName,
      grant.token.raw,
      {
        path: '/',
        httpOnly: true,
        secure: this.secure,
        sameSite: 'lax',
        expires: grant.token.expiresAt,
        maxAge: Math.max(
          1,
          Math.floor((grant.token.expiresAt.getTime() - now.getTime()) / 1000),
        ),
      },
    );
  }
  clear(reply: FastifyReply): void {
    const options = {
      path: '/',
      httpOnly: true,
      secure: this.secure,
      sameSite: 'lax' as const,
    };
    reply.clearCookie(this.accessName, options);
    reply.clearCookie(this.recoveryName, options);
  }
}
