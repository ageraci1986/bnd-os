/**
 * URL helpers for the global client filter — usable from BOTH server
 * components (composing <Link href>) and client components (router.replace).
 * No 'server-only' here on purpose.
 *
 * The filter lives in `?client=<slug>`. We always preserve any other
 * existing search params so navigating between sections doesn't accidentally
 * drop UI state (sort, page, etc).
 */

const CLIENT_PARAM = 'client';

export function buildHrefWithClient(
  pathname: string,
  currentSearch: URLSearchParams | string | null | undefined,
  clientSlug: string | null,
): string {
  const params = new URLSearchParams(
    currentSearch instanceof URLSearchParams ? currentSearch.toString() : (currentSearch ?? ''),
  );

  if (clientSlug) {
    params.set(CLIENT_PARAM, clientSlug);
  } else {
    params.delete(CLIENT_PARAM);
  }

  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

export const CLIENT_FILTER_PARAM = CLIENT_PARAM;

/** URL slug used in `?client=<slug>`: lowercased name, whitespace → `-`. */
export function clientSlugFromName(name: string): string {
  return name.toLowerCase().replaceAll(/\s+/g, '-');
}

/**
 * True when a `?client=` filter is active and targets a different client
 * than `client` (matched by slug, case-insensitive, or by id — the same
 * rules as the server-side resolver). Project pages use it to leave a
 * project the active filter excludes (PRD §8.1: every view recomposes).
 */
export function isOutsideClientFilter(
  filter: string | null,
  client: { readonly id: string; readonly name: string },
): boolean {
  if (!filter) return false;
  return filter.toLowerCase() !== clientSlugFromName(client.name) && filter !== client.id;
}
