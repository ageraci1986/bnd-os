import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Redis } from '@upstash/redis';
import {
  ConfirmStore,
  MemoryConfirmBackend,
  RedisConfirmBackend,
  getConfirmStore,
  resetConfirmStoreForTests,
} from './confirm-store';

const redisMocks = vi.hoisted(() => ({
  ctor: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
}));
redisMocks.set.mockResolvedValue('OK');

vi.mock('@upstash/redis', () => ({
  Redis: class {
    constructor(config: unknown) {
      redisMocks.ctor(config);
    }
    get = redisMocks.get;
    set = redisMocks.set;
    del = redisMocks.del;
  },
}));

describe('ConfirmStore (backend mémoire)', () => {
  let store: ConfirmStore;

  beforeEach(() => {
    vi.useFakeTimers();
    store = new ConfirmStore(new MemoryConfirmBackend());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('createPending → answer(allowed) → awaitAnswer résout true', async () => {
    const id = await store.createPending('u1');
    const waiting = store.awaitAnswer(id, { pollMs: 10, timeoutMs: 1000 });
    expect(await store.answer(id, 'u1', true)).toBe('ok');
    await vi.advanceTimersByTimeAsync(20);
    await expect(waiting).resolves.toBe(true);
  });

  it('refus → awaitAnswer résout false', async () => {
    const id = await store.createPending('u1');
    const waiting = store.awaitAnswer(id, { pollMs: 10, timeoutMs: 1000 });
    expect(await store.answer(id, 'u1', false)).toBe('ok');
    await vi.advanceTimersByTimeAsync(20);
    await expect(waiting).resolves.toBe(false);
  });

  it('timeout sans réponse → false (refus par défaut)', async () => {
    const id = await store.createPending('u1');
    const waiting = store.awaitAnswer(id, { pollMs: 10, timeoutMs: 50 });
    await vi.advanceTimersByTimeAsync(100);
    await expect(waiting).resolves.toBe(false);
  });

  it('answer par un autre utilisateur → forbidden, la demande reste pending', async () => {
    const id = await store.createPending('u1');
    expect(await store.answer(id, 'u2', true)).toBe('forbidden');
    const waiting = store.awaitAnswer(id, { pollMs: 10, timeoutMs: 50 });
    await vi.advanceTimersByTimeAsync(100);
    await expect(waiting).resolves.toBe(false);
  });

  it('answer sur id inconnu → not_found ; double réponse → already_answered (single-use)', async () => {
    expect(await store.answer('inconnu', 'u1', true)).toBe('not_found');
    const id = await store.createPending('u1');
    expect(await store.answer(id, 'u1', true)).toBe('ok');
    expect(await store.answer(id, 'u1', false)).toBe('already_answered');
  });

  it('signal déjà aborté → awaitAnswer résout false immédiatement et nettoie la clé', async () => {
    const id = await store.createPending('u1');
    const controller = new AbortController();
    controller.abort();
    // Résout au premier tour de boucle — aucune avance de timer nécessaire.
    await expect(
      store.awaitAnswer(id, { pollMs: 10, timeoutMs: 60_000, signal: controller.signal }),
    ).resolves.toBe(false);
    // Clé nettoyée : une réponse tardive voit not_found.
    expect(await store.answer(id, 'u1', true)).toBe('not_found');
  });

  it('abort pendant l attente → résout false au poll suivant, sans attendre le timeout', async () => {
    const id = await store.createPending('u1');
    const controller = new AbortController();
    const waiting = store.awaitAnswer(id, {
      pollMs: 10,
      timeoutMs: 60_000,
      signal: controller.signal,
    });
    controller.abort();
    await vi.advanceTimersByTimeAsync(20);
    await expect(waiting).resolves.toBe(false);
    expect(await store.answer(id, 'u1', true)).toBe('not_found');
  });

  it('les ids sont uniques et non devinables (32 hex)', async () => {
    const a = await store.createPending('u1');
    const b = await store.createPending('u1');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
  });

  it('deux answer() concurrents (même id) → exactement un ok et un already_answered (SET NX atomique)', async () => {
    const id = await store.createPending('u1');
    const [first, second] = await Promise.all([
      store.answer(id, 'u1', true),
      store.answer(id, 'u1', false),
    ]);
    const outcomes = [first, second].sort();
    expect(outcomes).toEqual(['already_answered', 'ok']);
  });
});

describe('RedisConfirmBackend (client Upstash mocké)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('set écrit sous KEY_PREFIX avec TTL 150 s', async () => {
    const backend = new RedisConfirmBackend(new Redis({ url: 'https://x.upstash.io', token: 't' }));
    await backend.set('abc123', { userId: 'u1' });
    expect(redisMocks.set).toHaveBeenCalledTimes(1);
    expect(redisMocks.set).toHaveBeenCalledWith(
      'assistant:confirm:abc123',
      { userId: 'u1' },
      { ex: 150 },
    );
  });

  it('get retourne le record désérialisé par le client (round-trip JSON auto), null sinon', async () => {
    const backend = new RedisConfirmBackend(new Redis({ url: 'https://x.upstash.io', token: 't' }));
    redisMocks.get.mockResolvedValueOnce({ userId: 'u1' });
    await expect(backend.get('abc123')).resolves.toEqual({ userId: 'u1' });
    expect(redisMocks.get).toHaveBeenCalledWith('assistant:confirm:abc123');
    redisMocks.get.mockResolvedValueOnce(null);
    await expect(backend.get('absent')).resolves.toBeNull();
  });

  it('setAnswerIfAbsent écrit sous la clé :answer en SET NX avec TTL, OK → true', async () => {
    const backend = new RedisConfirmBackend(new Redis({ url: 'https://x.upstash.io', token: 't' }));
    redisMocks.set.mockResolvedValueOnce('OK');
    await expect(backend.setAnswerIfAbsent('abc123', true)).resolves.toBe(true);
    expect(redisMocks.set).toHaveBeenCalledWith('assistant:confirm:abc123:answer', true, {
      nx: true,
      ex: 150,
    });
  });

  it('setAnswerIfAbsent → null (clé déjà présente) → false', async () => {
    const backend = new RedisConfirmBackend(new Redis({ url: 'https://x.upstash.io', token: 't' }));
    redisMocks.set.mockResolvedValueOnce(null);
    await expect(backend.setAnswerIfAbsent('abc123', false)).resolves.toBe(false);
  });

  it('getAnswer lit la clé :answer, null si absente', async () => {
    const backend = new RedisConfirmBackend(new Redis({ url: 'https://x.upstash.io', token: 't' }));
    redisMocks.get.mockResolvedValueOnce(true);
    await expect(backend.getAnswer('abc123')).resolves.toBe(true);
    expect(redisMocks.get).toHaveBeenCalledWith('assistant:confirm:abc123:answer');
    redisMocks.get.mockResolvedValueOnce(null);
    await expect(backend.getAnswer('abc123')).resolves.toBeNull();
  });

  it('deleteAnswer supprime la clé :answer', async () => {
    const backend = new RedisConfirmBackend(new Redis({ url: 'https://x.upstash.io', token: 't' }));
    await backend.deleteAnswer('abc123');
    expect(redisMocks.del).toHaveBeenCalledWith('assistant:confirm:abc123:answer');
  });
});

describe('getConfirmStore (sélection de backend + guard production)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetConfirmStoreForTests();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetConfirmStoreForTests();
  });

  it('choisit Redis quand les deux env vars Upstash sont présentes', () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://example.upstash.io');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'tok');
    getConfirmStore();
    expect(redisMocks.ctor).toHaveBeenCalledTimes(1);
    expect(redisMocks.ctor).toHaveBeenCalledWith({
      url: 'https://example.upstash.io',
      token: 'tok',
    });
  });

  it('production sans credentials → throw explicite (jamais de fallback mémoire en prod)', () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    vi.stubEnv('VERCEL_ENV', 'production');
    expect(() => getConfirmStore()).toThrow(/ConfirmStore requires Upstash Redis in production/);
    expect(redisMocks.ctor).not.toHaveBeenCalled();
  });

  it('hors production sans credentials → fallback mémoire + warn', () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    vi.stubEnv('VERCEL_ENV', 'development');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const store = getConfirmStore();
      expect(store).toBeInstanceOf(ConfirmStore);
      expect(redisMocks.ctor).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        '[assistant] confirm store: in-memory fallback (single instance only)',
      );
      // Singleton : le second appel réutilise l'instance sans re-warn.
      expect(getConfirmStore()).toBe(store);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });
});
