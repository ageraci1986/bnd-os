import 'server-only';
import { cookies } from 'next/headers';
import { parseThemePreference, type ThemePreference } from '@nexushub/domain';

/**
 * Cookie de rendu sans flash (spec lot B §1). Reflète `User.theme` ; seule
 * source lue par le root layout. Aucune donnée sensible.
 */
export const THEME_COOKIE = 'nx-theme';

export function themeCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  };
}

export async function readThemeCookie(): Promise<ThemePreference> {
  const store = await cookies();
  return parseThemePreference(store.get(THEME_COOKIE)?.value);
}
