# API аккаунтов v1

Базовый путь: `/api/v1/auth`. Машиночитаемый контракт: `GET /api/openapi.json`. Ответы аккаунта имеют `Cache-Control: no-store`.

Для всех POST обязательны `Content-Type: application/json` и `Origin`, точно совпадающий с `APP_ORIGIN`. Cookie браузер отправляет с `credentials: 'include'`. Произвольные redirect URL из запросов не принимаются.

| Метод и путь                | Запрос                                                                     | Успех                                                   |
| --------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------- |
| `POST /register`            | `{ "email": "player@example.com", "password": "long example passphrase" }` | 202, общее сообщение; письмо ставится в очередь         |
| `POST /login`               | email, password                                                            | 200, сессия и HttpOnly-cookie                           |
| `POST /resend-confirmation` | email                                                                      | 202, одинаковый тип ответа для всех адресов             |
| `POST /verify-email`        | token из письма                                                            | 200 `{ message }`, recovery-cookie для установки пароля |
| `POST /forgot-password`     | email                                                                      | 202, общий ответ без раскрытия аккаунта                 |
| `POST /recovery`            | token из письма                                                            | 200, ограниченная recovery-cookie                       |
| `POST /reset-password`      | password; recovery-cookie и CSRF                                           | 200, новая обычная сессия; прежние сессии отозваны      |
| `GET /session`              | cookie, если есть                                                          | 200, текущее состояние или анонимное                    |
| `GET /me`                   | обычная session-cookie                                                     | 200, текущий игрок; иначе 401                           |
| `POST /logout`              | `{}`; cookie и CSRF, если сессия действительна                             | 204, отзыв сессии устройства                            |
| `POST /logout-all`          | `{}`; обычная cookie и CSRF                                                | 204, отзыв всех сессий аккаунта                         |

Состояние сессии:

```json
{
  "user": {
    "id": "11111111-1111-4111-8111-111111111111",
    "email": "player@example.com",
    "emailConfirmed": true
  },
  "recovery": false,
  "csrfToken": "<отдельное CSRF-доказательство>",
  "expiresAt": "2026-11-24T00:00:00.000Z"
}
```

У анонимного состояния user/csrfToken/expiresAt равны null. В recovery-состоянии `recovery=true`, но запрос к `/me` всё равно запрещён. Подтверждение почты сохраняет JSON-ответ `{ message }` и устанавливает recovery-cookie: первоначально введённый пароль становится недействительным, а владелец получает CSRF-доказательство через `/session` и устанавливает свой пароль через `/reset-password`. Только после этого выдаётся access-сессия. При logout, logout-all и reset-password передайте `X-CSRF-Token` из актуального `/session` или ответа входа/восстановления. После смены сессии прежнее CSRF-доказательство не подходит.

Формат ошибки:

```json
{
  "error": {
    "code": "invalidCredentials",
    "message": "Не удалось войти. Проверьте почту и пароль.",
    "fields": {},
    "requestId": "идентификатор запроса"
  }
}
```

Коды: validation (400), invalidCredentials/sessionExpired (401), emailUnconfirmed/csrfRejected/forbiddenOrigin (403), invalidLink (400), rateLimited (429), tooLarge (413), unavailable (503). Внутренние исключения возвращают общий unexpected (500). Для ограничения частоты есть `Retry-After`.

Ограничение тела — 8 KiB. Почта нормализуется trim/lowercase, пароль не обрезается и не меняется: 12–128 символов. Дополнительные поля запросов отклоняются.

Письма ведут на `APP_ORIGIN/auth/confirm#token=…&type=email` или `type=recovery`. Токен передаётся во fragment, поэтому не попадает в обычный HTTP-запрос и access log. Клиент удаляет fragment из истории до обмена токена через POST. GET-запросы не подтверждают почту и не меняют пароль.

Логин, выход и установку пароля клиенту следует выполнять последовательно. Поставляемый браузерный адаптер использует Web Locks между вкладками. Проверка сессии вызывается при старте, фокусе, событии другой вкладки и раз в 30 секунд в видимой авторизованной вкладке; запросов на каждый рендер нет.

`/health/live` проверяет работу процесса, `/health/ready` — доступность базы. После получения SIGTERM сервер завершает текущие запросы, останавливает обработчик почты и закрывает соединения.
