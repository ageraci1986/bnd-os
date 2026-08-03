import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  mintCsrfToken: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ getAuthContext: mocks.getAuthContext }));
vi.mock('@/lib/csrf', () => ({ mintCsrfToken: mocks.mintCsrfToken }));

import { GET } from './route';

describe('GET /api/assistant/csrf', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('401 sans session — le token n’est jamais réémis', async () => {
    mocks.getAuthContext.mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(401);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(false);
    expect(mocks.mintCsrfToken).not.toHaveBeenCalled();
  });

  it('200 authentifié — réémet le cookie CSRF via mintCsrfToken et renvoie le nouveau jeton', async () => {
    mocks.getAuthContext.mockResolvedValue({
      userId: 'u1',
      email: 'a@b.c',
      workspaceId: 'w1',
      role: 'user',
      isSuperAdmin: false,
    });
    mocks.mintCsrfToken.mockResolvedValue('fresh-token-123');

    const res = await GET();

    expect(res.status).toBe(200);
    // no-store explicite : la réponse porte un jeton vivant — aucun cache
    // (navigateur, CDN, proxy) ne doit pouvoir la retenir.
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = (await res.json()) as { ok: boolean; token: string };
    expect(body).toEqual({ ok: true, token: 'fresh-token-123' });
    expect(mocks.mintCsrfToken).toHaveBeenCalledTimes(1);
  });
});
