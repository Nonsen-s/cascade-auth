export const errorMessages = {
  configuration: 'Сервис аккаунтов ещё не подключён. Попробуйте позже.',
  validation: 'Проверьте отмеченные поля.',
  invalidCredentials: 'Не удалось войти. Проверьте почту и пароль.',
  emailUnconfirmed:
    'Сначала подтвердите почту. Письмо можно отправить повторно.',
  rateLimited: 'Слишком много запросов. Подождите немного и попробуйте снова.',
  network: 'Нет связи с сервисом. Проверьте интернет и попробуйте снова.',
  invalidLink:
    'Ссылка недействительна или её срок истёк. Запросите новое письмо.',
  sessionExpired: 'Сессия закончилась. Войдите в аккаунт ещё раз.',
  weakPassword: 'Выберите более надёжный пароль длиной от 12 символов.',
  samePassword: 'Новый пароль должен отличаться от предыдущего.',
  busy: 'Дождитесь завершения текущего запроса.',
  csrfRejected:
    'Не удалось проверить запрос. Обновите страницу и повторите действие.',
  storage:
    'Браузер не разрешает сохранять сессию. Разрешите доступ к хранилищу сайта.',
  invalidResponse: 'Не удалось проверить ответ сервиса. Повторите попытку.',
  unavailable: 'Эта операция сейчас недоступна. Попробуйте позже.',
  cancelled: 'Состояние аккаунта изменилось. Повторите действие.',
  unexpected: 'Не удалось выполнить действие. Попробуйте ещё раз.',
} as const;

export type ErrorCode = keyof typeof errorMessages;
export type FieldErrors = Readonly<
  Partial<Record<'email' | 'password' | 'confirmPassword', string>>
>;

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly fields: FieldErrors = {},
  ) {
    super(errorMessages[code]);
    this.name = 'AppError';
  }
}

export function toAppError(error: unknown): AppError {
  return error instanceof AppError ? error : new AppError('unexpected');
}

export type ActionResult =
  { readonly ok: true } | { readonly ok: false; readonly error: AppError };
