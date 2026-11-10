import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthFailure } from '../domain/errors.js';

function invalidFields(value: unknown): Readonly<Record<string, string>> {
  const issues = z
    .array(
      z.object({
        instancePath: z.string(),
        params: z.looseObject({ missingProperty: z.string().optional() }),
      }),
    )
    .safeParse(value);
  if (!issues.success) return {};
  const fields: Record<string, string> = {};
  for (const issue of issues.data) {
    const field =
      issue.instancePath.split('/').filter(Boolean)[0] ??
      issue.params.missingProperty;
    if (field && ['email', 'password', 'token'].includes(field))
      fields[field] = 'Проверьте значение поля.';
  }
  return fields;
}

export function installErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    let failure: AuthFailure;
    if (error instanceof AuthFailure) failure = error;
    else {
      const parsed = z
        .object({
          code: z.string().optional(),
          validation: z.unknown().optional(),
        })
        .safeParse(error);
      if (parsed.success && parsed.data.code === 'FST_ERR_CTP_BODY_TOO_LARGE')
        failure = new AuthFailure('tooLarge');
      else if (
        parsed.success &&
        (parsed.data.validation ||
          [
            'FST_ERR_CTP_INVALID_JSON_BODY',
            'FST_ERR_CTP_EMPTY_JSON_BODY',
          ].includes(parsed.data.code ?? ''))
      )
        failure = new AuthFailure(
          'validation',
          invalidFields(parsed.data.validation),
        );
      else {
        failure = new AuthFailure('unexpected');
        request.log.error(
          { requestId: request.id, reason: 'request_failed' },
          'Request failed',
        );
      }
    }
    const status = {
      validation: 400,
      invalidCredentials: 401,
      emailUnconfirmed: 403,
      invalidLink: 400,
      sessionExpired: 401,
      rateLimited: 429,
      csrfRejected: 403,
      forbiddenOrigin: 403,
      unavailable: 503,
      tooLarge: 413,
      notFound: 404,
      unexpected: 500,
    }[failure.code];
    if (failure.retryAfterSeconds)
      reply.header('Retry-After', failure.retryAfterSeconds);
    void reply.status(status).send({
      error: {
        code: failure.code,
        message: failure.message,
        fields: failure.fields,
        requestId: request.id,
      },
    });
  });
  app.setNotFoundHandler(() => {
    throw new AuthFailure('notFound');
  });
}
