'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ContextChip } from '@nexushub/ui';
import { buildHrefWithClient } from '../lib/client-filter-url';

export interface ClientFilterChipProps {
  /** Active client info, or null when filter is "all". */
  readonly active: { readonly name: string; readonly colorToken: string } | null;
  /** Total active clients count to display when no filter is active. */
  readonly totalClients: number;
}

/**
 * Header chip showing the current client filter (PRD §8.1).
 * - When `active` is null → "Tous les clients · N actifs", no clear button.
 * - When `active` is set → coloured dot + name + × button to reset the
 *   filter (uses `router.replace` to update the URL without a history push).
 */
export function ClientFilterChip({ active, totalClients }: ClientFilterChipProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (!active) {
    return (
      <ContextChip
        label={`Tous les clients · ${totalClients} actif${totalClients > 1 ? 's' : ''}`}
      />
    );
  }

  return (
    <ContextChip
      label={active.name}
      colorToken={active.colorToken}
      active
      onClear={() => {
        const href = buildHrefWithClient(pathname, searchParams.toString(), null);
        router.replace(href, { scroll: false });
      }}
    />
  );
}
