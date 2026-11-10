export const failureMessages = {
  validation: 'Проверьте отмеченные поля.',
  invalidCredentials: 'Не удалось войти. Проверьте почту и пароль.',
  emailUnconfirmed: 'Сначала подтвердите почту.',
  invalidLink:
    'Ссылка недействительна или её срок истёк. Запросите новое письмо.',
  sessionExpired: 'Сессия закончилась. Войдите ещё раз.',
  rateLimited: 'Слишком много запросов. Повторите попытку позже.',
  csrfRejected:
    'Не удалось проверить запрос. Обновите страницу и повторите действие.',
  forbiddenOrigin: 'Источник запроса не разрешён.',
  unavailable: 'Сервис временно недоступен. Повторите попытку позже.',
  tooLarge: 'Запрос слишком большой.',
  notFound: 'Ресурс не найден.',
  unexpected: 'Не удалось выполнить действие. Повторите попытку позже.',
} as const;

export type FailureCode = keyof typeof failureMessages;

export class AuthFailure extends Error {
  constructor(
    readonly code: FailureCode,
    readonly fields: Readonly<Record<string, string>> = {},
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(failureMessages[code]);
    this.name = 'AuthFailure';
  }
}
