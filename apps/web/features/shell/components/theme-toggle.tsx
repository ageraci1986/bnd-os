'use client';
import { useSyncExternalStore, useTransition } from 'react';
import { oppositeTheme, parseThemePreference, type EffectiveTheme } from '@nexushub/domain';
import { setThemePreference } from '@/features/settings/actions/set-theme-preference';
import { notify } from '@/features/shell/components/toaster';

const DARK_QUERY = '(prefers-color-scheme: dark)';

function effectiveTheme(): EffectiveTheme {
  const pref = parseThemePreference(document.documentElement.dataset['theme']);
  if (pref !== 'system') return pref;
  return window.matchMedia?.(DARK_QUERY).matches ? 'dark' : 'light';
}

/** Notifie quand data-theme change (Settings, ThemeSync, toggle) ou quand
 *  l'OS bascule (pertinent en mode system). */
function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
  const mql = window.matchMedia?.(DARK_QUERY);
  mql?.addEventListener?.('change', onChange);
  return () => {
    observer.disconnect();
    mql?.removeEventListener?.('change', onChange);
  };
}

const getServerSnapshot = (): EffectiveTheme => 'light';

/**
 * Bascule rapide clair/sombre de la topbar (spec lot B §3). Application
 * immédiate sur <html>, puis persistance (DB + cookie) ; rollback si échec.
 * L'état affiché est dérivé du DOM (source de vérité unique) : il suit
 * donc les changements faits ailleurs et les bascules de l'OS.
 */
export function ThemeToggle() {
  const current = useSyncExternalStore(subscribe, effectiveTheme, getServerSnapshot);
  const [, startTransition] = useTransition();

  const toggle = () => {
    const previousAttr = document.documentElement.dataset['theme'] ?? 'system';
    const next = oppositeTheme(effectiveTheme());
    document.documentElement.dataset['theme'] = next;
    startTransition(async () => {
      const res = await setThemePreference(next).catch(() => null);
      if (!res || !res.ok) {
        document.documentElement.dataset['theme'] = previousAttr;
        notify({ tone: 'error', message: 'Impossible d’enregistrer le thème.' });
      }
    });
  };

  const label = current === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre';
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className="btn btn-ghost btn-sm"
    >
      {current === 'dark' ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

function SunIcon() {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}
