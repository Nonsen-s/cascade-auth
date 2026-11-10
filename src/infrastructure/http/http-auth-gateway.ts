import { z } from 'zod';
import {
  acceptedResponseSchema,
  anonymousSession,
  apiErrorSchema,
  sessionResponseSchema,
  type SessionResponse,
} from '../../../shared/auth-contract';
import type {
  AuthEvent,
  AuthGateway,
  AuthSession,
} from '../../auth/application/auth-gateway';
import type { Credentials } from '../../auth/domain/credentials';
import type { PlayerIdentity } from '../../auth/domain/identity';
import {
  AppError,
  errorMessages,
  toAppError,
  type ErrorCode,
} from '../../shared/errors';
import { readAuthCallback } from './auth-callback';

export interface CallbackLocation {
  getUrl(): URL;
  replaceUrl(path: string): void;
}
const isErrorCode = (value: unknown): value is ErrorCode =>
  typeof value === 'string' && Object.hasOwn(errorMessages, value);
const errorCodeSchema = z.custom<ErrorCode>(isErrorCode);
const fieldsSchema = z.object({
  email: z.string().optional(),
  password: z.string().optional(),
  confirmPassword: z.string().optional(),
});

/** Cookie credentials stay in the browser; neither tokens nor passwords enter web storage. */
export class HttpAuthGateway implements AuthGateway {
  private session: SessionResponse = anonymousSession;
  private readonly listeners = new Set<(event: AuthEvent) => void>();
  private readonly requests = new Set<AbortController>();
  private readonly channel: BroadcastChannel | null;
  private readonly timer: ReturnType<typeof setInterval>;
  private revision = 0;
  private writes = 0;
  private initialized = false;
  private disposed = false;
  private refreshing: Promise<void> | null = null;
  private readonly refreshOnFocus = () => {
    this.checkSession();
  };

  constructor(
    private readonly baseUrl: string,
    private readonly location: CallbackLocation,
    private readonly fetcher: typeof fetch,
    private readonly locks: LockManager | null,
  ) {
    this.channel =
      typeof BroadcastChannel === 'function'
        ? new BroadcastChannel('cascade-account-session')
        : null;
    if (this.channel) this.channel.onmessage = () => this.checkSession();
    window.addEventListener('focus', this.refreshOnFocus);
    this.timer = setInterval(() => {
      if (this.session.user) this.checkSession();
    }, 30_000);
  }

  async initialize(): Promise<AuthSession> {
    const { callback, cleanUrl } = readAuthCallback(this.location.getUrl());
    if (callback.kind !== 'none') this.location.replaceUrl(cleanUrl);
    if (callback.kind === 'invalid') throw new AppError('invalidLink');
    if (callback.kind === 'token') {
      return this.write(async () => {
        if (callback.type === 'email') {
          acceptedResponseSchema.parse(
            await this.call('POST', '/verify-email', { token: callback.token }),
          );
          this.session = sessionResponseSchema.parse(
            await this.call('GET', '/session'),
          );
        } else
          this.session = sessionResponseSchema.parse(
            await this.call('POST', '/recovery', { token: callback.token }),
          );
        this.initialized = true;
        this.channel?.postMessage('changed');
        return {
          user: this.session.user,
          recovery: this.session.recovery,
          ...(callback.type === 'email' ? { emailVerified: true } : {}),
        };
      });
    }
    this.session = sessionResponseSchema.parse(
      await this.call('GET', '/session'),
    );
    this.initialized = true;
    return { user: this.session.user, recovery: this.session.recovery };
  }

  subscribe(listener: (event: AuthEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  signIn(credentials: Credentials): Promise<PlayerIdentity> {
    return this.write(async () => {
      const session = sessionResponseSchema.parse(
        await this.call('POST', '/login', credentials),
      );
      if (!session.user || session.recovery)
        throw new AppError('invalidResponse');
      this.publish(session);
      return session.user;
    });
  }
  async signUp(credentials: Credentials): Promise<PlayerIdentity | null> {
    acceptedResponseSchema.parse(
      await this.call('POST', '/register', credentials),
    );
    return null;
  }
  async resendConfirmation(email: string): Promise<void> {
    acceptedResponseSchema.parse(
      await this.call('POST', '/resend-confirmation', { email }),
    );
  }
  async requestPasswordReset(email: string): Promise<void> {
    acceptedResponseSchema.parse(
      await this.call('POST', '/forgot-password', { email }),
    );
  }
  updatePassword(password: string): Promise<PlayerIdentity> {
    return this.write(async () => {
      const session = sessionResponseSchema.parse(
        await this.call('POST', '/reset-password', { password }),
      );
      if (!session.user || session.recovery)
        throw new AppError('invalidResponse');
      this.publish(session);
      return session.user;
    });
  }
  signOut(): Promise<void> {
    return this.write(async () => {
      await this.call('POST', '/logout', {});
      this.publish(anonymousSession);
    });
  }
  dispose(): void {
    this.disposed = true;
    clearInterval(this.timer);
    window.removeEventListener('focus', this.refreshOnFocus);
    this.channel?.close();
    this.requests.forEach((request) => request.abort());
    this.listeners.clear();
  }

  private async call(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    const controller = new AbortController();
    this.requests.add(controller);
    try {
      const response = await this.fetcher(`${this.baseUrl}/auth${path}`, {
        method,
        credentials: 'include',
        cache: 'no-store',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          ...(this.session.csrfToken
            ? { 'x-csrf-token': this.session.csrfToken }
            : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (response.status === 204) return null;
      let value: unknown;
      try {
        value = await response.json();
      } catch {
        throw new AppError(response.ok ? 'invalidResponse' : 'network');
      }
      if (!response.ok) {
        const error = apiErrorSchema.safeParse(value);
        if (!error.success) throw new AppError('invalidResponse');
        const code = errorCodeSchema.safeParse(error.data.error.code);
        const fields = fieldsSchema.parse(error.data.error.fields);
        throw new AppError(code.success ? code.data : 'unexpected', {
          ...(fields.email === undefined ? {} : { email: fields.email }),
          ...(fields.password === undefined
            ? {}
            : { password: fields.password }),
          ...(fields.confirmPassword === undefined
            ? {}
            : { confirmPassword: fields.confirmPassword }),
        });
      }
      return value;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(this.disposed ? 'cancelled' : 'network');
    } finally {
      this.requests.delete(controller);
    }
  }
  private async write<T>(operation: () => Promise<T>): Promise<T> {
    this.writes += 1;
    this.revision += 1;
    try {
      return this.locks
        ? await this.locks.request('cascade-account-session', operation)
        : await operation();
    } finally {
      this.writes -= 1;
    }
  }
  private publish(session: SessionResponse): void {
    this.session = session;
    this.initialized = true;
    this.listeners.forEach((listener) =>
      listener(
        session.user
          ? {
              type: 'session',
              session: { user: session.user, recovery: session.recovery },
            }
          : { type: 'signedOut' },
      ),
    );
    this.channel?.postMessage('changed');
  }
  private checkSession(): void {
    if (
      !this.initialized ||
      this.disposed ||
      this.writes ||
      document.visibilityState === 'hidden' ||
      this.refreshing
    )
      return;
    const revision = this.revision;
    this.refreshing = this.call('GET', '/session')
      .then((value) => {
        if (this.disposed || this.revision !== revision) return;
        const session = sessionResponseSchema.parse(value);
        this.session = session;
        this.listeners.forEach((listener) =>
          listener(
            session.user
              ? {
                  type: 'session',
                  session: { user: session.user, recovery: session.recovery },
                }
              : { type: 'signedOut' },
          ),
        );
      })
      .catch((error: unknown) => {
        if (!this.disposed && this.revision === revision)
          this.listeners.forEach((listener) =>
            listener({ type: 'error', error: toAppError(error) }),
          );
      })
      .finally(() => {
        this.refreshing = null;
      });
  }
}
