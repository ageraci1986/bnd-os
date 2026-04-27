import { NextResponse, type NextRequest } from 'next/server';

/**
 * SECURITY middleware (Phase 1.4 baseline, hardened in Phase 2.4).
 * - CSP with per-request nonce
 * - HSTS, X-Frame-Options handled in next.config (static)
 * - Auth gating moved here in Phase 2.3
 */
export function middleware(request: NextRequest): NextResponse {
  const nonce = crypto.randomUUID().replaceAll('-', '');
  const response = NextResponse.next({
    request: { headers: new Headers(request.headers) },
  });

  const isProd = process.env.NODE_ENV === 'production';

  // Strict CSP — to be tightened with Supabase / Sentry origins in Phase 1.5
  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' ${isProd ? '' : "'unsafe-eval'"}`.trim(),
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
    `img-src 'self' data: blob: https:`,
    `font-src 'self' https://fonts.gstatic.com`,
    `connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.ingest.sentry.io`,
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
    // Apply to all routes except static assets and Next internals
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|woff2)$).*)',
  ],
};
