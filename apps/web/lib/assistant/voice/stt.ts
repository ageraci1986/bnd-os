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

const DEEPGRAM_LISTEN_URL = 'https://api.deepgram.com/v1/listen';

/**
 * Borne par requête. Deux envois au pire (réessai sans termes) restent sous
 * le `maxDuration = 30` de la route.
 */
const REQUEST_TIMEOUT_MS = 12_000;

/**
 * `keyterm` se répète (un paramètre par terme). Les termes sont les noms
 * propres du workspace, déjà nettoyés et bornés par `toKeyterms` (domain).
 */
function buildListenUrl(keyterms: readonly string[]): string {
  const params = new URLSearchParams({
    model: 'nova-3',
    language: 'multi',
    smart_format: 'true',
  });
  for (const term of keyterms) params.append('keyterm', term);
  return `${DEEPGRAM_LISTEN_URL}?${params.toString()}`;
}

/** Transcript déterministe du mock E2E — le spec Playwright s'y attend. */
export const E2E_MOCK_TRANSCRIPT = 'e2e:briefing';

interface DeepgramResponse {
  results?: { channels?: { alternatives?: { transcript?: string }[] }[] };
}

export async function transcribeAudio(
  audio: ArrayBuffer,
  contentType: string,
  keyterms: readonly string[] = [],
): Promise<string> {
  const env = getServerEnv();
  // Garde double identique au provider Anthropic (jamais actif en production).
  if (env.ASSISTANT_E2E_MOCK === '1' && env.NODE_ENV !== 'production') {
    return E2E_MOCK_TRANSCRIPT;
  }
  if (env.DEEPGRAM_API_KEY === undefined) throw new SttNotConfiguredError('DEEPGRAM absent');
  const apiKey = env.DEEPGRAM_API_KEY;
  const send = (terms: readonly string[]): Promise<Response> =>
    fetch(buildListenUrl(terms), {
      method: 'POST',
      headers: { Authorization: `Token ${apiKey}`, 'Content-Type': contentType },
      body: audio,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

  let res = await send(keyterms);
  // Le glossaire ne doit JAMAIS casser la transcription : si Deepgram refuse
  // les TERMES (ex. plafond de 500 tokens dépassé), on réessaie une fois sans
  // eux. Le corps du 400 est lu ici uniquement pour reconnaître ce cas — il
  // n'est ni relayé ni loggé. Un 400 sans rapport (audio illisible) n'est pas
  // réessayé : il échouerait pareil, en doublant l'envoi.
  if (res.status === 400 && keyterms.length > 0) {
    const reason = await res.text().catch(() => '');
    if (/keyterm/i.test(reason)) {
      // Signal sans PII : le nombre de termes, jamais les termes.
      console.warn('[assistant] stt keyterms rejected', { count: keyterms.length });
      res = await send([]);
    }
  }
  if (!res.ok) {
    // Statut seul — jamais le corps (détails de compte) ni l'URL (noms propres).
    throw new SttProviderError(`deepgram status ${String(res.status)}`);
  }
  const data = (await res.json().catch(() => null)) as DeepgramResponse | null;
  return data?.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? '';
}
