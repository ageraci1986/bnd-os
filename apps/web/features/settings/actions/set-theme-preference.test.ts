import { describe, expect, it, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  requireUser: vi.fn(),
  userUpdate: vi.fn(),
  userFindUnique: vi.fn(),
  cookieSet: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@nexushub/db', () => ({
  prisma: { user: { update: m.userUpdate, findUnique: m.userFindUnique } },
}));
vi.mock('@/lib/auth', () => ({ requireUser: m.requireUser }));
vi.mock('next/headers', () => ({ cookies: async () => ({ set: m.cookieSet }) }));
vi.mock('next/cache', () => ({ revalidatePath: m.revalidatePath }));

import { setThemePreference, syncThemeCookie } from './set-theme-preference';

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset();
  m.requireUser.mockResolvedValue({ userId: 'u-1', workspaceId: 'ws-1', role: 'member' });
});

describe('setThemePreference', () => {
  it('writes the session user row and the cookie', async () => {
    m.userUpdate.mockResolvedValue({});
    expect(await setThemePreference('dark')).toEqual({ ok: true });
    expect(m.userUpdate).toHaveBeenCalledWith({ where: { id: 'u-1' }, data: { theme: 'dark' } });
    expect(m.cookieSet).toHaveBeenCalledWith(
      'nx-theme',
      'dark',
      expect.objectContaining({ httpOnly: true }),
    );
    expect(m.revalidatePath).toHaveBeenCalledWith('/settings');
  });

  it('rejects an invalid value without touching DB or cookie', async () => {
    const res = await setThemePreference('neon' as never);
    expect(res.ok).toBe(false);
    expect(m.userUpdate).not.toHaveBeenCalled();
    expect(m.cookieSet).not.toHaveBeenCalled();
    expect(m.revalidatePath).not.toHaveBeenCalled();
  });
});

describe('syncThemeCookie', () => {
  it('copies the DB value of the session user into the cookie', async () => {
    m.userFindUnique.mockResolvedValue({ theme: 'light' });
    expect(await syncThemeCookie()).toEqual({ ok: true, theme: 'light' });
    expect(m.userFindUnique).toHaveBeenCalledWith({
      where: { id: 'u-1' },
      select: { theme: true },
    });
    expect(m.cookieSet).toHaveBeenCalledWith('nx-theme', 'light', expect.any(Object));
  });
});
