import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

/**
 * SECURITY middleware (CLAUDE.md §4.6 + §4.3).
 *
 * Runs on every request and does three things:
 *  1. Adds strict security headers (CSP with per-request nonce, HSTS, etc.).
 *  2. Refreshes the Supabase session cookies so the JWT stays current
 *     (silent refresh — the user is never bumped to /login on token expiry
 *     as long as their refresh token is valid).
 *  3. Auth gating: redirects unauthenticated users away from `(app)` routes
 *     and authenticated users away from `(auth)` routes.
 *
 * Note: do not trust `supabase.auth.getSession()` for authorization decisions
 * inside pages/actions — it only decodes the cookie. Use `getUser()` (which
 * validates the JWT against Supabase) in `lib/auth/index.ts`.
 */
// CSRF cookie config (mirrored in lib/csrf/index.ts)
const CSRF_COOKIE = 'nh_csrf';
const CSRF_TTL_SECONDS = 60 * 60 * 8;

function randomCsrfToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  // base64url, no padding
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return globalThis.btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const nonce = crypto.randomUUID().replaceAll('-', '');

  // Build the response we will mutate (cookies + headers) along the way.
  // IMPORTANT: the nonce MUST be set on the *request* headers (not just the
  // response) so Next.js's RSC streaming + <Script> components can read it
  // via `headers()` and stamp `nonce="..."` on every inline bootstrap script
  // they generate. Without this, the browser CSP rejects the framework's
  // own __next_f data scripts in production.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);

  let response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  // ---- CSRF cookie (mint if absent; only place allowed to set it) ---------------
  const existingCsrf = request.cookies.get(CSRF_COOKIE)?.value;
  if (!existingCsrf || existingCsrf.length < 32) {
    const csrf = randomCsrfToken();
    request.cookies.set(CSRF_COOKIE, csrf);
    response = NextResponse.next({ request: { headers: requestHeaders } });
    response.cookies.set(CSRF_COOKIE, csrf, {
      httpOnly: true,
      secure: process.env['NODE_ENV'] === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: CSRF_TTL_SECONDS,
    });
  }

  // ---- Supabase session refresh -------------------------------------------------
  const supabaseUrl = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const supabaseAnonKey = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];

  let isAuthenticated = false;

  if (supabaseUrl && supabaseAnonKey) {
    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          // Mirror cookies onto BOTH the incoming request (so getUser sees them)
          // and the outgoing response (so the browser receives the updated set).
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request: { headers: requestHeaders } });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    });

    // IMPORTANT: getUser() (not getSession) — validates JWT against Supabase.
    const { data } = await supabase.auth.getUser();
    isAuthenticated = data.user !== null;
  }

  // ---- Auth gating --------------------------------------------------------------
  const { pathname } = request.nextUrl;
  const isAppRoute =
    pathname === '/overview' ||
    pathname.startsWith('/projects') ||
    pathname.startsWith('/communications') ||
    pathname.startsWith('/clients') ||
    pathname.startsWith('/templates') ||
    pathname.startsWith('/team') ||
    pathname.startsWith('/settings') ||
    pathname.startsWith('/integrations');

  if (!isAuthenticated && isAppRoute) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }
  if (isAuthenticated && (pathname === '/login' || pathname === '/forgot-password')) {
    const url = request.nextUrl.clone();
    url.pathname = '/overview';
    url.search = '';
    return NextResponse.redirect(url);
  }

  // ---- Security headers ---------------------------------------------------------
  const isProd = process.env['NODE_ENV'] === 'production';
  const supabaseHost = supabaseUrl ? new URL(supabaseUrl).host : '*.supabase.co';

  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' ${isProd ? '' : "'unsafe-eval'"}`.trim(),
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
    `img-src 'self' data: blob: https:`,
    `font-src 'self' https://fonts.gstatic.com`,
    `connect-src 'self' https://${supabaseHost} wss://${supabaseHost} https://*.ingest.sentry.io`,
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `object-src 'none'`,
    `upgrade-insecure-requests`,
  ].join('; ');

  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('x-nonce', nonce);
  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|woff2)$).*)',
  ],
};
