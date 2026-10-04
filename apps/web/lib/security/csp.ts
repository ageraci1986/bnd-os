/**
 * Content-Security-Policy (CLAUDE.md §4.6) — fonction pure, appelée par
 * `middleware.ts` à chaque requête avec un nonce frais. Extraite pour être
 * testable (Edge-safe : aucune dépendance).
 *
 * `'strict-dynamic'` is required so that the nonced framework scripts
 * can in turn load Next.js's chunk files without each one needing its
 * own nonce. Without it, the bootstrap nonce only covers the inline
 * tags themselves and every dynamic import is rejected by the browser.
 */
export function buildCsp({
  nonce,
  supabaseHost,
  isProd,
}: {
  readonly nonce: string;
  readonly supabaseHost: string;
  readonly isProd: boolean;
}): string {
  return [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${isProd ? '' : "'unsafe-eval'"}`.trim(),
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
    `img-src 'self' data: blob: https:`,
    `font-src 'self' https://fonts.gstatic.com`,
    `connect-src 'self' https://${supabaseHost} wss://${supabaseHost} https://*.ingest.sentry.io`,
    // Card attachments (lot C): videos stream from short-lived Supabase
    // signed URLs; PDFs are previewed from a local blob: (typed
    // application/pdf) in an iframe. `frame-ancestors` (below) still forbids
    // anyone from framing OUR pages — frame-src only governs what we embed.
    `media-src 'self' blob: https://${supabaseHost}`,
    `frame-src 'self' blob:`,
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `object-src 'none'`,
    `upgrade-insecure-requests`,
  ].join('; ');
}
