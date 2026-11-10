import { z } from 'zod';

export type AuthCallback =
  | { readonly kind: 'none' }
  | { readonly kind: 'invalid' }
  | {
      readonly kind: 'token';
      readonly token: string;
      readonly type: 'email' | 'recovery';
    };
const linkSchema = z.strictObject({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  type: z.enum(['email', 'recovery']),
});

export function readAuthCallback(url: URL): {
  callback: AuthCallback;
  cleanUrl: string;
} {
  const clean = new URL(url);
  const fragment = new URLSearchParams(url.hash.slice(1));
  const sensitive = [
    'token',
    'token_hash',
    'code',
    'type',
    'access_token',
    'refresh_token',
    'error',
    'error_code',
    'error_description',
  ];
  const hasQuerySecret = sensitive.some((key) => url.searchParams.has(key));
  const hasFragment = sensitive.some((key) => fragment.has(key));
  let callback: AuthCallback = { kind: 'none' };
  if (hasQuerySecret) callback = { kind: 'invalid' };
  else if (hasFragment) {
    const result = linkSchema.safeParse(Object.fromEntries(fragment));
    const duplicate = [...fragment.keys()].some(
      (key) => fragment.getAll(key).length !== 1,
    );
    callback =
      result.success && !duplicate
        ? { kind: 'token', ...result.data }
        : { kind: 'invalid' };
  } else if (url.pathname === '/auth/confirm') callback = { kind: 'invalid' };
  sensitive.forEach((key) => clean.searchParams.delete(key));
  if (callback.kind !== 'none') {
    clean.hash = '';
    if (clean.pathname === '/auth/confirm') clean.pathname = '/';
  }
  return {
    callback,
    cleanUrl: `${clean.pathname}${clean.search}${clean.hash}`,
  };
}
