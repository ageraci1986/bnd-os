'use client';
import { usePathname } from 'next/navigation';
import { ContextBar } from '@nexushub/ui';
import { ClientFilterChip } from './client-filter-chip';
import { pathnameToLabel } from '../lib/breadcrumb';

export interface ContextBarHostProps {
  readonly workspaceName: string;
  readonly activeClient: { readonly name: string; readonly colorToken: string } | null;
  readonly totalClients: number;
}

/**
 * Wires the pure `<ContextBar>` to the current pathname (for the
 * breadcrumb) and the search params (for the client filter chip).
 */
export function ContextBarHost({ workspaceName, activeClient, totalClients }: ContextBarHostProps) {
  const pathname = usePathname();
  const label = pathnameToLabel(pathname);

  return (
    <ContextBar
      crumbs={[{ label: workspaceName }, { label, current: true }]}
      right={<ClientFilterChip active={activeClient} totalClients={totalClients} />}
    />
  );
}
