'use client';
import { usePathname, useSearchParams } from 'next/navigation';
import { ContextBar } from '@nexushub/ui';
import { ClientFilterChip } from './client-filter-chip';
import { pathnameToLabel } from '../lib/breadcrumb';
import { CLIENT_FILTER_PARAM } from '../lib/client-filter-url';

export interface ContextBarClient {
  readonly slug: string;
  readonly name: string;
  readonly colorToken: string;
}

export interface ContextBarHostProps {
  readonly workspaceName: string;
  /** Clients the user can filter on (same list as the sidebar). */
  readonly clients: readonly ContextBarClient[];
}

/**
 * Wires the pure `<ContextBar>` to the current pathname (for the
 * breadcrumb) and the search params (for the client filter chip).
 *
 * The active client is resolved here from `?client=` rather than in the
 * app layout: Next.js never passes `searchParams` to layouts, so a
 * server-side lookup there always saw "no filter" (PRD §8.1 — the chip
 * must stay visible while the filter is active).
 */
export function ContextBarHost({ workspaceName, clients }: ContextBarHostProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const label = pathnameToLabel(pathname);
  const slug = searchParams.get(CLIENT_FILTER_PARAM);
  const active = slug ? (clients.find((c) => c.slug === slug) ?? null) : null;

  return (
    <ContextBar
      crumbs={[{ label: workspaceName }, { label, current: true }]}
      right={
        <ClientFilterChip
          active={active ? { name: active.name, colorToken: active.colorToken } : null}
          totalClients={clients.length}
        />
      }
    />
  );
}
