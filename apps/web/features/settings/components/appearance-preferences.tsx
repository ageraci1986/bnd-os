'use client';
import { useState, useTransition } from 'react';
import type { ThemePreference } from '@nexushub/domain';
import { notify } from '@/features/shell/components/toaster';
import { setThemePreference } from '../actions/set-theme-preference';

const OPTIONS: readonly { value: ThemePreference; label: string; hint: string }[] = [
  { value: 'system', label: 'Système', hint: 'Suit le réglage de votre ordinateur' },
  { value: 'light', label: 'Clair', hint: 'Toujours clair' },
  { value: 'dark', label: 'Sombre', hint: 'Toujours sombre' },
];

/** Settings → Apparence (spec lot B §3). Sauvegarde automatique + toast (ADR #10). */
export function AppearancePreferences({ theme }: { theme: ThemePreference }) {
  const [value, setValue] = useState<ThemePreference>(theme);
  const [, startTransition] = useTransition();

  const choose = (next: ThemePreference) => {
    if (next === value) return;
    const previous = value;
    setValue(next);
    document.documentElement.dataset['theme'] = next;
    startTransition(async () => {
      const res = await setThemePreference(next).catch(() => null);
      if (res?.ok) {
        notify({ tone: 'success', message: 'Thème enregistré.' });
      } else {
        setValue(previous);
        document.documentElement.dataset['theme'] = previous;
        notify({ tone: 'error', message: res?.message ?? 'Impossible d’enregistrer le thème.' });
      }
    });
  };

  return (
    <section className="rounded-xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-5">
      <h2 id="appearance-title" className="text-base font-bold">
        Apparence
      </h2>
      <p className="mt-1 text-xs text-[color:var(--color-text-muted)]">Thème de l’interface.</p>
      <div
        role="radiogroup"
        aria-labelledby="appearance-title"
        className="mt-3 flex flex-wrap gap-2"
      >
        {OPTIONS.map((o) => (
          <label
            key={o.value}
            className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
              value === o.value
                ? 'border-[color:var(--color-accent-primary)] text-[color:var(--color-text-main)]'
                : 'border-[color:var(--color-border-light)] text-[color:var(--color-text-soft)]'
            }`}
            title={o.hint}
          >
            <input
              type="radio"
              name="theme"
              value={o.value}
              checked={value === o.value}
              onChange={() => choose(o.value)}
            />
            {o.label}
          </label>
        ))}
      </div>
    </section>
  );
}
