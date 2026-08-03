/**
 * Transparent recovery from a stale CSRF cookie (CLAUDE.md §4.3
 * double-submit cookie). `/assistant` is a page users keep open for
 * hours/days: the cookie expires after 8h (`CSRF_TTL_SECONDS`,
 * lib/csrf/index.ts) or gets rotated by a deploy, and every mutating
 * assistant call then fails with 403 "CSRF invalide." until the user
 * reloads the page.
 *
 * `fetchWithCsrfRetry` performs the fetch with the current token; on a 403
 * whose JSON body actually complains about CSRF, it fetches a fresh token
 * from `GET /api/assistant/csrf`, hands it to the caller via `onNewToken`
 * (so state/refs stay in sync for the NEXT call), and retries the original
 * request exactly once with that token. Any other status — including a
 * SECOND 403 CSRF on the retried request — is returned as-is: never loops,
 * never retries more than once, never retries on unrelated failures (rate
 * limiting, auth, server errors).
 */

/** Builds the headers a call site passed in, plus the CSRF token — as a
 * plain object (not a `Headers` instance): every call site in this
 * codebase passes `init.headers` as a plain `Record<string, string>`, and
 * callers/tests read the token back the same way. */
function withCsrfHeader(init: RequestInit, token: string): RequestInit {
  return {
    ...init,
    headers: { ...(init.headers as Record<string, string> | undefined), 'x-csrf-token': token },
  };
}

/** Defensive parse: a 403 can come from any layer (rate limiter, auth,
 * a proxy) — only a body that is valid JSON with a `message` mentioning
 * "csrf" (case-insensitive) is treated as a stale-token 403. Reads a
 * clone so the original response's body stays available to the caller
 * when we decide NOT to retry. */
async function isCsrfError(res: Response): Promise<boolean> {
  try {
    const data: unknown = await res.clone().json();
    if (data !== null && typeof data === 'object' && 'message' in data) {
      const message = (data as { message?: unknown }).message;
      return typeof message === 'string' && message.toLowerCase().includes('csrf');
    }
    return false;
  } catch {
    return false;
  }
}

export async function fetchWithCsrfRetry(
  input: RequestInfo | URL,
  init: RequestInit,
  getToken: () => string,
  onNewToken: (token: string) => void,
): Promise<Response> {
  const first = await fetch(input, withCsrfHeader(init, getToken()));
  if (first.status !== 403 || !(await isCsrfError(first))) return first;

  let refreshRes: Response;
  try {
    refreshRes = await fetch('/api/assistant/csrf');
  } catch {
    return first;
  }
  if (!refreshRes.ok) return first;

  const payload = (await refreshRes.json().catch(() => null)) as { token?: unknown } | null;
  const newToken = payload?.token;
  if (typeof newToken !== 'string' || newToken === '') return first;

  onNewToken(newToken);
  return fetch(input, withCsrfHeader(init, newToken));
}
