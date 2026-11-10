import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import {
  ArrowLeft,
  Check,
  KeyRound,
  LogOut,
  Mail,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import type { AuthService, AuthState } from '../auth';
import type { AppError } from '../shared/errors';
import { Feedback } from './components/feedback';
import { PasswordField } from './components/password-field';
import { SubmitButton } from './components/submit-button';
import { useAuth } from './use-auth';
import { useCooldown } from './use-cooldown';

type Screen = 'signIn' | 'signUp' | 'reset' | 'confirmation';

interface AuthPanelProps {
  readonly auth: AuthService | null;
  readonly configurationError: AppError | null;
}

export function AuthPanel({ auth, configurationError }: AuthPanelProps) {
  const state = useAuth(auth);
  if (state.status === 'initializing')
    return (
      <section className="auth-card loading-card" aria-busy="true">
        <div className="loading-mark" />
        <h2>Проверяем сессию</h2>
        <p>Это займёт всего несколько секунд.</p>
      </section>
    );
  if (state.user && state.recovery && auth)
    return <NewPasswordForm auth={auth} state={state} />;
  if (state.user && auth) return <SignedInAccount auth={auth} state={state} />;
  return (
    <EntryForm
      auth={auth}
      state={state}
      configurationError={configurationError}
    />
  );
}

function EntryForm({
  auth,
  state,
  configurationError,
}: AuthPanelProps & { readonly state: AuthState }) {
  const [screen, setScreen] = useState<Screen>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const seconds = useCooldown(state.emailRetryAt);
  const busy = state.pending !== null;
  const fields = state.error?.fields ?? {};

  useEffect(() => {
    if (state.error?.code === 'validation') {
      form.current
        ?.querySelector<HTMLInputElement>('[aria-invalid="true"]')
        ?.focus();
    }
  }, [state.error]);

  useEffect(() => {
    if (state.notice?.kind === 'signedOut' || state.notice?.kind === 'expired')
      heading.current?.focus();
  }, [state.notice]);

  function navigate(next: Screen) {
    if (busy) return;
    auth?.clearFeedback();
    setScreen(next);
    setPassword('');
    setConfirmation('');
    // Focus after React has committed the new screen.
    requestAnimationFrame(() => heading.current?.focus());
  }

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth || busy) return;
    if (screen === 'signIn') {
      const result = await auth.signIn({ email, password });
      if (result.ok) setPassword('');
    } else if (screen === 'signUp') {
      const result = await auth.signUp({
        email,
        password,
        confirmPassword: confirmation,
      });
      if (result.ok) {
        setPassword('');
        setConfirmation('');
        setScreen('confirmation');
        requestAnimationFrame(() => heading.current?.focus());
      }
    } else if (screen === 'reset') {
      await auth.requestPasswordReset(email);
    } else {
      await auth.resendConfirmation(email);
    }
  }

  const title = {
    signIn: 'С возвращением',
    signUp: 'Начнём знакомство',
    reset: 'Забыли пароль?',
    confirmation: 'Проверьте почту',
  }[screen];
  const subtitle = {
    signIn: 'Войдите, чтобы всё было на своих местах.',
    signUp: 'Создайте аккаунт с помощью вашей почты.',
    reset: 'Отправим ссылку, по которой можно задать новый пароль.',
    confirmation:
      'Откройте письмо, подтвердите адрес и установите пароль, чтобы завершить регистрацию.',
  }[screen];

  return (
    <section className="auth-card" aria-labelledby="auth-title">
      {screen === 'signIn' || screen === 'signUp' ? (
        <div className="auth-switch" aria-label="Вход или регистрация">
          <button
            type="button"
            aria-pressed={screen === 'signIn'}
            onClick={() => navigate('signIn')}
            disabled={busy}
          >
            Вход
          </button>
          <button
            type="button"
            aria-pressed={screen === 'signUp'}
            onClick={() => navigate('signUp')}
            disabled={busy}
          >
            Регистрация
          </button>
        </div>
      ) : (
        <button
          className="back-link"
          type="button"
          onClick={() => navigate('signIn')}
          disabled={busy}
        >
          <ArrowLeft size={16} aria-hidden="true" /> К входу
        </button>
      )}

      {(screen === 'confirmation' || screen === 'reset') && (
        <div className="form-symbol">
          {screen === 'confirmation' ? (
            <Mail size={25} aria-hidden="true" />
          ) : (
            <KeyRound size={25} aria-hidden="true" />
          )}
        </div>
      )}
      <h2 id="auth-title" ref={heading} tabIndex={-1}>
        {title}
      </h2>
      <p className="form-description">{subtitle}</p>

      {configurationError && (
        <div className="feedback feedback-info" role="status">
          <ShieldCheck size={19} aria-hidden="true" />
          <p>{configurationError.message}</p>
        </div>
      )}
      <Feedback error={state.error} notice={state.notice} />

      <form
        ref={form}
        onSubmit={(event) => {
          void submit(event);
        }}
        noValidate
        aria-busy={busy}
      >
        {screen === 'confirmation' ? (
          <div className="confirmation-address">
            <Mail size={18} aria-hidden="true" />
            <span>{email.trim()}</span>
          </div>
        ) : (
          <div className="field">
            <label htmlFor="email">Электронная почта</label>
            <input
              id="email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete={screen === 'reset' ? 'email' : 'username'}
              autoCapitalize="none"
              spellCheck={false}
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={busy}
              aria-invalid={Boolean(fields.email)}
              aria-describedby={fields.email ? 'email-error' : undefined}
              required
            />
            {fields.email && (
              <p className="field-error" id="email-error">
                {fields.email}
              </p>
            )}
          </div>
        )}

        {(screen === 'signIn' || screen === 'signUp') && (
          <PasswordField
            key={screen}
            id="password"
            name="password"
            label="Пароль"
            value={password}
            onChange={setPassword}
            autoComplete={
              screen === 'signIn' ? 'current-password' : 'new-password'
            }
            disabled={busy}
            error={fields.password}
            {...(screen === 'signUp'
              ? { hint: 'Не менее 12 символов. Можно использовать пробелы.' }
              : {})}
          />
        )}
        {screen === 'signUp' && (
          <PasswordField
            id="confirm-password"
            name="confirmPassword"
            label="Повторите пароль"
            value={confirmation}
            onChange={setConfirmation}
            autoComplete="new-password"
            disabled={busy}
            error={fields.confirmPassword}
          />
        )}

        {screen === 'signIn' && (
          <div className="forgot-row">
            <button
              className="text-button"
              type="button"
              onClick={() => navigate('reset')}
              disabled={busy}
            >
              Забыли пароль?
            </button>
          </div>
        )}

        {screen === 'signIn' && (
          <SubmitButton
            busy={busy}
            disabled={busy || !auth}
            busyLabel="Входим…"
          >
            Войти в аккаунт
          </SubmitButton>
        )}
        {screen === 'signUp' && (
          <SubmitButton
            busy={busy}
            disabled={busy || !auth || seconds > 0}
            busyLabel="Создаём аккаунт…"
          >
            {seconds > 0 ? `Повторить через ${seconds} с` : 'Создать аккаунт'}
          </SubmitButton>
        )}
        {screen === 'reset' && (
          <SubmitButton
            busy={busy}
            disabled={busy || !auth || seconds > 0}
            busyLabel="Отправляем письмо…"
          >
            {seconds > 0 ? `Повторить через ${seconds} с` : 'Отправить ссылку'}
          </SubmitButton>
        )}
        {screen === 'confirmation' && (
          <SubmitButton
            busy={busy}
            disabled={busy || !auth || seconds > 0}
            busyLabel="Отправляем письмо…"
          >
            {seconds > 0
              ? `Отправить снова через ${seconds} с`
              : 'Отправить письмо повторно'}
          </SubmitButton>
        )}
      </form>

      {state.error?.code === 'emailUnconfirmed' && screen === 'signIn' && (
        <button
          className="text-button resend-link"
          type="button"
          disabled={busy || seconds > 0}
          onClick={() => {
            if (auth) void auth.resendConfirmation(email);
          }}
        >
          {seconds > 0
            ? `Повторить через ${seconds} с`
            : 'Отправить подтверждение повторно'}
        </button>
      )}
      {(state.error?.code === 'network' ||
        state.error?.code === 'sessionExpired') &&
        auth && (
          <button
            className="text-button resend-link"
            type="button"
            disabled={busy}
            onClick={() => {
              void auth.retryInitialization();
            }}
          >
            Проверить сессию ещё раз
          </button>
        )}
      {screen === 'signIn' && (
        <p className="form-bottom">
          Впервые здесь?{' '}
          <button
            className="text-button"
            type="button"
            onClick={() => navigate('signUp')}
            disabled={busy}
          >
            Создайте аккаунт
          </button>
        </p>
      )}
      {screen === 'signUp' && (
        <p className="form-bottom">
          Уже есть аккаунт?{' '}
          <button
            className="text-button"
            type="button"
            onClick={() => navigate('signIn')}
            disabled={busy}
          >
            Войдите
          </button>
        </p>
      )}
      {screen === 'confirmation' && (
        <p className="form-bottom">
          Не та почта?{' '}
          <button
            className="text-button"
            type="button"
            onClick={() => navigate('signUp')}
            disabled={busy}
          >
            Изменить адрес
          </button>
        </p>
      )}
      <div className="card-footer">
        <ShieldCheck size={16} aria-hidden="true" />
        <span>Ваш пароль защищён. Доступ — только у вас.</span>
      </div>
    </section>
  );
}

function NewPasswordForm({
  auth,
  state,
}: {
  readonly auth: AuthService;
  readonly state: AuthState;
}) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const busy = state.pending !== null;
  const fields = state.error?.fields ?? {};

  useEffect(() => {
    heading.current?.focus();
  }, []);

  useEffect(() => {
    if (state.error?.code === 'validation')
      form.current
        ?.querySelector<HTMLInputElement>('[aria-invalid="true"]')
        ?.focus();
  }, [state.error]);

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await auth.updatePassword({
      password,
      confirmPassword: confirmation,
    });
    if (result.ok) {
      setPassword('');
      setConfirmation('');
    }
  }

  return (
    <section className="auth-card" aria-labelledby="new-password-title">
      <div className="form-symbol">
        <KeyRound size={25} aria-hidden="true" />
      </div>
      <h2 id="new-password-title" ref={heading} tabIndex={-1}>
        Новый пароль
      </h2>
      <p className="form-description">
        Придумайте новый пароль для {state.user?.email}.
      </p>
      <Feedback error={state.error} notice={state.notice} />
      <form
        ref={form}
        onSubmit={(event) => {
          void submit(event);
        }}
        noValidate
        aria-busy={busy}
      >
        <input
          className="visually-hidden"
          type="text"
          name="username"
          autoComplete="username"
          value={state.user?.email ?? ''}
          readOnly
          tabIndex={-1}
          aria-hidden="true"
        />
        <PasswordField
          id="new-password"
          name="password"
          label="Новый пароль"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          disabled={busy}
          error={fields.password}
          hint="Не менее 12 символов. Можно использовать пробелы."
        />
        <PasswordField
          id="confirm-new-password"
          name="confirmPassword"
          label="Повторите пароль"
          value={confirmation}
          onChange={setConfirmation}
          autoComplete="new-password"
          disabled={busy}
          error={fields.confirmPassword}
        />
        <SubmitButton busy={busy} disabled={busy} busyLabel="Сохраняем пароль…">
          Сохранить новый пароль
        </SubmitButton>
      </form>
      <button
        className="text-button form-bottom"
        type="button"
        disabled={busy}
        onClick={() => {
          void auth.signOut();
        }}
      >
        Выйти и вернуться к входу
      </button>
    </section>
  );
}

function SignedInAccount({
  auth,
  state,
}: {
  readonly auth: AuthService;
  readonly state: AuthState;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <section className="auth-card account-card" aria-labelledby="account-title">
      <div className="account-avatar">
        <UserRound size={32} aria-hidden="true" />
        <span>
          <Check size={13} aria-hidden="true" />
        </span>
      </div>
      <h2 id="account-title" ref={heading} tabIndex={-1}>
        Вы в аккаунте
      </h2>
      <p className="form-description">Всё готово. Вход выполнен.</p>
      <Feedback error={state.error} notice={state.notice} />
      <dl className="account-details">
        <div>
          <dt>Электронная почта</dt>
          <dd>{state.user?.email}</dd>
        </div>
        <div>
          <dt>Статус почты</dt>
          <dd className="verified-status">
            <ShieldCheck size={17} aria-hidden="true" />
            {state.user?.emailConfirmed
              ? 'Подтверждена'
              : 'Ожидает подтверждения'}
          </dd>
        </div>
      </dl>
      <p className="session-note">
        На этом устройстве вход сохранится после обновления страницы.
      </p>
      <button
        className="button-secondary"
        type="button"
        disabled={state.pending !== null}
        aria-busy={state.pending === 'signOut'}
        onClick={() => {
          void auth.signOut();
        }}
      >
        <LogOut size={18} aria-hidden="true" />
        {state.pending === 'signOut' ? 'Выходим…' : 'Выйти из аккаунта'}
      </button>
    </section>
  );
}
