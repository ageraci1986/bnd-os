'use client';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { NavItem } from '@nexushub/ui';
import { buildHrefWithClient, CLIENT_FILTER_PARAM } from '../lib/client-filter-url';

export interface NavLinkProps {
  /** App pathname (e.g. /overview, /projects). */
  readonly href: string;
  readonly icon: ReactNode;
  readonly label: string;
  /** Optional unread / item count badge. */
  readonly count?: number;
  /** Highlight the count with the brand gradient ("new" tone). */
  readonly countTone?: 'neutral' | 'new';
}

/**
 * Sidebar nav row that:
 *  - lights up when the current pathname starts with `href`
 *  - preserves the active `?client=<slug>` filter when navigating
 *    (PRD §8.1 — the filter follows the user across sections)
 */
export function NavLink({ href, icon, label, count, countTone = 'neutral' }: NavLinkProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const active = pathname === href || pathname.startsWith(`${href}/`);

  const clientSlug = searchParams.get(CLIENT_FILTER_PARAM);
  const fullHref = buildHrefWithClient(href, '', clientSlug);

  return (
    <Link
      href={fullHref}
      prefetch={false}
      aria-current={active ? 'page' : undefined}
      className="block no-underline"
    >
      <NavItem
        icon={icon}
        label={label}
        active={active}
        countTone={countTone}
        {...(count !== undefined ? { count } : {})}
      />
    </Link>
  );
}
