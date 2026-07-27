import 'server-only';

import { randomBytes } from 'node:crypto';
import { Redis } from '@upstash/redis';

const KEY_PREFIX = 'assistant:confirm:';
const TTL_SECONDS = 150; // > timeout de 120 s, marge de nettoyage
const DEFAULT_POLL_MS = 1000;
const DEFAULT_TIMEOUT_MS = 120_000;

interface PendingRecord {
  readonly userId: string;
  readonly status: 'pending' | 'allowed' | 'denied';
}

export interface ConfirmBackend {
  get(id: string): Promise<PendingRecord | null>;
  set(id: string, record: PendingRecord): Promise<void>;
  delete(id: string): Promise<void>;
}

/** Backend Upstash (prod). */
export class RedisConfirmBackend implements ConfirmBackend {
  constructor(private readonly redis: Redis) {}
  async get(id: string): Promise<PendingRecord | null> {
    return (await this.redis.get<PendingRecord>(KEY_PREFIX + id)) ?? null;
  }
  async set(id: string, record: PendingRecord): Promise<void> {
    await this.redis.set(KEY_PREFIX + id, record, { ex: TTL_SECONDS });
  }
  async delete(id: string): Promise<void> {
    await this.redis.del(KEY_PREFIX + id);
  }
}

/** Backend mémoire (dev/tests) — un seul process, comme le fallback rate-limit. */
export class MemoryConfirmBackend implements ConfirmBackend {
  private readonly map = new Map<string, PendingRecord>();
  async get(id: string): Promise<PendingRecord | null> {
    return this.map.get(id) ?? null;
  }
  async set(id: string, record: PendingRecord): Promise<void> {
    this.map.set(id, record);
  }
  async delete(id: string): Promise<void> {
    this.map.delete(id);
  }
}

export type AnswerOutcome = 'ok' | 'not_found' | 'forbidden' | 'already_answered';

export class ConfirmStore {
  constructor(private readonly backend: ConfirmBackend) {}

  async createPending(userId: string): Promise<string> {
    const id = randomBytes(16).toString('hex');
    await this.backend.set(id, { userId, status: 'pending' });
    return id;
  }

  /** Un oui = une exécution : la première réponse gagne, les suivantes sont rejetées. */
  async answer(id: string, userId: string, allowed: boolean): Promise<AnswerOutcome> {
    const record = await this.backend.get(id);
    if (record === null) return 'not_found';
    if (record.userId !== userId) return 'forbidden';
    if (record.status !== 'pending') return 'already_answered';
    await this.backend.set(id, { userId, status: allowed ? 'allowed' : 'denied' });
    return 'ok';
  }

  /**
   * Poll jusqu'à réponse, timeout ou abort ; timeout/abort = refus (fail closed).
   * Nettoie la clé. `signal` (ex: déconnexion du client SSE) court-circuite le poll
   * au lieu d'attendre le timeout complet — pas de boucle zombie de 120 s.
   * Race à la frontière du timeout : une réponse qui arrive juste après le nettoyage
   * voit `not_found` (→ 404 côté endpoint) — l'UI traite ce non-2xx comme informatif.
   */
  async awaitAnswer(
    id: string,
    opts?: {
      readonly pollMs?: number;
      readonly timeoutMs?: number;
      readonly signal?: AbortSignal;
    },
  ): Promise<boolean> {
    const pollMs = opts?.pollMs ?? DEFAULT_POLL_MS;
    const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const deadline = Date.now() + timeoutMs;
    try {
      for (;;) {
        if (opts?.signal?.aborted === true) return false;
        const record = await this.backend.get(id);
        if (record === null) return false;
        if (record.status === 'allowed') return true;
        if (record.status === 'denied') return false;
        if (Date.now() >= deadline) return false;
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }
    } finally {
      await this.backend.delete(id).catch(() => undefined);
    }
  }
}

let instance: ConfirmStore | null = null;

/** Store partagé du process. Upstash si configuré, mémoire sinon (dev/preview). */
export function getConfirmStore(): ConfirmStore {
  if (instance === null) {
    const url = process.env['UPSTASH_REDIS_REST_URL'];
    const token = process.env['UPSTASH_REDIS_REST_TOKEN'];
    if (url !== undefined && url !== '' && token !== undefined && token !== '') {
      instance = new ConfirmStore(new RedisConfirmBackend(new Redis({ url, token })));
    } else {
      // Même politique que lib/rate-limit : seule la *vraie* production
      // (VERCEL_ENV=production) exige Upstash — le fallback mémoire ne survit
      // pas aux invocations serverless (chaque confirmation timeouterait en
      // refus silencieux). Preview/dev/test tombent sur la mémoire.
      if (process.env['VERCEL_ENV'] === 'production') {
        throw new Error(
          'ConfirmStore requires Upstash Redis in production. ' +
            'Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.',
        );
      }
      console.warn('[assistant] confirm store: in-memory fallback (single instance only)');
      instance = new ConfirmStore(new MemoryConfirmBackend());
    }
  }
  return instance;
}

/** Test-only : réinitialise le singleton module-level (sélection de backend). */
export function resetConfirmStoreForTests(): void {
  instance = null;
}
