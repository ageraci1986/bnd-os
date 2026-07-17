/**
 * Rate limiting (CLAUDE.md §4.3).
 *
 * - Production: Upstash Redis sliding window (when UPSTASH_REDIS_REST_URL is set).
 * - Dev/test: in-memory sliding window (process-local, resets on restart).
 *
 * SECURITY note: never use the in-memory fallback in production — it offers
 * no protection across processes and is bypassed by horizontal scaling.
 * `getRateLimiter` throws in production if Upstash is missing.
 */
import 'server-only';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

export type RateLimitKey =
  | 'login'
  | 'password_reset'
  | 'invitation'
  | 'signup_token'
  | 'imap_test'
  | 'mail_send_hour'
  | 'mail_send_day'
  | 'mail_attachment_upload'
  | 'mail_attachment_download';

export interface RateLimitResult {
  readonly success: boolean;
  readonly remaining: number;
  /** Unix ms timestamp at which the limit resets. */
  readonly reset: number;
}

interface Limiter {
  readonly check: (identifier: string) => Promise<RateLimitResult>;
}

const WINDOWS: Record<
  RateLimitKey,
  { readonly limit: number; readonly window: `${number} ${'s' | 'm' | 'h'}` }
> = {
  login: { limit: 5, window: '15 m' },
  password_reset: { limit: 3, window: '1 h' },
  invitation: { limit: 20, window: '24 h' },
  signup_token: { limit: 5, window: '1 h' },
  imap_test: { limit: 5, window: '5 m' },
  mail_send_hour: { limit: 50, window: '1 h' },
  mail_send_day: { limit: 300, window: '24 h' },
  mail_attachment_upload: { limit: 30, window: '1 h' },
  mail_attachment_download: { limit: 100, window: '1 h' },
};

/* ---------- Upstash backend ---------------------------------------------- */

function makeUpstashLimiter(redis: Redis, key: RateLimitKey): Limiter {
  const { limit, window } = WINDOWS[key];
  const rl = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(limit, window),
    analytics: false,
    prefix: `rl:${key}`,
  });
  return {
    async check(identifier) {
      const r = await rl.limit(identifier);
      return { success: r.success, remaining: r.remaining, reset: r.reset };
    },
  };
}

/* ---------- In-memory backend (dev/test only) ---------------------------- */

interface MemoryBucket {
  hits: number[];
}
const MEM_BUCKETS = new Map<string, MemoryBucket>();

function windowToMs(window: `${number} ${'s' | 'm' | 'h'}`): number {
  const [n, unit] = window.split(' ') as [string, 's' | 'm' | 'h'];
  const num = Number(n);
  if (unit === 's') return num * 1000;
  if (unit === 'm') return num * 60_000;
  return num * 3_600_000;
}

function makeMemoryLimiter(key: RateLimitKey): Limiter {
  const { limit, window } = WINDOWS[key];
  const windowMs = windowToMs(window);
  return {
    async check(identifier) {
      const now = Date.now();
      const bucketKey = `${key}:${identifier}`;
      const bucket = MEM_BUCKETS.get(bucketKey) ?? { hits: [] };
      bucket.hits = bucket.hits.filter((t) => now - t < windowMs);
      const success = bucket.hits.length < limit;
      if (success) bucket.hits.push(now);
      MEM_BUCKETS.set(bucketKey, bucket);
      const oldest = bucket.hits[0] ?? now;
      return {
        success,
        remaining: Math.max(0, limit - bucket.hits.length),
        reset: oldest + windowMs,
      };
    },
  };
}

/* ---------- Public factory ---------------------------------------------- */

let _redis: Redis | null = null;
const _limiters = new Map<RateLimitKey, Limiter>();

function getRedis(): Redis | null {
  if (_redis !== null) return _redis;
  const url = process.env['UPSTASH_REDIS_REST_URL'];
  const token = process.env['UPSTASH_REDIS_REST_TOKEN'];
  if (!url || !token) return null;
  _redis = new Redis({ url, token });
  return _redis;
}

export function getRateLimiter(key: RateLimitKey): Limiter {
  const cached = _limiters.get(key);
  if (cached) return cached;

  const redis = getRedis();
  if (redis) {
    const limiter = makeUpstashLimiter(redis, key);
    _limiters.set(key, limiter);
    return limiter;
  }

  // Only *real* production (VERCEL_ENV=production) requires Upstash.
  // Preview and Development deployments — where NODE_ENV is also 'production'
  // in Next.js builds — fall back to the in-memory limiter so the whole app
  // doesn't crash when previewing on a Vercel branch that lacks the secrets.
  if (process.env['VERCEL_ENV'] === 'production') {
    throw new Error(
      'Rate limiter: Upstash credentials missing in production. ' +
        'Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.',
    );
  }

  const limiter = makeMemoryLimiter(key);
  _limiters.set(key, limiter);
  return limiter;
}

/* ---------- Mail send (dual window) --------------------------------------- */

export interface MailSendRateResult {
  readonly success: boolean;
  readonly window: 'hour' | 'day' | null;
  readonly reset: number;
}

/**
 * Checks the mail_send rate limit for a user across two windows: 50/hour
 * and 300/day. Hour is checked first — if it fails, `window` is 'hour' and
 * the day window is left untouched (no double-consumption on failure).
 */
export async function checkMailSendRate(userId: string): Promise<MailSendRateResult> {
  const hour = await getRateLimiter('mail_send_hour').check(userId);
  if (!hour.success) return { success: false, window: 'hour', reset: hour.reset };
  const day = await getRateLimiter('mail_send_day').check(userId);
  if (!day.success) return { success: false, window: 'day', reset: day.reset };
  return { success: true, window: null, reset: day.reset };
}

/** Extract the client IP from common Vercel/Edge headers. */
export function getClientIp(headers: Headers): string {
  return (
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    headers.get('x-real-ip') ??
    headers.get('cf-connecting-ip') ??
    'unknown'
  );
}
