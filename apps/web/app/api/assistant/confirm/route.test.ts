import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  assertCsrfHeader: vi.fn(),
  answer: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ getAuthContext: mocks.getAuthContext }));
vi.mock('@/lib/csrf', () => ({ assertCsrfHeader: mocks.assertCsrfHeader }));
vi.mock('@/lib/assistant/confirm-store', () => ({
  getConfirmStore: () => ({ answer: mocks.answer }),
}));
vi.mock('server-only', () => ({}));

import { POST } from './route';

const ctx = { userId: 'u1', email: 'a@b.c', workspaceId: 'w1', role: 'user', isSuperAdmin: false };

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/assistant/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-csrf-token': 'tok' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(ctx);
  mocks.assertCsrfHeader.mockResolvedValue(undefined);
  mocks.answer.mockResolvedValue('ok');
});

describe('POST /api/assistant/confirm', () => {
  const valid = { id: 'a'.repeat(32), allowed: true };

  it('non authentifié → 401', async () => {
    mocks.getAuthContext.mockResolvedValue(null);
    expect((await POST(makeRequest(valid))).status).toBe(401);
  });

  it('CSRF invalide → 403', async () => {
    mocks.assertCsrfHeader.mockRejectedValue(new Error('CSRF'));
    expect((await POST(makeRequest(valid))).status).toBe(403);
  });

  it('body invalide → 400', async () => {
    expect((await POST(makeRequest({ id: 'court', allowed: true }))).status).toBe(400);
  });

  it("réponse acceptée → 200, answer appelé avec l'userId de la session", async () => {
    const res = await POST(makeRequest(valid));
    expect(res.status).toBe(200);
    expect(mocks.answer).toHaveBeenCalledWith(valid.id, 'u1', true);
  });

  it('not_found → 404, forbidden → 403, already_answered → 409', async () => {
    mocks.answer.mockResolvedValueOnce('not_found');
    expect((await POST(makeRequest(valid))).status).toBe(404);
    mocks.answer.mockResolvedValueOnce('forbidden');
    expect((await POST(makeRequest(valid))).status).toBe(403);
    mocks.answer.mockResolvedValueOnce('already_answered');
    expect((await POST(makeRequest(valid))).status).toBe(409);
  });
});
