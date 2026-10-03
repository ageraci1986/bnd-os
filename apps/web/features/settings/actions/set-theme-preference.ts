'use server';
import 'server-only';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@nexushub/db';
import { THEME_PREFERENCES, type ThemePreference } from '@nexushub/domain';
import { requireUser } from '@/lib/auth';
import { THEME_COOKIE, themeCookieOptions } from '@/lib/theme/cookie';

/**
 * Préférence de thème (spec lot B §3). Action JSON appelée par un composant
 * client same-origin (même convention que `updateAssistantPreferences`) ;
 * l'utilisateur provient exclusivement de la session.
 */
const ThemeSchema = z.enum(THEME_PREFERENCES);

export type SetThemePreferenceResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

export async function setThemePreference(
  theme: ThemePreference,
): Promise<SetThemePreferenceResult> {
  const parsed = ThemeSchema.safeParse(theme);
  if (!parsed.success) return { ok: false, message: 'Thème invalide.' };

  const ctx = await requireUser();
  await prisma.user.update({ where: { id: ctx.userId }, data: { theme: parsed.data } });

  const store = await cookies();
  store.set(THEME_COOKIE, parsed.data, themeCookieOptions());
  revalidatePath('/settings');
  return { ok: true };
}

/**
 * Nouvel appareil : recopie la préférence du compte dans le cookie. Ne prend
 * AUCUNE entrée client — la valeur vient de la DB.
 */
export async function syncThemeCookie(): Promise<{ ok: true; theme: ThemePreference }> {
  const ctx = await requireUser();
  const user = await prisma.user.findUnique({ where: { id: ctx.userId }, select: { theme: true } });
  const theme = user?.theme ?? 'system';
  const store = await cookies();
  store.set(THEME_COOKIE, theme, themeCookieOptions());
  return { ok: true, theme };
}
