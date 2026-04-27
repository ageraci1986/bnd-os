import 'server-only';
import { z } from 'zod';

/**
 * SECURITY: server-only env schema. Validated at build time + runtime.
 * NEXT_PUBLIC_* values that need validation are checked separately.
 *
 * Note on optional + empty strings: when a key is declared in `.env.local`
 * but left empty (`FOO=`), Node sets `process.env.FOO` to "". A bare
 * `z.string().min(20).optional()` would then reject "". The helpers below
 * coerce empty / whitespace-only strings to `undefined` before validation.
 */

/** Optional string with a min length when present. Empty/whitespace = absent. */
const optionalString = (min: number) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim().length === 0 ? undefined : v),
    z.string().min(min).optional(),
  );

/** Optional URL. Empty/whitespace = absent. */
const optionalUrl = () =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim().length === 0 ? undefined : v),
    z.string().url().optional(),
  );

const ServerEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // Supabase — server-side only
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  SUPABASE_JWT_SECRET: z.string().min(20),
  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url(),

  // Crypto — keys MUST be base64-encoded 32 bytes (AES-256)
  ENCRYPTION_KEY: z
    .string()
    .min(44, 'ENCRYPTION_KEY must be a base64-encoded 32-byte key (44 chars)'),
  ENCRYPTION_KEY_VERSION: z.coerce.number().int().min(1).default(1),
  INVITATION_SECRET: z.string().min(32),

  // Integrations
  // RESEND_API_KEY is required in production but optional in dev (the email
  // adapter falls back to a redacted console preview when missing).
  RESEND_API_KEY: optionalString(20),
  RESEND_FROM_EMAIL: z.string().email().default('invitations@mail.nexushub.app'),
  RESEND_FROM_NAME: z.string().default('NexusHub'),
  SLACK_CLIENT_ID: optionalString(1),
  SLACK_CLIENT_SECRET: optionalString(1),
  SLACK_SIGNING_SECRET: optionalString(1),
  GRAPH_CLIENT_ID: optionalString(1),
  GRAPH_CLIENT_SECRET: optionalString(1),

  // Inngest
  INNGEST_EVENT_KEY: optionalString(1),
  INNGEST_SIGNING_KEY: optionalString(1),

  // Upstash (rate limiting)
  UPSTASH_REDIS_REST_URL: optionalUrl(),
  UPSTASH_REDIS_REST_TOKEN: optionalString(1),

  // Sentry
  SENTRY_DSN: optionalUrl(),
});

export type ServerEnv = z.infer<typeof ServerEnvSchema>;

let cached: ServerEnv | null = null;

export function getServerEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = ServerEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // SECURITY: never log raw process.env. Print only the missing/invalid keys.
    const missing = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Invalid server env: ${missing}`);
  }
  cached = parsed.data;
  return cached;
}

const PublicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
  NEXT_PUBLIC_APP_URL: z.string().url(),
});

export type PublicEnv = z.infer<typeof PublicEnvSchema>;

export function getPublicEnv(): PublicEnv {
  const parsed = PublicEnvSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env['NEXT_PUBLIC_SUPABASE_URL'],
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'],
    NEXT_PUBLIC_APP_URL: process.env['NEXT_PUBLIC_APP_URL'],
  });
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Invalid public env: ${missing}`);
  }
  return parsed.data;
}
