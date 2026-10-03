import { describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: async () => store }));

import { THEME_COOKIE, readThemeCookie, themeCookieOptions } from './cookie';

describe('theme cookie', () => {
  it('reads and validates the cookie value', async () => {
    store.get.mockReturnValueOnce({ value: 'dark' });
    expect(await readThemeCookie()).toBe('dark');
    store.get.mockReturnValueOnce({ value: '"><script>' });
    expect(await readThemeCookie()).toBe('system');
    store.get.mockReturnValueOnce(undefined);
    expect(await readThemeCookie()).toBe('system');
    expect(store.get).toHaveBeenCalledWith(THEME_COOKIE);
  });

  it('uses safe cookie options', () => {
    expect(themeCookieOptions()).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
    });
  });
});
