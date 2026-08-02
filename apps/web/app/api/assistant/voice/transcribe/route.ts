import { getAuthContext } from '@/lib/auth';
import { assertCsrfHeader } from '@/lib/csrf';
import { getRateLimiter } from '@/lib/rate-limit';
import { SttNotConfiguredError, transcribeAudio } from '@/lib/assistant/voice/stt';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** 60 s d'opus ~ 0,5-1 Mo ; 2 Mo = marge large sans DoS mémoire (spec §2). */
const MAX_AUDIO_BYTES = 2_000_000;
const AUDIO_TYPES = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav'];

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
  const limit = await getRateLimiter('assistant_voice_stt').check(ctx.userId);
  if (!limit.success) {
    return Response.json(
      { ok: false, message: 'Trop de requêtes vocales — patientez un instant.' },
      { status: 429 },
    );
  }
  // `audio/webm;codecs=opus` → comparaison sur le type nu, avant le `;`.
  const contentType = (req.headers.get('content-type') ?? '').split(';')[0]?.trim() ?? '';
  if (!AUDIO_TYPES.includes(contentType)) {
    return Response.json(
      { ok: false, message: 'Format audio non pris en charge.' },
      { status: 415 },
    );
  }
  // Pré-check Content-Length AVANT de lire le corps : défense en profondeur
  // si l'on quitte un jour le cap plateforme Vercel (~4,5 Mo). L'en-tête peut
  // être absent ou forgé — le check post-lecture ci-dessous reste la vérité.
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_AUDIO_BYTES) {
    return Response.json({ ok: false, message: 'Enregistrement trop long.' }, { status: 413 });
  }
  const audio = await req.arrayBuffer();
  if (audio.byteLength === 0) {
    return Response.json({ ok: false, message: 'Audio vide.' }, { status: 400 });
  }
  if (audio.byteLength > MAX_AUDIO_BYTES) {
    return Response.json({ ok: false, message: 'Enregistrement trop long.' }, { status: 413 });
  }
  try {
    const transcript = await transcribeAudio(audio, contentType);
    return Response.json({ ok: true, transcript });
  } catch (err) {
    if (err instanceof SttNotConfiguredError) {
      return Response.json(
        { ok: false, message: "La voix n'est pas configurée. Contactez un administrateur." },
        { status: 503 },
      );
    }
    // Générique : jamais le détail provider (peut évoquer clé/compte).
    return Response.json(
      { ok: false, message: 'Transcription indisponible — réessayez.' },
      { status: 502 },
    );
  }
}
