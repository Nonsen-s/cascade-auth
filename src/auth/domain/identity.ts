import { z } from 'zod';
import { AppError } from '../../shared/errors';

export const identitySchema = z.object({
  id: z.uuid(),
  email: z.email().max(254),
  emailConfirmed: z.boolean(),
});

export type PlayerIdentity = Readonly<z.infer<typeof identitySchema>>;

export function parseIdentity(value: unknown): PlayerIdentity {
  const result = identitySchema.safeParse(value);
  if (!result.success) throw new AppError('invalidResponse');
  return Object.freeze(result.data);
}
