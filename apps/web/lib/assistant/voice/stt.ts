import 'server-only';
import { getServerEnv } from '@/lib/env';

/**
 * Seam STT (spec §2) : audio borné par le PTT → transcript. Deepgram nova-3
 * derrière une fonction unique (pattern Alfred stt.py) — mockable en test,
 * scripté en E2E. L'audio n'est JAMAIS stocké ni loggé ; la clé ne sort
 * jamais de ce module (erreurs génériques sans corps de réponse provider).
 */

export class SttNotConfiguredError extends Error {}
export class SttProviderError extends Error {}

const DEEPGRAM_URL =
  'https://api.deepgram.com/v1/listen?model=nova-3&language=multi&smart_format=true';

/** Transcript déterministe du mock E2E — le spec Playwright s'y attend. */
export const E2E_MOCK_TRANSCRIPT = 'e2e:briefing';

interface DeepgramResponse {
  results?: { channels?: { alternatives?: { transcript?: string }[] }[] };
}

export async function transcribeAudio(audio: ArrayBuffer, contentType: string): Promise<string> {
  const env = getServerEnv();
  // Garde double identique au provider Anthropic (jamais actif en production).
  if (env.ASSISTANT_E2E_MOCK === '1' && env.NODE_ENV !== 'production') {
    return E2E_MOCK_TRANSCRIPT;
  }
  if (env.DEEPGRAM_API_KEY === undefined) throw new SttNotConfiguredError('DEEPGRAM absent');
  const res = await fetch(DEEPGRAM_URL, {
    method: 'POST',
    headers: { Authorization: `Token ${env.DEEPGRAM_API_KEY}`, 'Content-Type': contentType },
    body: audio,
  });
  if (!res.ok) {
    // Statut seul — jamais le corps (peut contenir des détails de compte).
    throw new SttProviderError(`deepgram status ${String(res.status)}`);
  }
  const data = (await res.json().catch(() => null)) as DeepgramResponse | null;
  return data?.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? '';
}
