import { z } from 'zod';

const DEV_SECRET = 'dev-only-secret-change-me-please-0123456789abcdef';
/** Secrets that have been published in this repository; production refuses them. */
const KNOWN_SECRETS = new Set([
  DEV_SECRET,
  // The fallback docker-compose.yml shipped with before it started requiring the variable.
  'compose-local-secret-change-me-0123456789abcdef',
]);
const PLACEHOLDER = /change[-_ ]?me/i;
const MIN_DISTINCT_CHARS = 10;

/** Why a secret is not fit for production, or null. Length is checked for every environment. */
function weakSecretReason(secret: string): string | null {
  if (KNOWN_SECRETS.has(secret)) return 'is a value published in this repository';
  if (PLACEHOLDER.test(secret)) return 'looks like a placeholder';
  if (new Set(secret).size < MIN_DISTINCT_CHARS)
    return `has fewer than ${MIN_DISTINCT_CHARS} distinct characters`;
  return null;
}

/**
 * Fastify's trustProxy: false (default, use the socket address), true (trust any proxy),
 * or a comma-separated list of proxy addresses / CIDR ranges to trust.
 */
const TrustProxySchema = z
  .string()
  .trim()
  .default('false')
  // A hop count does not work: as a string Fastify reads "1" as the address 0.0.0.1, and as a
  // number it trusts nobody. Either way every client would share the proxy's rate limit.
  .refine((value) => !/^\d+$/.test(value), {
    message: 'TRUST_PROXY takes true, false or proxy addresses, not a hop count',
  })
  .transform((value): boolean | string => {
    const lower = value.toLowerCase();
    if (lower === '' || lower === 'false') return false;
    if (lower === 'true') return true;
    return value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .join(',');
  });

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    JWT_ACCESS_SECRET: z
      .string()
      .min(32, 'JWT_ACCESS_SECRET must be at least 32 characters')
      .default(DEV_SECRET),
    /** Access token lifetime, seconds. */
    JWT_ACCESS_TTL: z.coerce.number().int().positive().default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
    /** Comma-separated list of allowed browser origins. */
    CORS_ORIGIN: z.string().default('http://localhost:3000'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
    RATE_LIMIT_LOGIN_MAX: z.coerce.number().int().positive().default(10),
    /** Set only behind a reverse proxy, otherwise X-Forwarded-For lets clients pick their IP. */
    TRUST_PROXY: TrustProxySchema,
    SEED_ON_START: z.stringbool().default(false),
  })
  .superRefine((env, ctx) => {
    const weak = env.NODE_ENV === 'production' && weakSecretReason(env.JWT_ACCESS_SECRET);
    if (weak) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_ACCESS_SECRET'],
        message: `JWT_ACCESS_SECRET ${weak}; set a random one in production (openssl rand -base64 48)`,
      });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return parsed.data;
}

export const isSqliteUrl = (url: string) => url.startsWith('file:');
