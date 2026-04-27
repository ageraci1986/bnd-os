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
