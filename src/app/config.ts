import { z } from 'zod';
import { AppError } from '../shared/errors';

export interface AppConfig {
  readonly apiBaseUrl: string;
}
const schema = z.object({ VITE_API_BASE_URL: z.string().default('/api/v1') });
export function readConfig(environment: unknown): AppConfig {
  const result = schema.safeParse(environment);
  if (!result.success) throw new AppError('configuration');
  const value = result.data.VITE_API_BASE_URL.replace(/\/$/, '');
  if (value.startsWith('/') && !value.startsWith('//') && !/[?#\\]/.test(value))
    return { apiBaseUrl: value };
  try {
    const url = new URL(value);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (
      (url.protocol === 'https:' || (local && url.protocol === 'http:')) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    )
      return { apiBaseUrl: value };
  } catch {
    throw new AppError('configuration');
  }
  throw new AppError('configuration');
}
