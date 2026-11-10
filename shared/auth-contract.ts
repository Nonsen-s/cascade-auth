import { z } from 'zod';

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(
    z.email('Введите корректную почту.').max(254, 'Почта слишком длинная.'),
  );
export const passwordSchema = z
  .string()
  .min(12, 'Используйте не менее 12 символов.')
  .max(128, 'Используйте не более 128 символов.');
export const loginInputSchema = z.strictObject({
  email: emailSchema,
  password: z
    .string()
    .min(1, 'Введите пароль.')
    .max(128, 'Пароль слишком длинный.'),
});
export const registerInputSchema = z.strictObject({
  email: emailSchema,
  password: passwordSchema,
});
export const emailInputSchema = z.strictObject({ email: emailSchema });
export const tokenInputSchema = z.strictObject({
  token: z
    .string()
    .regex(/^[A-Za-z0-9_-]{43}$/, 'Ссылка недействительна или её срок истёк.'),
});
export const resetPasswordInputSchema = z.strictObject({
  password: passwordSchema,
});

export const playerSchema = z.strictObject({
  id: z.uuid(),
  email: z.email(),
  emailConfirmed: z.boolean(),
});
export type Player = Readonly<z.infer<typeof playerSchema>>;
export const sessionResponseSchema = z.strictObject({
  user: playerSchema.nullable(),
  recovery: z.boolean(),
  csrfToken: z
    .string()
    .regex(/^[A-Za-z0-9_-]{43}$/)
    .nullable(),
  expiresAt: z.iso.datetime().nullable(),
});
export type SessionResponse = Readonly<z.infer<typeof sessionResponseSchema>>;
export const acceptedResponseSchema = z.strictObject({ message: z.string() });
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    fields: z.record(z.string(), z.string()),
    requestId: z.string(),
  }),
});

export const anonymousSession: SessionResponse = Object.freeze({
  user: null,
  recovery: false,
  csrfToken: null,
  expiresAt: null,
});
