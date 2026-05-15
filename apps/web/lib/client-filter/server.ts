/**
 * Server-side helpers for the global client filter (PRD §8.1).
 *
 * The URL is the source of truth: a `?client=<slug>` param means the active
 * filter is that client. Server Components read `searchParams.client`,
 * resolve it to a row in DB (so we have the id + name + colorToken handy),
 * and pass the active client down to children.
 *
 * SECURITY:
 *  - We always look the client up via `workspaceId`, so a user cannot
 *    sneak a client from another workspace by typing its slug. RLS would
 *    refuse anyway, but we keep this defence in depth.
 */
import 'server-only';
import { prisma } from '@nexushub/db';
import { fromQueryParam, type ClientFilter, type UserScope } from '@nexushub/domain';
import { scopedClientWhere } from '@/lib/auth/scope';

export interface ResolvedClient {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly colorToken: string;
}

/** First non-array search param string (Next gives us `string | string[] | undefined`). */
export function readSearchParamString(
  value: string | readonly string[] | undefined,
): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value[0] ?? null;
  return null;
}

/** Parse the `?client=<slug>` param into a domain ClientFilter. */
export function getClientFilterFromSearchParams(
  searchParams: Record<string, string | readonly string[] | undefined>,
): ClientFilter {
  return fromQueryParam(readSearchParamString(searchParams['client']));
}

/**
 * Resolve a filter to the matching DB row, scoped to the workspace.
 * Returns null when the filter is "all" or the slug doesn't match anything
 * the user can see.
 *
 * The URL slug we recognise is the lowercased client name with spaces
 * replaced by `-` (e.g. "Acme Brands" → "acme-brands"). Stored separately
 * in the DB only for `client_channel_mappings`; for clients we recompute
 * on the fly to avoid a migration.
 */
export async function resolveActiveClient(
  filter: ClientFilter,
  workspaceId: string,
  scope?: UserScope,
): Promise<ResolvedClient | null> {
  if (filter.mode !== 'single') return null;

  const wanted = filter.clientId.toLowerCase();

  const candidates = await prisma.client.findMany({
    where: {
      workspaceId,
      deletedAt: null,
      ...(scope ? scopedClientWhere(scope) : {}),
    },
    select: { id: true, name: true, colorToken: true },
  });

  for (const c of candidates) {
    const slug = c.name.toLowerCase().replaceAll(/\s+/g, '-');
    if (slug === wanted || c.id === filter.clientId) {
      return { id: c.id, name: c.name, slug, colorToken: c.colorToken };
    }
  }
  return null;
}

/** Derive the URL slug used in `?client=<slug>` from a client name. */
export function clientSlug(name: string): string {
  return name.toLowerCase().replaceAll(/\s+/g, '-');
}
