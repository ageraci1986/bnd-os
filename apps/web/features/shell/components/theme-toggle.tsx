'use client';
import { useEffect, useState, useTransition } from 'react';
import { oppositeTheme, parseThemePreference, type EffectiveTheme } from '@nexushub/domain';
import { setThemePreference } from '@/features/settings/actions/set-theme-preference';
import { notify } from '@/features/shell/components/toaster';

function effectiveTheme(): EffectiveTheme {
  const pref = parseThemePreference(document.documentElement.dataset['theme']);
  if (pref !== 'system') return pref;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Bascule rapide clair/sombre de la topbar (spec lot B §3). Application
 * immédiate sur <html>, puis persistance (DB + cookie) ; rollback si échec.
 */
export function ThemeToggle() {
  const [current, setCurrent] = useState<EffectiveTheme>('light');
  const [, startTransition] = useTransition();

  useEffect(() => setCurrent(effectiveTheme()), []);

  const toggle = () => {
    const previousAttr = document.documentElement.dataset['theme'] ?? 'system';
    const next = oppositeTheme(effectiveTheme());
    document.documentElement.dataset['theme'] = next;
    setCurrent(next);
    startTransition(async () => {
      const res = await setThemePreference(next).catch(() => null);
      if (!res || !res.ok) {
        document.documentElement.dataset['theme'] = previousAttr;
        setCurrent(effectiveTheme());
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
