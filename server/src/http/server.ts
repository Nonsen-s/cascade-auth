import { installErrorHandling } from './error-handler.js';
import { createAuthContext } from './auth-context.js';
import Fastify, { LogController } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import swagger from '@fastify/swagger';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import {
  acceptedResponseSchema,
  anonymousSession,
  emailInputSchema,
  loginInputSchema,
  playerSchema,
  registerInputSchema,
  resetPasswordInputSchema,
  sessionResponseSchema,
  tokenInputSchema,
} from '../../../shared/auth-contract.js';
import type { AccountService } from '../application/auth-service.js';
import { validate } from '../application/auth-service.js';
import type { RateLimiter } from '../application/ports.js';
import type { ServerConfig } from '../config.js';
import { AuthFailure } from '../domain/errors.js';
import type { Database } from '../infrastructure/database/database.js';
import type { SecurityTokens } from '../infrastructure/security/tokens.js';
import { SessionCookies } from './cookies.js';

interface Dependencies {
  readonly config: ServerConfig;
  readonly accounts: AccountService;
  readonly tokens: SecurityTokens;
  readonly limiter: RateLimiter;
  readonly database: Database;
  readonly now: () => Date;
  readonly logStream?: { write(message: string): void };
}
const jsonSchema = (schema: z.ZodType) =>
  z.toJSONSchema(schema, {
    target: 'draft-7',
    io: 'input',
    unrepresentable: 'any',
  });
const errorSchema = {
  type: 'object',
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message', 'fields', 'requestId'],
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        fields: { type: 'object', additionalProperties: { type: 'string' } },
        requestId: { type: 'string' },
      },
    },
  },
} as const;
const failures = {
  400: errorSchema,
  401: errorSchema,
  403: errorSchema,
  413: errorSchema,
  429: errorSchema,
  500: errorSchema,
  503: errorSchema,
};

export async function buildHttpServer({
  config,
  accounts,
  tokens,
  limiter,
  database,
  now,
  logStream,
}: Dependencies) {
  const app = Fastify({
    bodyLimit: 8192,
    requestTimeout: 15_000,
    connectionTimeout: 10_000,
    keepAliveTimeout: 5000,
    trustProxy: config.trustProxy.length ? [...config.trustProxy] : false,
    genReqId: () => randomUUID(),
    logController: new LogController({ disableRequestLogging: true }),
    ajv: {
      customOptions: {
        removeAdditional: false,
        coerceTypes: false,
        allErrors: false,
      },
    },
    logger:
      config.logLevel === 'silent'
        ? false
        : {
            level: config.logLevel,
            ...(logStream ? { stream: logStream } : {}),
            redact: [
              'req.headers.cookie',
              'req.headers.authorization',
              'req.body',
              'res.headers["set-cookie"]',
              'password',
              'token',
              'secret',
            ],
          },
  });
  const cookies = new SessionCookies(config.environment === 'production');
  await app.register(cookie);
  await app.register(cors, {
    origin: config.appOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['content-type', 'x-csrf-token'],
    exposedHeaders: ['x-request-id', 'retry-after'],
  });
  await app.register(helmet, { referrerPolicy: { policy: 'no-referrer' } });
  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: { title: 'Cascade Accounts API', version: '1.0.0' },
      components: {
        securitySchemes: {
          sessionCookie: {
            type: 'apiKey',
            in: 'cookie',
            name: cookies.accessName,
          },
        },
      },
    },
  });

  app.addHook('onRequest', async (request, reply) => {
    reply
      .header('Cache-Control', 'no-store')
      .header('X-Request-Id', request.id);
    if (
      request.method !== 'GET' &&
      request.method !== 'HEAD' &&
      request.method !== 'OPTIONS'
    ) {
      if (request.headers.origin !== config.appOrigin)
        throw new AuthFailure('forbiddenOrigin');
      if (
        request.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !==
        'application/json'
      )
        throw new AuthFailure('validation');
    }
    if (
      request.url.startsWith('/api/v1/auth/') &&
      request.method !== 'OPTIONS'
    ) {
      await limiter.consume(
        tokens.privateKey('http-ip', request.ip),
        240,
        60_000,
        now(),
      );
    }
  });
  app.addHook('onResponse', async (request, reply) => {
    request.log.info(
      {
        requestId: request.id,
        method: request.method,
        route: request.routeOptions.url ?? 'unknown',
        status: reply.statusCode,
      },
      'HTTP request completed',
    );
  });
  app.addHook('onSend', async (request, reply, payload) => {
    // Hide the short account-lookup path for missing addresses, without blocking the event loop.
    if (
      reply.statusCode === 202 &&
      request.routeOptions.url?.startsWith('/api/v1/auth/')
    ) {
      const remaining = 300 - reply.elapsedTime;
      if (remaining > 0) await delay(remaining);
    }
    return payload;
  });
  installErrorHandling(app);

  const { accountLimit, current, requireCsrf, sessionResponse } =
    createAuthContext({ accounts, limiter, tokens, cookies, now });

  app.post(
    '/api/v1/auth/register',
    {
      schema: {
        tags: ['Auth'],
        body: jsonSchema(registerInputSchema),
        response: { 202: jsonSchema(acceptedResponseSchema), ...failures },
      },
    },
    async (request, reply) => {
      const input = validate(registerInputSchema, request.body);
      await accountLimit(request, input.email, 'register');
      await accounts.register(input);
      return reply.status(202).send({
        message:
          'Если адрес можно зарегистрировать, вы получите письмо для подтверждения.',
      });
    },
  );
  app.post(
    '/api/v1/auth/login',
    {
      schema: {
        tags: ['Auth'],
        body: jsonSchema(loginInputSchema),
        response: { 200: jsonSchema(sessionResponseSchema), ...failures },
      },
    },
    async (request, reply) => {
      const input = validate(loginInputSchema, request.body);
      await accountLimit(request, input.email, 'login');
      const grant = await accounts.login(input, cookies.all(request));
      cookies.set(reply, grant, now());
      return sessionResponse(grant);
    },
  );
  app.post(
    '/api/v1/auth/resend-confirmation',
    {
      schema: {
        tags: ['Auth'],
        body: jsonSchema(emailInputSchema),
        response: { 202: jsonSchema(acceptedResponseSchema), ...failures },
      },
    },
    async (request, reply) => {
      const input = validate(emailInputSchema, request.body);
      await accountLimit(request, input.email, 'mail');
      await accounts.resend(input);
      return reply.status(202).send({
        message:
          'Если адрес ожидает подтверждения, новое письмо будет отправлено.',
      });
    },
  );
  app.post(
    '/api/v1/auth/forgot-password',
    {
      schema: {
        tags: ['Auth'],
        body: jsonSchema(emailInputSchema),
        response: { 202: jsonSchema(acceptedResponseSchema), ...failures },
      },
    },
    async (request, reply) => {
      const input = validate(emailInputSchema, request.body);
      await accountLimit(request, input.email, 'mail', 'recovery');
      await accounts.forgotPassword(input);
      return reply.status(202).send({
        message:
          'Если аккаунт существует и почта подтверждена, вы получите письмо для восстановления.',
      });
    },
  );
  app.post(
    '/api/v1/auth/verify-email',
    {
      schema: {
        tags: ['Auth'],
        body: jsonSchema(tokenInputSchema),
        response: { 200: jsonSchema(acceptedResponseSchema), ...failures },
      },
    },
    async (request, reply) => {
      const grant = await accounts.verifyEmail(
        request.body,
        cookies.all(request),
      );
      cookies.set(reply, grant, now());
      return {
        message:
          'Почта подтверждена. Установите пароль, чтобы завершить регистрацию.',
      };
    },
  );
  app.post(
    '/api/v1/auth/recovery',
    {
      schema: {
        tags: ['Auth'],
        body: jsonSchema(tokenInputSchema),
        response: { 200: jsonSchema(sessionResponseSchema), ...failures },
      },
    },
    async (request, reply) => {
      const grant = await accounts.beginRecovery(
        request.body,
        cookies.all(request),
      );
      cookies.set(reply, grant, now());
      return sessionResponse(grant);
    },
  );
  app.post(
    '/api/v1/auth/reset-password',
    {
      schema: {
        tags: ['Auth'],
        body: jsonSchema(resetPasswordInputSchema),
        response: { 200: jsonSchema(sessionResponseSchema), ...failures },
      },
    },
    async (request, reply) => {
      const value = await requireCsrf(request);
      if (value.session.kind !== 'recovery')
        throw new AuthFailure('invalidLink');
      const grant = await accounts.resetPassword(value.raw, request.body);
      cookies.set(reply, grant, now());
      return sessionResponse(grant);
    },
  );
  app.get(
    '/api/v1/auth/session',
    {
      schema: {
        tags: ['Auth'],
        response: { 200: jsonSchema(sessionResponseSchema), ...failures },
      },
    },
    async (request) => {
      const value = await current(request);
      return value
        ? {
            user: value.session.user,
            recovery: value.session.kind === 'recovery',
            csrfToken: tokens.csrf(value.raw),
            expiresAt: value.session.expiresAt.toISOString(),
          }
        : anonymousSession;
    },
  );
  app.get(
    '/api/v1/auth/me',
    {
      schema: {
        tags: ['Auth'],
        security: [{ sessionCookie: [] }],
        response: { 200: jsonSchema(playerSchema), ...failures },
      },
    },
    async (request) => {
      const session = await accounts.getSession(
        cookies.access(request),
        'access',
      );
      if (!session) throw new AuthFailure('sessionExpired');
      return session.user;
    },
  );
  app.post(
    '/api/v1/auth/logout',
    {
      schema: {
        tags: ['Auth'],
        body: { type: 'object', additionalProperties: false },
        response: { 204: { type: 'null' }, ...failures },
      },
    },
    async (request, reply) => {
      if (await current(request)) await requireCsrf(request);
      await accounts.logout(cookies.all(request));
      cookies.clear(reply);
      return reply.status(204).send();
    },
  );
  app.post(
    '/api/v1/auth/logout-all',
    {
      schema: {
        tags: ['Auth'],
        body: { type: 'object', additionalProperties: false },
        response: { 204: { type: 'null' }, ...failures },
      },
    },
    async (request, reply) => {
      const value = await requireCsrf(request);
      if (value.session.kind !== 'access')
        throw new AuthFailure('sessionExpired');
      await accounts.logoutAll(value.raw);
      cookies.clear(reply);
      return reply.status(204).send();
    },
  );
  app.get('/health/live', { schema: { hide: true } }, () => ({
    status: 'alive',
  }));
  app.get('/health/ready', { schema: { hide: true } }, async () => {
    try {
      await database.query('SELECT 1');
      return { status: 'ready' };
    } catch {
      throw new AuthFailure('unavailable');
    }
  });
  app.get('/api/openapi.json', { schema: { hide: true } }, () => app.swagger());
  await app.ready();
  return app;
}
