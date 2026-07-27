import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmStore, MemoryConfirmBackend } from './confirm-store';

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

  it('les ids sont uniques et non devinables (32 hex)', async () => {
    const a = await store.createPending('u1');
    const b = await store.createPending('u1');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
  });
});
