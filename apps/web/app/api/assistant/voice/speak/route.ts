import { z } from 'zod';
import { getAuthContext } from '@/lib/auth';
import { assertCsrfHeader } from '@/lib/csrf';
import { getRateLimiter } from '@/lib/rate-limit';
import { synthesizeSpeech, TtsNotConfiguredError } from '@/lib/assistant/voice/tts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** Une phrase du chunker (MAX_CHARS=300) + marge ; borne dure spec §3. */
const BodySchema = z.object({ text: z.string().min(1).max(1000) });

export async function POST(req: Request): Promise<Response> {
  const ctx = await getAuthContext();
  if (ctx === null) {
    return Response.json({ ok: false, message: 'Non authentifié.' }, { status: 401 });
  }
  try {
    await assertCsrfHeader(req.headers.get('x-csrf-token'));
  } catch {
    return Response.json({ ok: false, message: 'CSRF invalide.' }, { status: 403 });
  }
  const limit = await getRateLimiter('assistant_voice_tts').check(ctx.userId);
  if (!limit.success) {
    return Response.json(
      { ok: false, message: 'Trop de requêtes vocales — patientez un instant.' },
      { status: 429 },
    );
  }
  const body: unknown = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ ok: false, message: 'Requête invalide.' }, { status: 400 });
  }
  try {
    const speech = await synthesizeSpeech(parsed.data.text);
    return new Response(speech.body, {
      status: 200,
      headers: { 'Content-Type': speech.contentType, 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    if (err instanceof TtsNotConfiguredError) {
      return Response.json(
        { ok: false, message: "La voix n'est pas configurée. Contactez un administrateur." },
        { status: 503 },
      );
    }
    return Response.json(
      { ok: false, message: 'Synthèse vocale indisponible — réessayez.' },
      { status: 502 },
    );
  }
}
