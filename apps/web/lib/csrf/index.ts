/**
 * CSRF protection (CLAUDE.md §4.3) — double-submit cookie pattern.
 *
 * SameSite=Lax cookies cover most CSRF surface, but we add a defense-in-depth
 * layer: a short-lived random token is set as a cookie + sent with every
 * mutating request as a hidden form field. Server compares them.
 *
 * Use:
 *  - `getCsrfTokenForForm()` in a Server Component to mint+stash a token and
 *    return its value to embed in a hidden `<input name="_csrf">`.
 *  - `assertCsrfFromFormData(formData)` at the top of every Server Action.
 */
import 'server-only';
import { cookies } from 'next/headers';
import { randomToken, timingSafeEqual } from '@nexushub/domain/crypto';

const CSRF_COOKIE = 'nh_csrf';
const CSRF_FIELD = '_csrf';
const CSRF_TTL_SECONDS = 60 * 60 * 8; // 8h

export const CSRF_FIELD_NAME = CSRF_FIELD;

/** Mint a token, stash it in a cookie, return the value to embed in a form. */
export async function getCsrfTokenForForm(): Promise<string> {
  const store = await cookies();
  const existing = store.get(CSRF_COOKIE)?.value;
  if (existing && existing.length >= 32) return existing;

  const token = randomToken(24);
  store.set(CSRF_COOKIE, token, {
    httpOnly: true,
    secure: process.env['NODE_ENV'] === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: CSRF_TTL_SECONDS,
  });
  return token;
}

export async function assertCsrfFromFormData(formData: FormData): Promise<void> {
  const submitted = formData.get(CSRF_FIELD);
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
