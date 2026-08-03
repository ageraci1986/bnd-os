import { getAuthContext } from '@/lib/auth';
import { mintCsrfToken } from '@/lib/csrf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Re-issues the CSRF cookie for a stale tab (CLAUDE.md §4.3 double-submit
 * cookie). `/assistant` is a page users keep open for hours/days — the
 * cookie expires after `CSRF_TTL_SECONDS` (8h) or gets rotated by a deploy,
 * and every mutating assistant call (chat, confirm, voice transcribe/speak)
 * then fails with a 403 "CSRF invalide." that a page reload silently fixes.
 * `fetchWithCsrfRetry` (features/assistant/lib/csrf-retry.ts) calls this
 * endpoint transparently on that specific 403 and retries once.
 *
 * No rate limiter: gated behind auth already, cheap (one
 * crypto.getRandomValues call + one cookie write), and mutates nothing but
 * the requester's own CSRF cookie — unlike `assistant_chat` (LLM calls) or
 * `assistant_voice_stt`/`assistant_voice_tts` (paid external APIs), there's
 * no cost or blast radius to budget against here.
 */
export async function GET(): Promise<Response> {
  const ctx = await getAuthContext();
  if (ctx === null) {
    return Response.json({ ok: false, message: 'Non authentifié.' }, { status: 401 });
  }
  const token = await mintCsrfToken();
  return Response.json({ ok: true, token });
}
