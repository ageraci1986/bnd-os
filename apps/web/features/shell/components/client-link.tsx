'use client';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { ClientRow } from '@nexushub/ui';
import type { ClientColorToken } from '@nexushub/ui';
import { buildHrefWithClient, CLIENT_FILTER_PARAM } from '../lib/client-filter-url';

export interface ClientLinkProps {
  readonly slug: string;
  readonly name: string;
  readonly colorToken: ClientColorToken | string;
  readonly count?: number;
}

/**
 * Sidebar row for a client. Wraps `<ClientRow>` in a Next `<Link>` that
 * keeps the user on the current pathname but flips `?client=<slug>`.
 * `active` is computed from the URL.
 */
export function ClientLink({ slug, name, colorToken, count }: ClientLinkProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const active = searchParams.get(CLIENT_FILTER_PARAM) === slug;

  const href = buildHrefWithClient(pathname, searchParams.toString(), slug);

  return (
    <Link href={href} prefetch={false} aria-current={active ? 'true' : undefined}>
      <ClientRow
        name={name}
        colorToken={colorToken}
        {...(count !== undefined ? { count } : {})}
        active={active}
      />
    </Link>
  );
}

/** "Tous les clients" reset row at the top of the sidebar client list. */
export function AllClientsLink({ count }: { readonly count: number }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const active = !searchParams.get(CLIENT_FILTER_PARAM);

  const href = buildHrefWithClient(pathname, searchParams.toString(), null);

  return (
    <Link href={href} prefetch={false} aria-current={active ? 'true' : undefined}>
      <ClientRow name="Tous les clients" colorToken="#9CA3AF" count={count} active={active} />
    </Link>
  );
}
