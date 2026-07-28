import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  assertCsrf: vi.fn(),
  rememberFact: vi.fn(),
  updateFact: vi.fn(),
  forgetFact: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireUser: mocks.requireUser }));
vi.mock('@/lib/csrf', () => ({ assertCsrfFromFormData: mocks.assertCsrf }));
vi.mock('@/lib/assistant/memory', () => ({
  rememberFact: mocks.rememberFact,
  updateFact: mocks.updateFact,
  forgetFact: mocks.forgetFact,
}));

import { createMemoryAction, deleteMemoryAction, updateMemoryAction } from './memory';

const CTX = {
  userId: 'u-1',
  workspaceId: 'ws-1',
  role: 'admin',
  isSuperAdmin: false,
  email: 'admin@test',
};

function buildFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  fd.set('_csrf', 'tok');
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
  mocks.requireUser.mockResolvedValue(CTX);
});

describe('createMemoryAction', () => {
  it('returns success with the stored name/fact on happy path', async () => {
    mocks.rememberFact.mockResolvedValueOnce({
      ok: true,
      name: 'prefere-reunions-le-matin',
      fact: 'Préfère les réunions le matin',
    });
    const result = await createMemoryAction(
      { status: 'idle' },
      buildFormData({ fact: 'Préfère les réunions le matin' }),
    );
    expect(result).toEqual({
      status: 'success',
      name: 'prefere-reunions-le-matin',
      fact: 'Préfère les réunions le matin',
    });
    expect(mocks.rememberFact).toHaveBeenCalledWith(CTX, 'Préfère les réunions le matin');
  });

  it('maps a core failure to status error', async () => {
    mocks.rememberFact.mockResolvedValueOnce({
      ok: false,
      message: 'Le fait est vide — rien à retenir.',
    });
    const result = await createMemoryAction({ status: 'idle' }, buildFormData({ fact: '' }));
    expect(result).toEqual({ status: 'error', message: 'Le fait est vide — rien à retenir.' });
  });

  it('treats a missing fact field as an empty string', async () => {
    mocks.rememberFact.mockResolvedValueOnce({
      ok: false,
      message: 'Le fait est vide — rien à retenir.',
    });
    await createMemoryAction({ status: 'idle' }, buildFormData({}));
    expect(mocks.rememberFact).toHaveBeenCalledWith(CTX, '');
  });

  it('calls CSRF check, then requireUser, then the core in order', async () => {
    mocks.rememberFact.mockResolvedValueOnce({ ok: true, name: 'x', fact: 'x' });
    await createMemoryAction({ status: 'idle' }, buildFormData({ fact: 'x' }));
    const csrfOrder = mocks.assertCsrf.mock.invocationCallOrder[0]!;
    const userOrder = mocks.requireUser.mock.invocationCallOrder[0]!;
    const coreOrder = mocks.rememberFact.mock.invocationCallOrder[0]!;
    expect(csrfOrder).toBeLessThan(userOrder);
    expect(userOrder).toBeLessThan(coreOrder);
  });
});

describe('updateMemoryAction', () => {
  it('returns success with the normalized fact on happy path', async () => {
    mocks.updateFact.mockResolvedValueOnce({ ok: true, fact: 'Nouveau fait' });
    const result = await updateMemoryAction(
      { status: 'idle' },
      buildFormData({ name: 'mon-fait', fact: 'Nouveau fait' }),
    );
    expect(result).toEqual({ status: 'success', fact: 'Nouveau fait' });
    expect(mocks.updateFact).toHaveBeenCalledWith(CTX, 'mon-fait', 'Nouveau fait');
  });

  it('maps a core failure (unknown name) to status error', async () => {
    mocks.updateFact.mockResolvedValueOnce({
      ok: false,
      message: 'Aucun fait nommé « inconnu ». Faits existants : mon-fait.',
    });
    const result = await updateMemoryAction(
      { status: 'idle' },
      buildFormData({ name: 'inconnu', fact: 'x' }),
    );
    expect(result).toEqual({
      status: 'error',
      message: 'Aucun fait nommé « inconnu ». Faits existants : mon-fait.',
    });
  });

  it('calls CSRF check, then requireUser, then the core in order', async () => {
    mocks.updateFact.mockResolvedValueOnce({ ok: true, fact: 'x' });
    await updateMemoryAction({ status: 'idle' }, buildFormData({ name: 'n', fact: 'x' }));
    const csrfOrder = mocks.assertCsrf.mock.invocationCallOrder[0]!;
    const userOrder = mocks.requireUser.mock.invocationCallOrder[0]!;
    const coreOrder = mocks.updateFact.mock.invocationCallOrder[0]!;
    expect(csrfOrder).toBeLessThan(userOrder);
    expect(userOrder).toBeLessThan(coreOrder);
  });
});

describe('deleteMemoryAction', () => {
  it('returns success on happy path', async () => {
    mocks.forgetFact.mockResolvedValueOnce({ ok: true });
    const result = await deleteMemoryAction(
      { status: 'idle' },
      buildFormData({ name: 'mon-fait' }),
    );
    expect(result).toEqual({ status: 'success' });
    expect(mocks.forgetFact).toHaveBeenCalledWith(CTX, 'mon-fait');
  });

  it('maps a core failure (unknown name) to status error', async () => {
    mocks.forgetFact.mockResolvedValueOnce({
      ok: false,
      message: 'Aucun fait nommé « inconnu ». Faits existants : (aucun).',
    });
    const result = await deleteMemoryAction({ status: 'idle' }, buildFormData({ name: 'inconnu' }));
    expect(result).toEqual({
      status: 'error',
      message: 'Aucun fait nommé « inconnu ». Faits existants : (aucun).',
    });
  });

  it('calls CSRF check, then requireUser, then the core in order', async () => {
    mocks.forgetFact.mockResolvedValueOnce({ ok: true });
    await deleteMemoryAction({ status: 'idle' }, buildFormData({ name: 'n' }));
    const csrfOrder = mocks.assertCsrf.mock.invocationCallOrder[0]!;
    const userOrder = mocks.requireUser.mock.invocationCallOrder[0]!;
    const coreOrder = mocks.forgetFact.mock.invocationCallOrder[0]!;
    expect(csrfOrder).toBeLessThan(userOrder);
    expect(userOrder).toBeLessThan(coreOrder);
  });
});
