import type { MailContent } from '../../domain/models.js';

const escapeHtml = (text: string): string =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');

export function renderMail(content: MailContent, appOrigin: string) {
  const link = new URL('/auth/confirm', appOrigin);
  // Fragments are not sent to HTTP servers or proxy access logs.
  link.hash = new URLSearchParams({
    token: content.token,
    type: content.purpose,
  }).toString();
  const verification = content.purpose === 'email';
  const subject = verification
    ? 'Подтвердите почту — Каскад'
    : 'Восстановление пароля — Каскад';
  const action = verification ? 'Подтвердить почту' : 'Установить новый пароль';
  const instruction = verification
    ? 'Подтвердите адрес, затем установите пароль, чтобы завершить регистрацию.'
    : 'Перейдите по ссылке, чтобы установить новый пароль.';
  return {
    subject,
    text: `${instruction}\n\n${link.href}\n\nЕсли вы не запрашивали это письмо, проигнорируйте его.`,
    html: `<html lang="ru"><body><h1>${subject}</h1><p>${instruction}</p><p><a href="${escapeHtml(link.href)}">${action}</a></p><p>Если вы не запрашивали это письмо, проигнорируйте его.</p></body></html>`,
  };
}
