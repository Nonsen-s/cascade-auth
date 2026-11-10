import type { ActionResult } from '../../shared/errors';
import { AppError, toAppError } from '../../shared/errors';
import {
  parseEmail,
  parseNewPassword,
  parseRegistration,
  parseSignIn,
} from '../domain/credentials';
import type { PlayerIdentity } from '../domain/identity';
import type { AuthEvent, AuthGateway, AuthSession } from './auth-gateway';

export type AuthAction =
  'signIn' | 'signUp' | 'resend' | 'reset' | 'updatePassword' | 'signOut';
export interface AuthNotice {
  readonly kind:
    'confirmation' | 'reset' | 'passwordChanged' | 'signedOut' | 'expired';
  readonly message: string;
}

export interface AuthState {
  readonly status: 'initializing' | 'anonymous' | 'authenticated';
  readonly user: PlayerIdentity | null;
  readonly recovery: boolean;
  readonly pending: AuthAction | null;
  readonly error: AppError | null;
  readonly notice: AuthNotice | null;
  readonly emailRetryAt: number;
}

export const initialAuthState: AuthState = Object.freeze({
  status: 'initializing',
  user: null,
  recovery: false,
  pending: null,
  error: null,
  notice: null,
  emailRetryAt: 0,
});

const EMAIL_COOLDOWN_MS = 60_000;

/** Coordinates a single session. The gateway owns all provider-specific behavior. */
export class AuthService {
  private state = initialAuthState;
  private readonly listeners = new Set<() => void>();
  private unsubscribe: (() => void) | null = null;
  private initialization: Promise<void> | null = null;
  private sessionRevision = 0;
  private restoring = false;
  private bufferedEvent: AuthEvent | null = null;
  private disposed = false;

  constructor(
    private readonly gateway: AuthGateway,
    private readonly now: () => number = Date.now,
  ) {}

  getSnapshot = (): AuthState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getPlayer(): PlayerIdentity | null {
    return this.state.recovery ? null : this.state.user;
  }

  start(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.initialization) return this.initialization;
    this.unsubscribe ??= this.gateway.subscribe((event) =>
      this.onAuthEvent(event),
    );
    this.initialization = this.restore();
    return this.initialization;
  }

  async retryInitialization(): Promise<void> {
    if (this.state.pending || this.state.status === 'initializing') return;
    this.initialization = null;
    await this.start();
  }

  signIn(input: unknown): Promise<ActionResult> {
    return this.execute('signIn', async (revision) => {
      const user = await this.gateway.signIn(parseSignIn(input));
      this.applyOperationSession(revision, { user, recovery: false });
    });
  }

  signUp(input: unknown): Promise<ActionResult> {
    return this.execute('signUp', async (revision) => {
      this.checkEmailCooldown();
      const user = await this.gateway.signUp(parseRegistration(input));
      if (user) this.applyOperationSession(revision, { user, recovery: false });
      this.setState({
        emailRetryAt: this.now() + EMAIL_COOLDOWN_MS,
        notice: {
          kind: 'confirmation',
          message:
            'Проверьте почту. Если адрес можно зарегистрировать, вы получите письмо со ссылкой для подтверждения.',
        },
      });
    });
  }

  resendConfirmation(email: unknown): Promise<ActionResult> {
    return this.execute('resend', async () => {
      this.checkEmailCooldown();
      await this.gateway.resendConfirmation(parseEmail(email));
      this.setState({
        emailRetryAt: this.now() + EMAIL_COOLDOWN_MS,
        notice: {
          kind: 'confirmation',
          message:
            'Если почта ожидает подтверждения, новое письмо уже отправлено. Проверьте также папку «Спам».',
        },
      });
    });
  }

  requestPasswordReset(email: unknown): Promise<ActionResult> {
    return this.execute('reset', async () => {
      this.checkEmailCooldown();
      await this.gateway.requestPasswordReset(parseEmail(email));
      this.setState({
        emailRetryAt: this.now() + EMAIL_COOLDOWN_MS,
        notice: {
          kind: 'reset',
          message:
            'Если аккаунт с такой почтой существует, вы получите письмо для восстановления доступа.',
        },
      });
    });
  }

  updatePassword(input: unknown): Promise<ActionResult> {
    return this.execute('updatePassword', async (revision) => {
      if (!this.state.user || !this.state.recovery)
        throw new AppError('invalidLink');
      const user = await this.gateway.updatePassword(parseNewPassword(input));
      this.applyOperationSession(revision, { user, recovery: false });
      this.setState({
        notice: {
          kind: 'passwordChanged',
          message: 'Пароль изменён. Теперь используйте его для входа.',
        },
      });
    });
  }

  signOut(): Promise<ActionResult> {
    return this.execute('signOut', async (revision) => {
      await this.gateway.signOut();
      this.applyOperationSession(revision, { user: null, recovery: false });
      this.setState({
        notice: {
          kind: 'signedOut',
          message: 'Вы вышли из аккаунта на этом устройстве.',
        },
      });
    });
  }

  clearFeedback(): void {
    if (!this.state.pending) this.setState({ error: null, notice: null });
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe?.();
    this.gateway.dispose();
    this.listeners.clear();
  }

  private async restore(): Promise<void> {
    this.restoring = true;
    this.bufferedEvent = null;
    this.setState({ status: 'initializing', error: null });
    try {
      const session = await this.gateway.initialize();
      if (this.disposed) return;
      const latest = this.getBufferedEvent();
      if (latest?.type === 'signedOut')
        this.applySession({ user: null, recovery: false });
      else if (latest?.type === 'error')
        this.setState({
          status: 'anonymous',
          user: null,
          recovery: false,
          error: latest.error,
        });
      else if (
        latest?.type === 'session' &&
        latest.session.user?.id !== session.user?.id
      )
        this.applySession(latest.session);
      else this.applySession(session);
    } catch (error) {
      if (!this.disposed) {
        const latest = this.getBufferedEvent();
        if (latest?.type === 'session' && latest.session.user)
          this.applySession(latest.session);
        else {
          this.setState({
            status: 'anonymous',
            user: null,
            recovery: false,
            error: toAppError(error),
          });
        }
      }
    } finally {
      this.restoring = false;
      this.bufferedEvent = null;
    }
  }

  private async execute(
    action: AuthAction,
    operation: (revision: number) => Promise<void>,
  ): Promise<ActionResult> {
    if (this.disposed) return { ok: false, error: new AppError('cancelled') };
    if (this.state.pending || this.state.status === 'initializing') {
      return { ok: false, error: new AppError('busy') };
    }
    const revision = this.sessionRevision;
    this.setState({ pending: action, error: null, notice: null });
    try {
      await operation(revision);
      return { ok: true };
    } catch (error) {
      let safeError = toAppError(error);
      if (
        safeError.code === 'sessionExpired' &&
        revision !== this.sessionRevision &&
        this.state.user
      ) {
        safeError = new AppError('cancelled');
      }
      if (safeError.code === 'sessionExpired')
        this.applySession({ user: null, recovery: false });
      this.setState({ error: safeError });
      return { ok: false, error: safeError };
    } finally {
      this.setState({ pending: null });
    }
  }

  private applyOperationSession(revision: number, session: AuthSession): void {
    // A response from an older action must not replace a newer cross-tab session.
    if (
      this.disposed ||
      (revision !== this.sessionRevision &&
        this.state.user?.id !== session.user?.id)
    ) {
      throw new AppError('cancelled');
    }
    this.applySession(session);
  }

  private checkEmailCooldown(): void {
    if (this.now() < this.state.emailRetryAt) throw new AppError('rateLimited');
  }

  private onAuthEvent(event: AuthEvent): void {
    if (this.disposed) return;
    this.sessionRevision += 1;
    if (this.restoring) {
      this.bufferedEvent = event;
      return;
    }
    if (event.type === 'error') {
      if (event.error.code === 'network' && this.state.user) {
        this.setState({ error: event.error });
        return;
      }
      this.setState({
        status: 'anonymous',
        user: null,
        recovery: false,
        error: event.error,
      });
    } else if (event.type === 'signedOut') {
      const expired =
        Boolean(this.state.user) && this.state.pending !== 'signOut';
      this.applySession({ user: null, recovery: false });
      if (expired)
        this.setState({
          notice: {
            kind: 'expired',
            message: 'Сессия закончилась. Войдите в аккаунт ещё раз.',
          },
        });
    } else {
      this.applySession(event.session);
      if (this.state.error?.code === 'network') this.setState({ error: null });
    }
  }

  private applySession(session: AuthSession): void {
    this.setState({
      status: session.user ? 'authenticated' : 'anonymous',
      user: session.user,
      recovery: Boolean(session.user) && session.recovery,
    });
    if (session.emailVerified)
      this.setState({
        notice: {
          kind: 'confirmation',
          message:
            'Почта подтверждена. Установите пароль, чтобы завершить регистрацию.',
        },
      });
  }

  private getBufferedEvent(): AuthEvent | null {
    return this.bufferedEvent;
  }

  private setState(patch: Partial<AuthState>): void {
    if (this.disposed) return;
    this.state = Object.freeze({ ...this.state, ...patch });
    this.listeners.forEach((listener) => listener());
  }
}
