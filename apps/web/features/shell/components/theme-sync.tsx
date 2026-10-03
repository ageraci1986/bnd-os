'use client';
import { useEffect } from 'react';
import type { ThemePreference } from '@nexushub/domain';
import { syncThemeCookie } from '@/features/settings/actions/set-theme-preference';

/**
 * Nouvel appareil (cookie absent ou périmé) : aligne <html data-theme> sur la
 * préférence du compte puis recopie la valeur DB dans le cookie.
 */
export function ThemeSync({ theme }: { theme: ThemePreference }) {
  useEffect(() => {
    if (document.documentElement.dataset['theme'] === theme) return;
    document.documentElement.dataset['theme'] = theme;
    void syncThemeCookie().catch(() => undefined);
  }, [theme]);
  return null;
}
