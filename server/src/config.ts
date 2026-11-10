import { z } from 'zod';

const boolean = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true');
const hexKey = z.string().regex(/^[0-9a-f]{64}$/i);
const schema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  APP_ORIGIN: z.url(),
  APP_SECRET: hexKey,
  DB_DRIVER: z.enum(['postgres', 'pglite']).default('postgres'),
  DATABASE_URL: z.string().optional(),
  DATABASE_SSL: boolean.default(false),
  DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(50).default(10),
  PGLITE_DIRECTORY: z.string().default('.local/postgres'),
  AUTO_MIGRATE: boolean.default(false),
  TRUST_PROXY: z.string().default(''),
  HASH_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
  MAIL_TRANSPORT: z.enum(['smtp', 'file']).default('smtp'),
  MAIL_FROM: z.email().default('accounts@example.com'),
  MAIL_DIRECTORY: z.string().default('.local/mail'),
  MAIL_ACTIVE_KEY_ID: z
    .string()
    .regex(/^[a-zA-Z0-9_-]{1,32}$/)
    .default('v1'),
  MAIL_ENCRYPTION_KEYS: z.string(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: boolean.default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_ALLOW_PLAINTEXT: boolean.default(false),
  RUN_MAIL_WORKER: boolean.default(true),
  LOG_LEVEL: z
    .enum(['silent', 'error', 'warn', 'info', 'debug'])
    .default('info'),
});

export class ConfigurationError extends Error {
  constructor(readonly variables: readonly string[]) {
    super(`Invalid server configuration: ${variables.join(', ')}`);
    this.name = 'ConfigurationError';
  }
}

/** DATABASE_SSL is authoritative; pg must not override it from the URL. */
export function isPostgresConnectionUrl(value: string): boolean {
  if (!/^postgres(ql)?:\/\//.test(value)) return false;
  try {
    const url = new URL(value);
    return (
      ['postgres:', 'postgresql:'].includes(url.protocol) &&
      [...url.searchParams.keys()].every(
        (key) => !/^ssl|^uselibpqcompat$/i.test(key),
      )
    );
  } catch {
    return false;
  }
}

export interface ServerConfig {
  readonly environment: 'development' | 'test' | 'production';
  readonly host: string;
  readonly port: number;
  readonly appOrigin: string;
  readonly secret: Buffer;
  readonly database: {
    readonly driver: 'postgres' | 'pglite';
    readonly url: string | null;
    readonly ssl: boolean;
    readonly poolSize: number;
    readonly directory: string;
    readonly autoMigrate: boolean;
  };
  readonly trustProxy: readonly string[];
  readonly hashConcurrency: number;
  readonly mail: {
    readonly transport: 'smtp' | 'file';
    readonly from: string;
    readonly directory: string;
    readonly activeKeyId: string;
    readonly keys: ReadonlyMap<string, Buffer>;
    readonly smtp: {
      readonly host: string | null;
      readonly port: number;
      readonly secure: boolean;
      readonly user: string | null;
      readonly password: string | null;
      readonly allowPlaintext: boolean;
    };
  };
  readonly runMailWorker: boolean;
  readonly logLevel: 'silent' | 'error' | 'warn' | 'info' | 'debug';
}

export function readServerConfig(environment: unknown): ServerConfig {
  const result = schema.safeParse(environment);
  if (!result.success)
    throw new ConfigurationError([
      ...new Set(result.error.issues.map((issue) => String(issue.path[0]))),
    ]);
  const value = result.data;
  const invalid: string[] = [];
  const origin = new URL(value.APP_ORIGIN);
  if (
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash ||
    !['https:', 'http:'].includes(origin.protocol)
  )
    invalid.push('APP_ORIGIN');
  if (value.NODE_ENV === 'production' && origin.protocol !== 'https:')
    invalid.push('APP_ORIGIN');
  if (
    value.DB_DRIVER === 'postgres' &&
    (!value.DATABASE_URL || !isPostgresConnectionUrl(value.DATABASE_URL))
  )
    invalid.push('DATABASE_URL');
  if (value.MAIL_TRANSPORT === 'smtp' && !value.SMTP_HOST)
    invalid.push('SMTP_HOST');
  if (Boolean(value.SMTP_USER) !== Boolean(value.SMTP_PASSWORD))
    invalid.push('SMTP_USER', 'SMTP_PASSWORD');
  if (
    value.NODE_ENV === 'production' &&
    (value.DB_DRIVER !== 'postgres' ||
      value.MAIL_TRANSPORT !== 'smtp' ||
      value.SMTP_ALLOW_PLAINTEXT ||
      value.AUTO_MIGRATE)
  )
    invalid.push('production-mode');
  if (
    (value.DB_DRIVER === 'pglite' || value.MAIL_TRANSPORT === 'file') &&
    !['127.0.0.1', '::1', 'localhost'].includes(value.HOST)
  )
    invalid.push('HOST');
  let keyInput: unknown;
  try {
    keyInput = JSON.parse(value.MAIL_ENCRYPTION_KEYS);
  } catch {
    throw new ConfigurationError(['MAIL_ENCRYPTION_KEYS']);
  }
  const keys = z
    .record(z.string().regex(/^[a-zA-Z0-9_-]{1,32}$/), hexKey)
    .refine(
      (record) =>
        Object.keys(record).length >= 1 && Object.keys(record).length <= 4,
    )
    .safeParse(keyInput);
  if (!keys.success || !keys.data[value.MAIL_ACTIVE_KEY_ID])
    throw new ConfigurationError([
      'MAIL_ENCRYPTION_KEYS',
      'MAIL_ACTIVE_KEY_ID',
    ]);
  if (invalid.length) throw new ConfigurationError(invalid);
  return {
    environment: value.NODE_ENV,
    host: value.HOST,
    port: value.PORT,
    appOrigin: origin.origin,
    secret: Buffer.from(value.APP_SECRET, 'hex'),
    database: {
      driver: value.DB_DRIVER,
      url: value.DATABASE_URL ?? null,
      ssl: value.DATABASE_SSL,
      poolSize: value.DATABASE_POOL_SIZE,
      directory: value.PGLITE_DIRECTORY,
      autoMigrate: value.AUTO_MIGRATE,
    },
    trustProxy: value.TRUST_PROXY.split(',')
      .map((item) => item.trim())
      .filter(Boolean),
    hashConcurrency: value.HASH_CONCURRENCY,
    mail: {
      transport: value.MAIL_TRANSPORT,
      from: value.MAIL_FROM,
      directory: value.MAIL_DIRECTORY,
      activeKeyId: value.MAIL_ACTIVE_KEY_ID,
      keys: new Map(
        Object.entries(keys.data).map(([id, key]) => [
          id,
          Buffer.from(key, 'hex'),
        ]),
      ),
      smtp: {
        host: value.SMTP_HOST ?? null,
        port: value.SMTP_PORT,
        secure: value.SMTP_SECURE,
        user: value.SMTP_USER ?? null,
        password: value.SMTP_PASSWORD ?? null,
        allowPlaintext: value.SMTP_ALLOW_PLAINTEXT,
      },
    },
    runMailWorker: value.RUN_MAIL_WORKER,
    logLevel: value.LOG_LEVEL,
  };
}
