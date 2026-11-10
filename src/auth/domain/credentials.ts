import { z } from 'zod';
import {
  emailSchema,
  loginInputSchema,
  passwordSchema,
} from '../../../shared/auth-contract';
import { AppError, type FieldErrors } from '../../shared/errors';

const passwordPair = z
  .object({ password: passwordSchema, confirmPassword: z.string() })
  .refine((value) => value.password === value.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Пароли не совпадают.',
  });
const registrationSchema = passwordPair.safeExtend({ email: emailSchema });
export type Credentials = Readonly<z.infer<typeof loginInputSchema>>;

function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const fields: Partial<Record<keyof FieldErrors, string>> = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0];
    if (
      (field === 'email' ||
        field === 'password' ||
        field === 'confirmPassword') &&
      !fields[field]
    )
      fields[field] = issue.message;
  }
  throw new AppError('validation', fields);
}
export function parseSignIn(value: unknown): Credentials {
  return parseInput(loginInputSchema, value);
}
export function parseRegistration(value: unknown): Credentials {
  const { email, password } = parseInput(registrationSchema, value);
  return { email, password };
}
export function parseEmail(value: unknown): string {
  return parseInput(z.object({ email: emailSchema }), { email: value }).email;
}
export function parseNewPassword(value: unknown): string {
  return parseInput(passwordPair, value).password;
}
