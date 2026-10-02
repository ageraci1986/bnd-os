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
      <span aria-hidden="true">👤</span>
      Mes cartes
    </button>
  );
}
