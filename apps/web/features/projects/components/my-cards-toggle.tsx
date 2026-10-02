'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/**
 * Bascule « Mes cartes » → `?mine=1`. Le serveur traduit `mine` en
 * `assignees.some({ userId: <session> })` ; l'URL ne porte jamais d'id.
 * Partagée par la barre de filtres projet et le calendrier global.
 */
export function MyCardsToggle() {
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const searchParams = useSearchParams();
  const on = searchParams?.get('mine') === '1';

  const toggle = () => {
    const next = new URLSearchParams(searchParams?.toString() ?? '');
    if (on) next.delete('mine');
    else next.set('mine', '1');
    const qs = next.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false });
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={on}
      className={['nx-filter-trigger', on && 'has-active'].filter(Boolean).join(' ')}
    >
      <svg
        aria-hidden="true"
        width={12}
        height={12}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ display: 'block' }}
      >
        <circle cx="12" cy="8" r="3.5" />
        <path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6" />
      </svg>
      Mes cartes
    </button>
  );
}
