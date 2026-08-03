/**
 * CSRF protection (CLAUDE.md §4.3) — double-submit cookie pattern.
 *
 * SameSite=Lax cookies cover most CSRF surface, but we add a defense-in-depth
 * layer: a short-lived random token is set as a cookie + sent with every
 * mutating request as a hidden form field. Server compares them.
 *
 * Architecture (Next 15+):
 *  - The token is **minted in middleware.ts** (which is the only place
 *    allowed to write cookies on a normal navigation in the App Router).
 *  - `getCsrfTokenForForm()` is read-only and runs in Server Components.
 *  - `assertCsrfFromFormData()` runs at the top of every mutating Server Action.
 */
import 'server-only';
import { cookies } from 'next/headers';
import { timingSafeEqual } from '@nexushub/domain/crypto';
import { CSRF_FIELD_NAME } from './field';

export const CSRF_COOKIE = 'nh_csrf';
export const CSRF_TTL_SECONDS = 60 * 60 * 8; // 8h

// Re-export so existing server imports (server actions, pages) keep working.
// Client components must import directly from `./field` to avoid pulling in
// the server-only side-effects of this module.
export { CSRF_FIELD_NAME } from './field';

/**
 * Read the CSRF token from cookies for embedding in a form.
 * The cookie is minted by middleware.ts — this function is read-only.
 * If the cookie is missing (very rare race), we return an empty string;
 * the next form submit will then fail CSRF validation and the user is
 * prompted to refresh.
 */
export async function getCsrfTokenForForm(): Promise<string> {
  const store = await cookies();
  return store.get(CSRF_COOKIE)?.value ?? '';
}

export async function assertCsrfFromFormData(formData: FormData): Promise<void> {
  const submitted = formData.get(CSRF_FIELD_NAME);
  if (typeof submitted !== 'string' || submitted.length === 0) {
    throw new Error('CSRF: missing token');
  }
  const store = await cookies();
  const stored = store.get(CSRF_COOKIE)?.value;
  if (!stored || !timingSafeEqual(stored, submitted)) {
    throw new Error('CSRF: token mismatch');
  }
}

/** Convenience for Server Actions that accept a plain object body. */
export async function assertCsrfHeader(token: string | null | undefined): Promise<void> {
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error('CSRF: missing token');
  }
  const store = await cookies();
  const stored = store.get(CSRF_COOKIE)?.value;
  if (!stored || !timingSafeEqual(stored, token)) {
    throw new Error('CSRF: token mismatch');
  }
}

/**
 * Mirrors `randomCsrfToken()` in middleware.ts byte-for-byte (24 random
 * bytes, base64url, no padding) — kept as a separate copy rather than a
 * shared import because middleware.ts intentionally duplicates the CSRF
 * cookie config (see its own comment) to avoid pulling a `server-only`
 * module into the Edge middleware bundle. Any change here should be
 * mirrored there too.
 */
function randomCsrfToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return globalThis.btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

/**
 * Mints a fresh CSRF token and writes it to the cookie — used by
 * `GET /api/assistant/csrf` to recover a stale tab whose cookie expired
 * (TTL) or was rotated (deploy). Only callable from a Route Handler or
 * Server Action: `cookies().set()` throws outside those contexts (App
 * Router cookie-mutation rule — same reason `getCsrfTokenForForm` above is
 * read-only).
 */
export async function mintCsrfToken(): Promise<string> {
  const token = randomCsrfToken();
  const store = await cookies();
  store.set(CSRF_COOKIE, token, {
    httpOnly: true,
    secure: process.env['NODE_ENV'] === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: CSRF_TTL_SECONDS,
  });
  return token;
}
