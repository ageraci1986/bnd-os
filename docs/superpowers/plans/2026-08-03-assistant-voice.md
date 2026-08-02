# Assistant Voice Mode (V1.5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter le mode voix push-to-talk (⌥ Option / micro maintenu) à la page /assistant : Deepgram nova-3 pour la transcription, ElevenLabs flash pour la synthèse phrase par phrase, sortie symétrique, interruption, et confirmation vocale des actions gated par motifs stricts.

**Architecture:** « Alfred web » — le PTT borne l'énoncé côté client (MediaRecorder), une route serveur proxifie Deepgram (REST) et renvoie le transcript qui entre dans la boucle SSE existante **inchangée** ; les deltas texte sont découpés en phrases (chunker pur TS dans `@nexushub/agent`) et vocalisés via une route serveur qui proxifie le stream ElevenLabs. Clés 100 % serveur. Spec validée : `docs/superpowers/specs/2026-08-03-assistant-voice-design.md`.

**Tech Stack:** Next.js 15 route handlers (fetch natif vers Deepgram/ElevenLabs — **aucune nouvelle dépendance npm**), MediaRecorder + Web Audio côté client, Upstash rate limit, Vitest, Playwright (fake media), Storybook.

**Conventions du repo à respecter (rappel) :**

- Branche : `feat/assistant-voice` (worktree `.claude/worktrees/assistant-agent`). Commits Conventional (`feat(assistant): …` — scope autorisé : `assistant`).
- TS strict + `exactOptionalPropertyTypes` : ne jamais passer `{ foo: undefined }` à une prop optionnelle — omettre la clé.
- `packages/agent` : couverture **100 %** obligatoire (`pnpm --filter @nexushub/agent test` la vérifie).
- Textes UI : le composant assistant existant est en français inline (pas de next-intl sur cette page — dette globale connue). Les nouveaux libellés suivent ce pattern FR inline.
- Aucune clé/API key dans le code, les logs, les messages d'erreur. Les clés réelles seront fournies par Angelo (ne JAMAIS inventer de valeur).
- Commandes : lancer depuis la racine du worktree. Tests web : `pnpm --filter @nexushub/web test -- <fichier>`. Typecheck : `pnpm --filter @nexushub/web typecheck` (et `pnpm typecheck` global avant PR).

**Structure de fichiers (vue d'ensemble) :**

| Fichier                                                                     | Rôle                                                                 |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `packages/agent/src/sentence-chunker.ts` (+ test)                           | Découpage de deltas texte en phrases prêtes à vocaliser (pur, 100 %) |
| `packages/agent/src/voice-confirm.ts` (+ test)                              | Matching strict oui/non pour la confirmation vocale (pur, 100 %)     |
| `apps/web/lib/assistant/voice/stt.ts` (+ test)                              | Seam Deepgram (fetch) + mock E2E                                     |
| `apps/web/lib/assistant/voice/tts.ts` (+ test)                              | Seam ElevenLabs (fetch stream) + mock E2E (WAV silencieux)           |
| `apps/web/app/api/assistant/voice/transcribe/route.ts` (+ test)             | POST audio → `{ transcript }`                                        |
| `apps/web/app/api/assistant/voice/speak/route.ts` (+ test)                  | POST `{ text }` → stream audio                                       |
| `apps/web/features/assistant/hooks/use-voice-recorder.ts` (+ test)          | getUserMedia + MediaRecorder + borne 60 s                            |
| `apps/web/features/assistant/hooks/use-speech-queue.ts` (+ test)            | File de lecture Web Audio séquentielle, annulable                    |
| `apps/web/features/assistant/components/voice-capsule.tsx` (+ test + story) | Capsule d'état voix (écoute / transcription / parole)                |
| `apps/web/features/assistant/components/assistant-orb.tsx` (modif)          | `deriveOrbActivity` gagne `listening`                                |
| `apps/web/features/assistant/components/assistant-chat.tsx` (modif)         | Intégration PTT + micro + TTS symétrique + confirmation vocale       |
| `apps/web/lib/rate-limit/index.ts` (modif)                                  | Clés `assistant_voice_stt` / `assistant_voice_tts`                   |
| `apps/web/lib/env.ts` + `.env.example` (modif)                              | `DEEPGRAM_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`      |
| `e2e/tests/assistant-voice.spec.ts` + `e2e/playwright.config.ts` (modif)    | Parcours PTT mocké (fake media)                                      |

---

### Task 1: Sentence chunker (packages/agent)

Découpe un flux de deltas texte en phrases complètes à vocaliser. Inspiré de `chunker.py` d'Alfred. Pur TS, zéro dépendance.

**Files:**

- Create: `packages/agent/src/sentence-chunker.ts`
- Create: `packages/agent/src/sentence-chunker.test.ts`
- Modify: `packages/agent/src/index.ts` (export)

- [ ] **Step 1: Write the failing test**

```ts
// packages/agent/src/sentence-chunker.test.ts
import { describe, expect, it } from 'vitest';
import { SentenceChunker } from './sentence-chunker';

describe('SentenceChunker', () => {
  it('émet une phrase quand un délimiteur suivi d’espace arrive', () => {
    const c = new SentenceChunker();
    expect(c.push('Bonjour Angelo. ')).toEqual(['Bonjour Angelo.']);
  });

  it('accumule tant que la phrase n’est pas terminée', () => {
    const c = new SentenceChunker();
    expect(c.push('La carte a été ')).toEqual([]);
    expect(c.push('déplacée. Ensuite')).toEqual(['La carte a été déplacée.']);
    expect(c.flush()).toBe('Ensuite');
  });

  it('fusionne les fragments trop courts avec la phrase suivante (MIN_CHARS)', () => {
    const c = new SentenceChunker();
    // « Ok. » (3 chars) < MIN_CHARS → retenu jusqu'à la phrase suivante
    expect(c.push('Ok. ')).toEqual([]);
    expect(c.push('La facture Acme est envoyée. ')).toEqual(['Ok. La facture Acme est envoyée.']);
  });

  it('gère ! ? … et les sauts de ligne comme délimiteurs', () => {
    const c = new SentenceChunker();
    expect(c.push('Terminé !\nDeux cartes restent en cours… Voilà. ')).toEqual([
      'Terminé !',
      'Deux cartes restent en cours…',
      'Voilà.',
    ]);
  });

  it('découpe une phrase interminable au-delà de MAX_CHARS', () => {
    const c = new SentenceChunker();
    const long = 'mot '.repeat(120); // 480 chars sans délimiteur
    const out = c.push(long);
    expect(out.length).toBeGreaterThan(0);
    for (const s of out) expect(s.length).toBeLessThanOrEqual(300);
  });

  it('flush() renvoie le reliquat et vide le buffer', () => {
    const c = new SentenceChunker();
    c.push('Une fin sans point');
    expect(c.flush()).toBe('Une fin sans point');
    expect(c.flush()).toBe('');
  });

  it('ignore le markdown de mise en forme pour la voix (gras, puces)', () => {
    const c = new SentenceChunker();
    expect(c.push('**Fait.** Voici la - liste. ')).toEqual(['Fait.', 'Voici la liste.']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @nexushub/agent test -- sentence-chunker`
Expected: FAIL — `Cannot find module './sentence-chunker'`

- [ ] **Step 3: Write the implementation**

```ts
// packages/agent/src/sentence-chunker.ts
/**
 * Découpe un flux de deltas texte (SSE) en phrases prêtes à vocaliser.
 * Port du pattern `chunker.py` d'Alfred : on n'envoie au TTS que des phrases
 * complètes — la première phrase part dès qu'elle est finie, sans attendre la
 * fin de la réponse.
 *
 * Invariants :
 *  - une « phrase » se termine par . ! ? … ou un saut de ligne, suivi
 *    d'un blanc (ou de la fin du buffer au flush) ;
 *  - un fragment < MIN_CHARS est fusionné avec la phrase suivante (évite de
 *    vocaliser « Ok. » seul avec un aller-retour réseau dédié) ;
 *  - au-delà de MAX_CHARS sans délimiteur, on coupe au dernier espace (évite
 *    de dépasser la limite de la route /speak sur une énumération sans point) ;
 *  - le markdown de mise en forme (gras, italique, puces) est retiré — il n'a
 *    aucun sens à l'oral.
 */

const MIN_CHARS = 8;
const MAX_CHARS = 300;
const BOUNDARY = /([.!?…\n])(\s+)/;

/** Retire la mise en forme markdown inutile à l'oral (gras/italique/puces/backticks). */
function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/\*([^*]*)\*/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(^|\s)[-•]\s+/g, '$1');
}

export class SentenceChunker {
  private buffer = '';

  /** Ajoute un delta ; renvoie les phrases complètes détectées (0..n). */
  push(delta: string): string[] {
    this.buffer += delta;
    const out: string[] = [];
    let pending = '';
    for (;;) {
      const match = BOUNDARY.exec(this.buffer);
      if (match === null) break;
      const end = match.index + match[1].length;
      const raw = (pending + this.buffer.slice(0, end)).trim();
      this.buffer = this.buffer.slice(end + match[2].length);
      const sentence = stripMarkdown(raw).trim();
      if (sentence === '') continue;
      if (sentence.length < MIN_CHARS) {
        // Fragment court : re-préfixé à la phrase suivante.
        pending = `${sentence} `;
        continue;
      }
      pending = '';
      out.push(sentence);
    }
    if (pending !== '') this.buffer = pending + this.buffer;
    // Garde-fou : buffer interminable sans délimiteur → coupe au dernier espace.
    while (this.buffer.length > MAX_CHARS) {
      const cut = this.buffer.lastIndexOf(' ', MAX_CHARS);
      const at = cut > 0 ? cut : MAX_CHARS;
      const sentence = stripMarkdown(this.buffer.slice(0, at)).trim();
      this.buffer = this.buffer.slice(at + (cut > 0 ? 1 : 0));
      if (sentence !== '') out.push(sentence);
    }
    return out;
  }

  /** Renvoie le reliquat (fin de réponse sans délimiteur) et vide le buffer. */
  flush(): string {
    const rest = stripMarkdown(this.buffer).trim();
    this.buffer = '';
    return rest;
  }
}
```

- [ ] **Step 4: Export from the package index**

In `packages/agent/src/index.ts`, add at the end:

```ts
export { SentenceChunker } from './sentence-chunker';
```

- [ ] **Step 5: Run tests to verify they pass (100 % coverage required)**

Run: `pnpm --filter @nexushub/agent test`
Expected: PASS, coverage 100 % (le seuil du package est configuré dans son vitest.config.ts — un manque de branche fait échouer la commande). If a branch is uncovered, add a test — do NOT lower the threshold.

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/sentence-chunker.ts packages/agent/src/sentence-chunker.test.ts packages/agent/src/index.ts
git commit -m "feat(agent): sentence chunker for voice TTS streaming"
```

---

### Task 2: Voice confirm matcher (packages/agent)

Matching **strict et déterministe** (spec §4) d'un transcript vers Autoriser/Refuser. Aucune interprétation LLM.

**Files:**

- Create: `packages/agent/src/voice-confirm.ts`
- Create: `packages/agent/src/voice-confirm.test.ts`
- Modify: `packages/agent/src/index.ts` (export)

- [ ] **Step 1: Write the failing test**

```ts
// packages/agent/src/voice-confirm.test.ts
import { describe, expect, it } from 'vitest';
import { matchVoiceConfirm } from './voice-confirm';

describe('matchVoiceConfirm', () => {
  it.each([
    'oui',
    'Oui.',
    'OUI !',
    'autorise',
    'valide',
    'envoie',
    'confirme',
    'go',
    'yes',
    'confirm',
    'send',
    'approve',
  ])('accepte « %s » → allow', (t) => expect(matchVoiceConfirm(t)).toBe('allow'));

  it.each(['non', 'Non.', 'refuse', 'annule', 'stop', 'no', 'cancel', 'deny'])(
    'accepte « %s » → deny',
    (t) => expect(matchVoiceConfirm(t)).toBe('deny'),
  );

  it.each([
    'euh oui enfin attends',
    'oui envoie le mail', // plusieurs mots hors motifs exacts composés → ambigu
    'je ne sais pas',
    'ouais',
    '',
    '   ',
    'noui',
  ])('rejette « %s » → null (ambigu)', (t) => expect(matchVoiceConfirm(t)).toBeNull());

  it('accepte les motifs composés exacts', () => {
    expect(matchVoiceConfirm('oui envoie')).toBe('allow');
    expect(matchVoiceConfirm('non annule')).toBe('deny');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @nexushub/agent test -- voice-confirm`
Expected: FAIL — `Cannot find module './voice-confirm'`

- [ ] **Step 3: Write the implementation**

```ts
// packages/agent/src/voice-confirm.ts
/**
 * Confirmation vocale des actions gated (spec §4) : matching STRICT d'un
 * transcript vers allow/deny. Normalisation casse + ponctuation, puis
 * correspondance EXACTE contre des listes fermées. Tout le reste → null
 * (l'appelant redemande ou laisse le widget cliquable). Aucun LLM ici :
 * pas de faux positif possible sur une action irréversible.
 */

export type VoiceConfirmIntent = 'allow' | 'deny';

const ALLOW = new Set([
  'oui',
  'autorise',
  'valide',
  'envoie',
  'confirme',
  'go',
  'oui envoie',
  'oui autorise',
  'oui valide',
  'oui confirme',
  'yes',
  'confirm',
  'send',
  'approve',
  'yes send',
]);

const DENY = new Set([
  'non',
  'refuse',
  'annule',
  'stop',
  'non annule',
  'non refuse',
  'no',
  'cancel',
  'deny',
  'no cancel',
]);

/** Minuscule, ponctuation retirée, espaces normalisés. Les accents sont conservés. */
function normalize(transcript: string): string {
  return transcript
    .toLowerCase()
    .replace(/[.,;:!?…'"«»()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function matchVoiceConfirm(transcript: string): VoiceConfirmIntent | null {
  const t = normalize(transcript);
  if (ALLOW.has(t)) return 'allow';
  if (DENY.has(t)) return 'deny';
  return null;
}
```

- [ ] **Step 4: Export from the package index**

In `packages/agent/src/index.ts`, add:

```ts
export { matchVoiceConfirm, type VoiceConfirmIntent } from './voice-confirm';
```

- [ ] **Step 5: Run tests (coverage 100 %)**

Run: `pnpm --filter @nexushub/agent test`
Expected: PASS, 100 %.

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/voice-confirm.ts packages/agent/src/voice-confirm.test.ts packages/agent/src/index.ts
git commit -m "feat(agent): strict voice confirm intent matcher"
```

---

### Task 3: Env keys + rate-limit windows

**Files:**

- Modify: `apps/web/lib/env.ts` (bloc des clés serveur, autour de la ligne `ANTHROPIC_API_KEY: optionalString(1),` — ligne ~89)
- Modify: `.env.example` (racine du repo)
- Modify: `apps/web/lib/rate-limit/index.ts` (union `RateLimitKey` + `WINDOWS`)

- [ ] **Step 1: Add env schema entries**

In `apps/web/lib/env.ts`, juste sous `ANTHROPIC_API_KEY: optionalString(1),` add:

```ts
  // --- Assistant voice (V1.5) — clés 100 % serveur, jamais NEXT_PUBLIC_ ---
  DEEPGRAM_API_KEY: optionalString(10),
  ELEVENLABS_API_KEY: optionalString(10),
  /** Voice ID ElevenLabs (identifiant public d'une voix, pas un secret — mais serveur quand même). */
  ELEVENLABS_VOICE_ID: optionalString(5),
```

- [ ] **Step 2: Add to `.env.example`** (après le bloc `# --- Inngest`)

```bash
# --- Assistant voice (V1.5) --------------------------------------------------
# Deepgram (STT) : console.deepgram.com → API Keys
DEEPGRAM_API_KEY=
# ElevenLabs (TTS) : elevenlabs.io → Profile → API Keys
ELEVENLABS_API_KEY=
# Voix par défaut : elevenlabs.io → Voices → copier le Voice ID
ELEVENLABS_VOICE_ID=
```

- [ ] **Step 3: Add rate-limit keys**

In `apps/web/lib/rate-limit/index.ts` : add `'assistant_voice_stt'` and `'assistant_voice_tts'` to the `RateLimitKey` union, and to `WINDOWS`:

```ts
  assistant_voice_stt: { limit: 30, window: '1 m' },
  assistant_voice_tts: { limit: 60, window: '1 m' },
```

- [ ] **Step 4: Typecheck + existing tests still pass**

Run: `pnpm --filter @nexushub/web typecheck && pnpm --filter @nexushub/web test -- rate-limit`
Expected: PASS (le test du rate-limit énumère éventuellement les clés — l'adapter si une assertion liste les clés connues).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/env.ts .env.example apps/web/lib/rate-limit/index.ts
git commit -m "feat(assistant): voice env keys + rate limit windows"
```

---

### Task 4: STT seam + route /api/assistant/voice/transcribe

**Files:**

- Create: `apps/web/lib/assistant/voice/stt.ts`
- Create: `apps/web/lib/assistant/voice/stt.test.ts`
- Create: `apps/web/app/api/assistant/voice/transcribe/route.ts`
- Create: `apps/web/app/api/assistant/voice/transcribe/route.test.ts`

- [ ] **Step 1: Write the failing seam test**

```ts
// apps/web/lib/assistant/voice/stt.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockEnv = vi.hoisted(() => ({
  env: {
    NODE_ENV: 'test',
    ASSISTANT_E2E_MOCK: undefined as string | undefined,
    DEEPGRAM_API_KEY: 'dg-test-key-0123456789',
  },
}));
vi.mock('@/lib/env', () => ({ getServerEnv: () => mockEnv.env }));

import { transcribeAudio, SttNotConfiguredError, SttProviderError } from './stt';

describe('transcribeAudio', () => {
  beforeEach(() => {
    mockEnv.env.ASSISTANT_E2E_MOCK = undefined;
    mockEnv.env.DEEPGRAM_API_KEY = 'dg-test-key-0123456789';
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it('appelle Deepgram avec le modèle nova-3 multi et renvoie le transcript', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(
        JSON.stringify({
          results: { channels: [{ alternatives: [{ transcript: ' Bonjour NexusHub ' }] }] },
        }),
        { status: 200 },
      ),
    );
    const out = await transcribeAudio(new Uint8Array([1, 2, 3]).buffer, 'audio/webm');
    expect(out).toBe('Bonjour NexusHub');
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(String(url)).toContain('api.deepgram.com/v1/listen');
    expect(String(url)).toContain('model=nova-3');
    expect(String(url)).toContain('language=multi');
    expect(String(url)).toContain('smart_format=true');
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: 'Token dg-test-key-0123456789',
      'Content-Type': 'audio/webm',
    });
  });

  it('renvoie "" quand Deepgram ne détecte rien', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ results: { channels: [] } }), { status: 200 }),
    );
    await expect(transcribeAudio(new ArrayBuffer(4), 'audio/webm')).resolves.toBe('');
  });

  it('jette SttNotConfiguredError sans clé', async () => {
    mockEnv.env.DEEPGRAM_API_KEY = undefined as unknown as string;
    await expect(transcribeAudio(new ArrayBuffer(4), 'audio/webm')).rejects.toBeInstanceOf(
      SttNotConfiguredError,
    );
  });

  it('jette SttProviderError générique sur un statut non-2xx (sans fuiter le corps)', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response('secret-detail', { status: 401 }),
    );
    await expect(transcribeAudio(new ArrayBuffer(4), 'audio/webm')).rejects.toBeInstanceOf(
      SttProviderError,
    );
  });

  it('mode E2E mock : transcript constant, aucun réseau', async () => {
    mockEnv.env.ASSISTANT_E2E_MOCK = '1';
    await expect(transcribeAudio(new ArrayBuffer(4), 'audio/webm')).resolves.toBe('e2e:briefing');
    expect(fetch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @nexushub/web test -- lib/assistant/voice/stt`
Expected: FAIL — module absent.

- [ ] **Step 3: Write the seam**

```ts
// apps/web/lib/assistant/voice/stt.ts
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
```

- [ ] **Step 4: Run seam tests to verify they pass**

Run: `pnpm --filter @nexushub/web test -- lib/assistant/voice/stt`
Expected: PASS (6 tests).

- [ ] **Step 5: Write the failing route test**

```ts
// apps/web/app/api/assistant/voice/transcribe/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  assertCsrfHeader: vi.fn(),
  check: vi.fn(),
  transcribeAudio: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ getAuthContext: mocks.getAuthContext }));
vi.mock('@/lib/csrf', () => ({ assertCsrfHeader: mocks.assertCsrfHeader }));
vi.mock('@/lib/rate-limit', () => ({
  getRateLimiter: () => ({ check: mocks.check }),
}));
vi.mock('@/lib/assistant/voice/stt', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  transcribeAudio: mocks.transcribeAudio,
}));

import { SttNotConfiguredError } from '@/lib/assistant/voice/stt';
import { POST } from './route';

function makeReq(body: BodyInit, contentType = 'audio/webm'): Request {
  return new Request('http://localhost/api/assistant/voice/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': contentType, 'x-csrf-token': 'tok' },
    body,
  });
}

describe('POST /api/assistant/voice/transcribe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthContext.mockResolvedValue({ userId: 'u1', workspaceId: 'w1', role: 'Admin' });
    mocks.assertCsrfHeader.mockResolvedValue(undefined);
    mocks.check.mockResolvedValue({ success: true, remaining: 1, reset: 0 });
    mocks.transcribeAudio.mockResolvedValue('bonjour');
  });

  it('401 sans session', async () => {
    mocks.getAuthContext.mockResolvedValue(null);
    expect((await POST(makeReq(new Uint8Array(4)))).status).toBe(401);
  });

  it('403 sans CSRF valide', async () => {
    mocks.assertCsrfHeader.mockRejectedValue(new Error('csrf'));
    expect((await POST(makeReq(new Uint8Array(4)))).status).toBe(403);
  });

  it('429 quand le rate limit est atteint', async () => {
    mocks.check.mockResolvedValue({ success: false, remaining: 0, reset: 0 });
    expect((await POST(makeReq(new Uint8Array(4)))).status).toBe(429);
  });

  it('415 sur un content-type non audio', async () => {
    expect((await POST(makeReq(new Uint8Array(4), 'application/json'))).status).toBe(415);
  });

  it('413 au-delà de 2 Mo', async () => {
    expect((await POST(makeReq(new Uint8Array(2_000_001)))).status).toBe(413);
  });

  it('503 quand la voix n’est pas configurée — message générique', async () => {
    mocks.transcribeAudio.mockRejectedValue(new SttNotConfiguredError('x'));
    const res = await POST(makeReq(new Uint8Array(4)));
    expect(res.status).toBe(503);
    const body = (await res.json()) as { message: string };
    expect(body.message).not.toMatch(/DEEPGRAM|clé|key/i);
  });

  it('renvoie le transcript', async () => {
    const res = await POST(makeReq(new Uint8Array(4)));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, transcript: 'bonjour' });
  });

  it('502 générique sur erreur provider', async () => {
    mocks.transcribeAudio.mockRejectedValue(new Error('deepgram status 500'));
    const res = await POST(makeReq(new Uint8Array(4)));
    expect(res.status).toBe(502);
  });
});
```

- [ ] **Step 6: Run to verify it fails, then write the route**

Run: `pnpm --filter @nexushub/web test -- voice/transcribe`
Expected: FAIL — module absent. Then:

```ts
// apps/web/app/api/assistant/voice/transcribe/route.ts
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
```

- [ ] **Step 7: Run all Task 4 tests**

Run: `pnpm --filter @nexushub/web test -- voice`
Expected: PASS (seam + route).

- [ ] **Step 8: Commit**

```bash
git add apps/web/lib/assistant/voice/ apps/web/app/api/assistant/voice/transcribe/
git commit -m "feat(assistant): Deepgram STT seam + transcribe route"
```

---

### Task 5: TTS seam + route /api/assistant/voice/speak

**Files:**

- Create: `apps/web/lib/assistant/voice/tts.ts`
- Create: `apps/web/lib/assistant/voice/tts.test.ts`
- Create: `apps/web/app/api/assistant/voice/speak/route.ts`
- Create: `apps/web/app/api/assistant/voice/speak/route.test.ts`

- [ ] **Step 1: Write the failing seam test**

```ts
// apps/web/lib/assistant/voice/tts.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockEnv = vi.hoisted(() => ({
  env: {
    NODE_ENV: 'test',
    ASSISTANT_E2E_MOCK: undefined as string | undefined,
    ELEVENLABS_API_KEY: 'el-test-key-0123456789',
    ELEVENLABS_VOICE_ID: 'voice123',
  },
}));
vi.mock('@/lib/env', () => ({ getServerEnv: () => mockEnv.env }));

import { synthesizeSpeech, TtsNotConfiguredError, TtsProviderError } from './tts';

describe('synthesizeSpeech', () => {
  beforeEach(() => {
    mockEnv.env.ASSISTANT_E2E_MOCK = undefined;
    mockEnv.env.ELEVENLABS_API_KEY = 'el-test-key-0123456789';
    mockEnv.env.ELEVENLABS_VOICE_ID = 'voice123';
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it('appelle ElevenLabs flash en stream mp3 et renvoie corps + content-type', async () => {
    const audioBody = new Uint8Array([9, 9, 9]);
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(audioBody, { status: 200, headers: { 'Content-Type': 'audio/mpeg' } }),
    );
    const out = await synthesizeSpeech('Bonjour.');
    expect(out.contentType).toBe('audio/mpeg');
    expect(out.body).not.toBeNull();
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(String(url)).toContain('api.elevenlabs.io/v1/text-to-speech/voice123/stream');
    expect(String(url)).toContain('output_format=mp3_44100_64');
    expect((init as RequestInit).headers).toMatchObject({ 'xi-api-key': 'el-test-key-0123456789' });
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      text: 'Bonjour.',
      model_id: 'eleven_flash_v2_5',
    });
  });

  it('jette TtsNotConfiguredError sans clé OU sans voice id', async () => {
    mockEnv.env.ELEVENLABS_API_KEY = undefined as unknown as string;
    await expect(synthesizeSpeech('x')).rejects.toBeInstanceOf(TtsNotConfiguredError);
    mockEnv.env.ELEVENLABS_API_KEY = 'el-test-key-0123456789';
    mockEnv.env.ELEVENLABS_VOICE_ID = undefined as unknown as string;
    await expect(synthesizeSpeech('x')).rejects.toBeInstanceOf(TtsNotConfiguredError);
  });

  it('jette TtsProviderError générique sur non-2xx', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response('detail', { status: 429 }));
    await expect(synthesizeSpeech('x')).rejects.toBeInstanceOf(TtsProviderError);
  });

  it('mode E2E mock : WAV silencieux valide, aucun réseau', async () => {
    mockEnv.env.ASSISTANT_E2E_MOCK = '1';
    const out = await synthesizeSpeech('peu importe');
    expect(out.contentType).toBe('audio/wav');
    expect(fetch).not.toHaveBeenCalled();
    const bytes = new Uint8Array(await new Response(out.body).arrayBuffer());
    // Header RIFF/WAVE valide → decodeAudioData côté client ne jettera pas.
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...bytes.slice(8, 12))).toBe('WAVE');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @nexushub/web test -- lib/assistant/voice/tts`
Expected: FAIL — module absent.

- [ ] **Step 3: Write the seam**

```ts
// apps/web/lib/assistant/voice/tts.ts
import 'server-only';
import { getServerEnv } from '@/lib/env';

/**
 * Seam TTS (spec §3) : texte (une phrase du chunker) → stream audio.
 * ElevenLabs eleven_flash_v2_5 derrière une fonction unique. mp3_44100_64 :
 * décodable partout via Web Audio, léger (une phrase = quelques Ko).
 * La clé ne sort jamais de ce module.
 */

export class TtsNotConfiguredError extends Error {}
export class TtsProviderError extends Error {}

export interface SpeechResult {
  readonly body: ReadableStream<Uint8Array> | null;
  readonly contentType: string;
}

/** WAV PCM silencieux (~0,15 s, 8 kHz mono) — mock E2E décodable par Web Audio. */
function silentWav(): Uint8Array {
  const sampleRate = 8000;
  const samples = 1200;
  const dataLen = samples * 2;
  const buf = new ArrayBuffer(44 + dataLen);
  const view = new DataView(buf);
  const ascii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i += 1) view.setUint8(offset + i, s.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataLen, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, dataLen, true);
  return new Uint8Array(buf); // data = zéros → silence
}

export async function synthesizeSpeech(text: string): Promise<SpeechResult> {
  const env = getServerEnv();
  if (env.ASSISTANT_E2E_MOCK === '1' && env.NODE_ENV !== 'production') {
    return { body: new Response(silentWav()).body, contentType: 'audio/wav' };
  }
  if (env.ELEVENLABS_API_KEY === undefined || env.ELEVENLABS_VOICE_ID === undefined) {
    throw new TtsNotConfiguredError('ELEVENLABS absent');
  }
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(env.ELEVENLABS_VOICE_ID)}/stream?output_format=mp3_44100_64`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'xi-api-key': env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, model_id: 'eleven_flash_v2_5' }),
  });
  if (!res.ok) throw new TtsProviderError(`elevenlabs status ${String(res.status)}`);
  return { body: res.body, contentType: res.headers.get('content-type') ?? 'audio/mpeg' };
}
```

- [ ] **Step 4: Run seam tests to verify they pass**

Run: `pnpm --filter @nexushub/web test -- lib/assistant/voice/tts`
Expected: PASS.

- [ ] **Step 5: Write the failing route test**

```ts
// apps/web/app/api/assistant/voice/speak/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  assertCsrfHeader: vi.fn(),
  check: vi.fn(),
  synthesizeSpeech: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ getAuthContext: mocks.getAuthContext }));
vi.mock('@/lib/csrf', () => ({ assertCsrfHeader: mocks.assertCsrfHeader }));
vi.mock('@/lib/rate-limit', () => ({ getRateLimiter: () => ({ check: mocks.check }) }));
vi.mock('@/lib/assistant/voice/tts', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  synthesizeSpeech: mocks.synthesizeSpeech,
}));

import { TtsNotConfiguredError } from '@/lib/assistant/voice/tts';
import { POST } from './route';

function makeReq(body: unknown): Request {
  return new Request('http://localhost/api/assistant/voice/speak', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-csrf-token': 'tok' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/assistant/voice/speak', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthContext.mockResolvedValue({ userId: 'u1', workspaceId: 'w1', role: 'Admin' });
    mocks.assertCsrfHeader.mockResolvedValue(undefined);
    mocks.check.mockResolvedValue({ success: true, remaining: 1, reset: 0 });
    mocks.synthesizeSpeech.mockResolvedValue({
      body: new Response(new Uint8Array([1])).body,
      contentType: 'audio/mpeg',
    });
  });

  it('401 sans session', async () => {
    mocks.getAuthContext.mockResolvedValue(null);
    expect((await POST(makeReq({ text: 'x' }))).status).toBe(401);
  });

  it('403 sans CSRF', async () => {
    mocks.assertCsrfHeader.mockRejectedValue(new Error('csrf'));
    expect((await POST(makeReq({ text: 'x' }))).status).toBe(403);
  });

  it('429 rate limité', async () => {
    mocks.check.mockResolvedValue({ success: false, remaining: 0, reset: 0 });
    expect((await POST(makeReq({ text: 'x' }))).status).toBe(429);
  });

  it('400 : texte vide, > 1000 chars, ou body invalide', async () => {
    expect((await POST(makeReq({ text: '' }))).status).toBe(400);
    expect((await POST(makeReq({ text: 'a'.repeat(1001) }))).status).toBe(400);
    expect((await POST(makeReq({ nope: true }))).status).toBe(400);
  });

  it('proxifie le stream audio avec le bon content-type', async () => {
    const res = await POST(makeReq({ text: 'Bonjour.' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/mpeg');
    expect(mocks.synthesizeSpeech).toHaveBeenCalledWith('Bonjour.');
  });

  it('503 non configuré / 502 erreur provider — messages génériques', async () => {
    mocks.synthesizeSpeech.mockRejectedValue(new TtsNotConfiguredError('x'));
    expect((await POST(makeReq({ text: 'x' }))).status).toBe(503);
    mocks.synthesizeSpeech.mockRejectedValue(new Error('elevenlabs status 500'));
    expect((await POST(makeReq({ text: 'x' }))).status).toBe(502);
  });
});
```

- [ ] **Step 6: Run to verify it fails, then write the route**

Run: `pnpm --filter @nexushub/web test -- voice/speak`
Expected: FAIL — module absent. Then:

```ts
// apps/web/app/api/assistant/voice/speak/route.ts
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
```

- [ ] **Step 7: Run all Task 5 tests**

Run: `pnpm --filter @nexushub/web test -- voice`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/lib/assistant/voice/tts.ts apps/web/lib/assistant/voice/tts.test.ts apps/web/app/api/assistant/voice/speak/
git commit -m "feat(assistant): ElevenLabs TTS seam + speak route"
```

---

### Task 6: Hook use-voice-recorder (client)

Capture micro : getUserMedia + MediaRecorder, borne 60 s, permission refusée, annulation. Le hook ne fait AUCUN appel réseau — il rend un Blob ; la transcription est faite par l'appelant (Task 9).

**Files:**

- Create: `apps/web/features/assistant/hooks/use-voice-recorder.ts`
- Create: `apps/web/features/assistant/hooks/use-voice-recorder.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/features/assistant/hooks/use-voice-recorder.test.ts
// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useVoiceRecorder } from './use-voice-recorder';

/** Faux MediaRecorder pilotable — jsdom n'en fournit pas. */
class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  static isTypeSupported = (t: string) => t === 'audio/webm;codecs=opus';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  state = 'inactive';
  readonly mimeType: string;
  constructor(_stream: MediaStream, opts?: { mimeType?: string }) {
    this.mimeType = opts?.mimeType ?? 'audio/webm';
    FakeMediaRecorder.instances.push(this);
  }
  start() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['aud'], { type: this.mimeType }) });
    this.onstop?.();
  }
}

const fakeTrack = { stop: vi.fn() };
const fakeStream = { getTracks: () => [fakeTrack] } as unknown as MediaStream;

describe('useVoiceRecorder', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeMediaRecorder.instances = [];
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(fakeStream) },
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('start() demande le micro et passe en recording', async () => {
    const { result } = renderHook(() => useVoiceRecorder());
    await act(() => result.current.start());
    expect(result.current.state).toBe('recording');
  });

  it('stop() résout avec le Blob et son mimeType', async () => {
    const { result } = renderHook(() => useVoiceRecorder());
    await act(() => result.current.start());
    let blob: Blob | null = null;
    await act(async () => {
      blob = await result.current.stop();
    });
    expect(blob).not.toBeNull();
    expect((blob as unknown as Blob).type).toBe('audio/webm;codecs=opus');
    expect(result.current.state).toBe('idle');
  });

  it('cancel() jette l’enregistrement sans résoudre de blob', async () => {
    const { result } = renderHook(() => useVoiceRecorder());
    await act(() => result.current.start());
    act(() => result.current.cancel());
    expect(result.current.state).toBe('idle');
  });

  it('borne à 60 s : auto-stop et blob disponible via onAutoStop', async () => {
    const onAutoStop = vi.fn();
    const { result } = renderHook(() => useVoiceRecorder({ onAutoStop }));
    await act(() => result.current.start());
    act(() => void vi.advanceTimersByTime(60_000));
    await waitFor(() => expect(onAutoStop).toHaveBeenCalledTimes(1));
    expect((onAutoStop.mock.calls[0]![0] as Blob).type).toContain('audio/webm');
  });

  it('permission refusée → state denied, pas de crash', async () => {
    (navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockRejectedValue(
      new DOMException('denied', 'NotAllowedError'),
    );
    const { result } = renderHook(() => useVoiceRecorder());
    await act(() => result.current.start());
    expect(result.current.state).toBe('denied');
  });

  it('navigateur sans MediaRecorder → state unsupported', async () => {
    vi.stubGlobal('MediaRecorder', undefined);
    const { result } = renderHook(() => useVoiceRecorder());
    await act(() => result.current.start());
    expect(result.current.state).toBe('unsupported');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @nexushub/web test -- use-voice-recorder`
Expected: FAIL — module absent.

- [ ] **Step 3: Write the hook**

```ts
// apps/web/features/assistant/hooks/use-voice-recorder.ts
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Capture micro PTT (spec §1/§2) : getUserMedia + MediaRecorder, borne 60 s.
 * Aucun réseau ici — rend un Blob, l'appelant transcrit. Le stream micro est
 * conservé après la première autorisation (latence d'attaque ~0 aux PTT
 * suivants) et coupé au démontage.
 */

export type RecorderState = 'idle' | 'recording' | 'denied' | 'unsupported';

const MAX_RECORDING_MS = 60_000;

/** Safari ne supporte pas webm/opus — repli mp4 (AAC), accepté par Deepgram. */
function pickMimeType(): string {
  if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus';
  if (MediaRecorder.isTypeSupported('audio/mp4')) return 'audio/mp4';
  return '';
}

export interface UseVoiceRecorderOptions {
  /** Appelé avec le Blob quand la borne des 60 s force l'arrêt. */
  readonly onAutoStop?: (blob: Blob) => void;
}

export function useVoiceRecorder(options?: UseVoiceRecorderOptions) {
  const [state, setState] = useState<RecorderState>('idle');
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);
  const onAutoStopRef = useRef(options?.onAutoStop);
  onAutoStopRef.current = options?.onAutoStop;

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  const buildBlob = useCallback((): Blob => {
    const type = recorderRef.current?.mimeType ?? 'audio/webm';
    return new Blob(chunksRef.current, { type });
  }, []);

  const start = useCallback(async (): Promise<void> => {
    if (recorderRef.current?.state === 'recording') return;
    if (typeof MediaRecorder === 'undefined') {
      setState('unsupported');
      return;
    }
    try {
      streamRef.current ??= await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setState('denied');
      return;
    }
    cancelledRef.current = false;
    chunksRef.current = [];
    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(
      streamRef.current,
      mimeType !== '' ? { mimeType } : undefined,
    );
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0 || chunksRef.current.length === 0) chunksRef.current.push(e.data);
    };
    recorderRef.current = recorder;
    recorder.start();
    setState('recording');
    timerRef.current = setTimeout(() => {
      // Borne 60 s (spec §2) : arrêt forcé, blob livré via onAutoStop.
      if (recorderRef.current?.state !== 'recording') return;
      recorderRef.current.onstop = () => {
        setState('idle');
        onAutoStopRef.current?.(buildBlob());
      };
      recorderRef.current.stop();
    }, MAX_RECORDING_MS);
  }, [buildBlob]);

  /** Arrête et résout avec l'audio capturé (null si annulé/vide). */
  const stop = useCallback((): Promise<Blob | null> => {
    const recorder = recorderRef.current;
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    if (recorder === null || recorder.state !== 'recording') return Promise.resolve(null);
    return new Promise((resolve) => {
      recorder.onstop = () => {
        setState('idle');
        resolve(cancelledRef.current ? null : buildBlob());
      };
      recorder.stop();
    });
  }, [buildBlob]);

  const cancel = useCallback((): void => {
    cancelledRef.current = true;
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    const recorder = recorderRef.current;
    if (recorder !== null && recorder.state === 'recording') {
      recorder.onstop = () => setState('idle');
      recorder.stop();
    } else {
      setState('idle');
    }
  }, []);

  return { state, start, stop, cancel } as const;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @nexushub/web test -- use-voice-recorder`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/features/assistant/hooks/use-voice-recorder.ts apps/web/features/assistant/hooks/use-voice-recorder.test.ts
git commit -m "feat(assistant): voice recorder hook (PTT capture, 60s cap)"
```

---

### Task 7: Hook use-speech-queue (client)

File de lecture séquentielle : chaque phrase → fetch `/speak` → decodeAudioData → lecture ; annulable d'un coup (Stop/interruption). Erreur réseau/décodage sur UNE phrase → phrase sautée, la file continue.

**Files:**

- Create: `apps/web/features/assistant/hooks/use-speech-queue.ts`
- Create: `apps/web/features/assistant/hooks/use-speech-queue.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/features/assistant/hooks/use-speech-queue.test.ts
// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSpeechQueue } from './use-speech-queue';

/** Faux AudioContext : lecture instantanée (onended synchrone au start). */
class FakeAudioContext {
  static created = 0;
  state = 'running';
  constructor() {
    FakeAudioContext.created += 1;
  }
  decodeAudioData(buf: ArrayBuffer): Promise<AudioBuffer> {
    if (buf.byteLength === 0) return Promise.reject(new Error('decode'));
    return Promise.resolve({ duration: 0.1 } as AudioBuffer);
  }
  createBufferSource() {
    const source = {
      buffer: null as AudioBuffer | null,
      onended: null as (() => void) | null,
      connect: vi.fn(),
      start: vi.fn(() => {
        queueMicrotask(() => source.onended?.());
      }),
      stop: vi.fn(),
    };
    return source;
  }
  resume(): Promise<void> {
    return Promise.resolve();
  }
  get destination() {
    return {};
  }
}

describe('useSpeechQueue', () => {
  beforeEach(() => {
    FakeAudioContext.created = 0;
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2]), { status: 200 })),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('joue les phrases en séquence et appelle /speak avec le CSRF', async () => {
    const { result } = renderHook(() => useSpeechQueue('csrf-tok'));
    act(() => {
      result.current.enqueue('Première.');
      result.current.enqueue('Seconde.');
    });
    await waitFor(() => expect(result.current.speaking).toBe(false));
    expect(fetch).toHaveBeenCalledTimes(2);
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(String(url)).toBe('/api/assistant/voice/speak');
    expect((init as RequestInit).headers).toMatchObject({ 'x-csrf-token': 'csrf-tok' });
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ text: 'Première.' });
  });

  it('speaking=true pendant la lecture', async () => {
    const { result } = renderHook(() => useSpeechQueue('t'));
    act(() => result.current.enqueue('Phrase.'));
    await waitFor(() => expect(result.current.speaking).toBe(true));
    await waitFor(() => expect(result.current.speaking).toBe(false));
  });

  it('stop() vide la file et coupe la lecture', async () => {
    const { result } = renderHook(() => useSpeechQueue('t'));
    act(() => {
      result.current.enqueue('Une.');
      result.current.enqueue('Deux.');
      result.current.enqueue('Trois.');
    });
    act(() => result.current.stop());
    await waitFor(() => expect(result.current.speaking).toBe(false));
    // Au plus la 1re requête est partie — la file est vidée.
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('une phrase en échec (réseau ou décodage) est sautée, la file continue', async () => {
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(new Response(null, { status: 502 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1]), { status: 200 }));
    const { result } = renderHook(() => useSpeechQueue('t'));
    act(() => {
      result.current.enqueue('Échec.');
      result.current.enqueue('Suivante.');
    });
    await waitFor(() => expect(result.current.speaking).toBe(false));
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @nexushub/web test -- use-speech-queue`
Expected: FAIL — module absent.

- [ ] **Step 3: Write the hook**

```ts
// apps/web/features/assistant/hooks/use-speech-queue.ts
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * File TTS séquentielle (spec §3) : enqueue(phrase) → fetch /speak →
 * decodeAudioData → lecture. Une seule phrase à la fois ; stop() vide tout
 * (Stop / interruption / nouveau tour). Une phrase en échec est SAUTÉE
 * (mieux vaut perdre une phrase que bloquer la réponse vocale entière).
 * L'AudioContext est créé au premier enqueue — toujours suite à un geste
 * utilisateur (relâche PTT), donc jamais bloqué par l'autoplay policy.
 */

export function useSpeechQueue(csrfToken: string) {
  const [speaking, setSpeaking] = useState(false);
  const queueRef = useRef<string[]>([]);
  const playingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const csrfRef = useRef(csrfToken);
  csrfRef.current = csrfToken;

  const stop = useCallback((): void => {
    queueRef.current = [];
    abortRef.current?.abort();
    abortRef.current = null;
    try {
      sourceRef.current?.stop();
    } catch {
      // déjà arrêtée — sans conséquence
    }
    sourceRef.current = null;
    playingRef.current = false;
    setSpeaking(false);
  }, []);

  useEffect(() => stop, [stop]);

  const drain = useCallback(async (): Promise<void> => {
    if (playingRef.current) return;
    playingRef.current = true;
    setSpeaking(true);
    while (queueRef.current.length > 0) {
      const text = queueRef.current.shift();
      if (text === undefined) break;
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const res = await fetch('/api/assistant/voice/speak', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfRef.current },
          body: JSON.stringify({ text }),
          signal: controller.signal,
        });
        if (!res.ok) continue; // phrase sautée
        const bytes = await res.arrayBuffer();
        ctxRef.current ??= new AudioContext();
        if (ctxRef.current.state === 'suspended') await ctxRef.current.resume();
        const audio = await ctxRef.current.decodeAudioData(bytes);
        // stop() pendant le fetch/décodage : la file est déjà vide, ne pas jouer.
        if (abortRef.current !== controller) return;
        await new Promise<void>((resolve) => {
          const source = ctxRef.current!.createBufferSource();
          source.buffer = audio;
          source.connect(ctxRef.current!.destination);
          source.onended = () => resolve();
          sourceRef.current = source;
          source.start();
        });
        sourceRef.current = null;
      } catch (err) {
        if ((err as { name?: string } | null)?.name === 'AbortError') break;
        // réseau/décodage : phrase sautée, on continue
      }
    }
    playingRef.current = false;
    setSpeaking(false);
  }, []);

  const enqueue = useCallback(
    (sentence: string): void => {
      if (sentence.trim() === '') return;
      queueRef.current.push(sentence);
      void drain();
    },
    [drain],
  );

  return { enqueue, stop, speaking } as const;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @nexushub/web test -- use-speech-queue`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/features/assistant/hooks/use-speech-queue.ts apps/web/features/assistant/hooks/use-speech-queue.test.ts
git commit -m "feat(assistant): sequential speech playback queue hook"
```

---

### Task 8: VoiceCapsule + orbe `listening`

**Files:**

- Create: `apps/web/features/assistant/components/voice-capsule.tsx`
- Create: `apps/web/features/assistant/components/voice-capsule.test.tsx`
- Create: `apps/web/features/assistant/components/voice-capsule.stories.tsx`
- Modify: `apps/web/features/assistant/components/assistant-orb.tsx:4-10` (`deriveOrbActivity`)
- Modify: `apps/web/features/assistant/components/assistant-orb.test.tsx` (cas `listening`)

- [ ] **Step 1: Write the failing capsule test**

```tsx
// apps/web/features/assistant/components/voice-capsule.test.tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { VoiceCapsule } from './voice-capsule';

describe('VoiceCapsule', () => {
  it('rend null en idle', () => {
    const { container } = render(<VoiceCapsule mode="idle" onStop={() => undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it('écoute : texte + aria-live polite', () => {
    render(<VoiceCapsule mode="recording" onStop={() => undefined} />);
    const capsule = screen.getByText(/J'écoute… relâche pour envoyer/);
    expect(capsule.closest('[aria-live="polite"]')).not.toBeNull();
    expect(screen.getByText(/Échap pour annuler/)).toBeInTheDocument();
  });

  it('transcription : état atténué sans bouton', () => {
    render(<VoiceCapsule mode="transcribing" onStop={() => undefined} />);
    expect(screen.getByText('Transcription…')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('parole : bouton Stop cliquable', async () => {
    const onStop = vi.fn();
    render(<VoiceCapsule mode="speaking" onStop={onStop} />);
    await userEvent.click(screen.getByRole('button', { name: /Arrêter la lecture/ }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('permission refusée : message d’aide', () => {
    render(<VoiceCapsule mode="denied" onStop={() => undefined} />);
    expect(screen.getByText(/micro est bloqué/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @nexushub/web test -- voice-capsule`
Expected: FAIL — module absent.

- [ ] **Step 3: Write the component**

```tsx
// apps/web/features/assistant/components/voice-capsule.tsx
'use client';

/**
 * Capsule d'état du mode voix (spec §1) — bandeau au-dessus du champ de
 * saisie. `idle` ne rend rien. aria-live=polite : les changements d'état
 * sont annoncés sans interrompre le lecteur d'écran.
 */

export type VoiceCapsuleMode = 'idle' | 'recording' | 'transcribing' | 'speaking' | 'denied';

export function VoiceCapsule({
  mode,
  onStop,
}: {
  readonly mode: VoiceCapsuleMode;
  readonly onStop: () => void;
}) {
  if (mode === 'idle') return null;
  return (
    <div aria-live="polite" className="w-full">
      <div
        data-testid="voice-capsule"
        data-mode={mode}
        className="flex w-full items-center gap-2 rounded-full border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] px-4 py-2 text-xs text-[color:var(--color-text-muted)]"
      >
        {mode === 'recording' && (
          <>
            <span
              className="h-2 w-2 animate-pulse rounded-full"
              style={{ background: 'var(--color-danger)' }}
              aria-hidden
            />
            <span>J&apos;écoute… relâche pour envoyer</span>
            <span className="ml-auto text-[color:var(--color-text-ghost)]">
              ✕ Échap pour annuler
            </span>
          </>
        )}
        {mode === 'transcribing' && <span className="opacity-60">Transcription…</span>}
        {mode === 'speaking' && (
          <>
            <span
              className="h-2 w-2 animate-pulse rounded-full"
              style={{ background: 'var(--accent-primary)' }}
              aria-hidden
            />
            <span>Je parle…</span>
            <button
              type="button"
              onClick={onStop}
              aria-label="Arrêter la lecture"
              className="ml-auto rounded-full border border-[color:var(--color-border-light)] px-3 py-1 font-bold text-[color:var(--color-text-muted)]"
            >
              ■ Stop
            </button>
          </>
        )}
        {mode === 'denied' && (
          <span>
            Le micro est bloqué — autorise-le dans les réglages du navigateur (icône 🔒 dans la
            barre d&apos;adresse), puis recharge la page.
          </span>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Extend `deriveOrbActivity`**

Replace the function in `apps/web/features/assistant/components/assistant-orb.tsx` (l.4-10) with:

```ts
/** Dérive l'état de l'orbe depuis les états du chat (spec §3.1/§6). `listening` prime (V1.5 voix). */
export function deriveOrbActivity(input: {
  busy: boolean;
  streaming: boolean; // streamText non vide
  listening?: boolean; // PTT en cours (voix V1.5)
}): OrbActivity {
  if (input.listening === true) return 'listening';
  if (!input.busy) return 'idle';
  return input.streaming ? 'responding' : 'thinking';
}
```

In `assistant-orb.test.tsx`, add:

```ts
it('listening prime sur tous les autres états', () => {
  expect(deriveOrbActivity({ busy: true, streaming: true, listening: true })).toBe('listening');
  expect(deriveOrbActivity({ busy: false, streaming: false, listening: true })).toBe('listening');
});
```

- [ ] **Step 5: Write the story**

```tsx
// apps/web/features/assistant/components/voice-capsule.stories.tsx
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { VoiceCapsule } from './voice-capsule';

const meta = {
  title: 'Assistant/VoiceCapsule',
  component: VoiceCapsule,
  args: { onStop: () => undefined },
} satisfies Meta<typeof VoiceCapsule>;
export default meta;

type Story = StoryObj<typeof meta>;
export const Recording: Story = { args: { mode: 'recording' } };
export const Transcribing: Story = { args: { mode: 'transcribing' } };
export const Speaking: Story = { args: { mode: 'speaking' } };
export const Denied: Story = { args: { mode: 'denied' } };
```

Note: match the exact `Meta` import/type pattern used by `widgets/kpi-cards.stories.tsx` if it differs.

- [ ] **Step 6: Run tests + storybook build check**

Run: `pnpm --filter @nexushub/web test -- voice-capsule assistant-orb`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/features/assistant/components/voice-capsule.tsx apps/web/features/assistant/components/voice-capsule.test.tsx apps/web/features/assistant/components/voice-capsule.stories.tsx apps/web/features/assistant/components/assistant-orb.tsx apps/web/features/assistant/components/assistant-orb.test.tsx
git commit -m "feat(assistant): voice capsule states + listening orb"
```

---

### Task 9: Intégration dans assistant-chat.tsx

Le cœur : PTT (⌥ Option + micro maintenu), transcript → `send()`, TTS symétrique via chunker, interruption, confirmation vocale. `apps/web/features/assistant/components/assistant-chat.tsx` (540 l.) est déjà dense — l'intégration passe par un hook orchestrateur dédié pour limiter la croissance du composant.

**Files:**

- Create: `apps/web/features/assistant/hooks/use-voice-mode.ts` (orchestrateur)
- Create: `apps/web/features/assistant/hooks/use-voice-mode.test.ts`
- Modify: `apps/web/features/assistant/components/assistant-chat.tsx`
- Modify: `apps/web/features/assistant/components/assistant-chat.test.tsx` (nouveaux cas)

- [ ] **Step 1: Write the failing orchestrator test**

```ts
// apps/web/features/assistant/hooks/use-voice-mode.test.ts
// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  recorder: {
    state: 'idle' as string,
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(new Blob(['x'], { type: 'audio/webm' })),
    cancel: vi.fn(),
  },
  queue: { enqueue: vi.fn(), stop: vi.fn(), speaking: false },
}));
vi.mock('./use-voice-recorder', () => ({ useVoiceRecorder: () => mocks.recorder }));
vi.mock('./use-speech-queue', () => ({ useSpeechQueue: () => mocks.queue }));

import { useVoiceMode } from './use-voice-mode';

function setup(over?: Partial<Parameters<typeof useVoiceMode>[0]>) {
  const props = {
    csrfToken: 't',
    busy: false,
    onTranscript: vi.fn(),
    onVoiceConfirm: vi.fn().mockReturnValue(false),
    onInterrupt: vi.fn(),
    ...over,
  };
  return { ...renderHook(() => useVoiceMode(props)), props };
}

describe('useVoiceMode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.recorder.state = 'idle';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true, transcript: 'déplace la carte' }), {
          status: 200,
        }),
      ),
    );
  });

  it('pressStart → recorder.start ; pressEnd → transcribe → onTranscript(texte, voice)', async () => {
    const { result, props } = setup();
    await act(() => result.current.pressStart());
    expect(mocks.recorder.start).toHaveBeenCalled();
    mocks.recorder.state = 'recording';
    await act(() => result.current.pressEnd());
    await waitFor(() => expect(props.onTranscript).toHaveBeenCalledWith('déplace la carte'));
    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(String(url)).toBe('/api/assistant/voice/transcribe');
  });

  it('transcript vide → notice "Je n’ai rien entendu", pas de onTranscript', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ ok: true, transcript: '' }), { status: 200 }),
    );
    const { result, props } = setup();
    await act(() => result.current.pressStart());
    mocks.recorder.state = 'recording';
    await act(() => result.current.pressEnd());
    await waitFor(() => expect(result.current.notice).toMatch(/rien entendu/i));
    expect(props.onTranscript).not.toHaveBeenCalled();
  });

  it('confirm en attente : onVoiceConfirm=true consomme le transcript (pas de onTranscript)', async () => {
    const { result, props } = setup({ onVoiceConfirm: vi.fn().mockReturnValue(true) });
    await act(() => result.current.pressStart());
    mocks.recorder.state = 'recording';
    await act(() => result.current.pressEnd());
    await waitFor(() => expect(props.onVoiceConfirm).toHaveBeenCalledWith('déplace la carte'));
    expect(props.onTranscript).not.toHaveBeenCalled();
  });

  it('pressStart pendant busy → onInterrupt puis écoute (interruption spec §1)', async () => {
    const { result, props } = setup({ busy: true });
    await act(() => result.current.pressStart());
    expect(props.onInterrupt).toHaveBeenCalled();
    expect(mocks.queue.stop).toHaveBeenCalled();
    expect(mocks.recorder.start).toHaveBeenCalled();
  });

  it('cancel (Échap) annule sans transcription', async () => {
    const { result, props } = setup();
    await act(() => result.current.pressStart());
    mocks.recorder.state = 'recording';
    act(() => result.current.cancel());
    expect(mocks.recorder.cancel).toHaveBeenCalled();
    expect(props.onTranscript).not.toHaveBeenCalled();
  });

  it('erreur route transcribe → notice avec le message serveur', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(
        JSON.stringify({ ok: false, message: 'Transcription indisponible — réessayez.' }),
        {
          status: 502,
        },
      ),
    );
    const { result } = setup();
    await act(() => result.current.pressStart());
    mocks.recorder.state = 'recording';
    await act(() => result.current.pressEnd());
    await waitFor(() => expect(result.current.notice).toMatch(/indisponible/));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @nexushub/web test -- use-voice-mode`
Expected: FAIL — module absent.

- [ ] **Step 3: Write the orchestrator hook**

```ts
// apps/web/features/assistant/hooks/use-voice-mode.ts
'use client';

import { useCallback, useRef, useState } from 'react';
import { useSpeechQueue } from './use-speech-queue';
import { useVoiceRecorder } from './use-voice-recorder';

/**
 * Orchestrateur du mode voix (spec §1) : relie PTT → capture → transcription
 * → chat. Fournit aussi la file TTS (speak/speakStop) au composant chat qui
 * y pousse les phrases du chunker. La détection Option/Échap reste dans le
 * composant (elle a besoin du DOM du chat) ; ici, la logique d'états.
 */

export type VoiceUiMode = 'idle' | 'recording' | 'transcribing' | 'speaking' | 'denied';

export interface UseVoiceModeProps {
  readonly csrfToken: string;
  /** Tour en cours (stream/outil) — un pressStart pendant busy = interruption. */
  readonly busy: boolean;
  /** Transcript prêt à envoyer comme message utilisateur (tour VOCAL). */
  readonly onTranscript: (text: string) => void;
  /**
   * Confirmation gated en attente : renvoie true si le transcript a été
   * consommé comme réponse Autoriser/Refuser (il ne part alors PAS en message).
   */
  readonly onVoiceConfirm: (transcript: string) => boolean;
  /** Interrompre le tour en cours (abort du stream) avant de réécouter. */
  readonly onInterrupt: () => void;
}

export function useVoiceMode(props: UseVoiceModeProps) {
  const [transcribing, setTranscribing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const queue = useSpeechQueue(props.csrfToken);
  const propsRef = useRef(props);
  propsRef.current = props;

  const handleBlob = useCallback(async (blob: Blob): Promise<void> => {
    setTranscribing(true);
    setNotice(null);
    try {
      const res = await fetch('/api/assistant/voice/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': blob.type, 'x-csrf-token': propsRef.current.csrfToken },
        body: blob,
      });
      const payload = (await res.json().catch(() => null)) as {
        transcript?: string;
        message?: string;
      } | null;
      if (!res.ok) {
        setNotice(payload?.message ?? 'Transcription indisponible — réessayez.');
        return;
      }
      const transcript = payload?.transcript?.trim() ?? '';
      if (transcript === '') {
        setNotice("Je n'ai rien entendu — réessaie en parlant après avoir appuyé.");
        return;
      }
      // Confirmation gated en attente : le transcript est d'abord proposé
      // comme réponse Autoriser/Refuser (matching strict côté chat).
      if (propsRef.current.onVoiceConfirm(transcript)) return;
      propsRef.current.onTranscript(transcript);
    } catch {
      setNotice('Transcription indisponible — réessayez.');
    } finally {
      setTranscribing(false);
    }
  }, []);

  const recorder = useVoiceRecorder({ onAutoStop: (blob) => void handleBlob(blob) });

  const pressStart = useCallback(async (): Promise<void> => {
    setNotice(null);
    // Interruption (spec §1) : couper lecture + génération, puis écouter.
    if (queue.speaking || propsRef.current.busy) {
      queue.stop();
      propsRef.current.onInterrupt();
    }
    await recorder.start();
  }, [queue, recorder]);

  const pressEnd = useCallback(async (): Promise<void> => {
    const blob = await recorder.stop();
    if (blob !== null && blob.size > 0) await handleBlob(blob);
  }, [recorder, handleBlob]);

  const cancel = useCallback((): void => {
    recorder.cancel();
  }, [recorder]);

  const mode: VoiceUiMode =
    recorder.state === 'denied'
      ? 'denied'
      : recorder.state === 'recording'
        ? 'recording'
        : transcribing
          ? 'transcribing'
          : queue.speaking
            ? 'speaking'
            : 'idle';

  return {
    mode,
    notice,
    pressStart,
    pressEnd,
    cancel,
    /** Pousse une phrase du chunker dans la file TTS. */
    speak: queue.enqueue,
    /** Coupe la lecture en cours (bouton Stop). */
    speakStop: queue.stop,
    recorderUnsupported: recorder.state === 'unsupported',
  } as const;
}
```

- [ ] **Step 4: Run orchestrator tests to verify they pass**

Run: `pnpm --filter @nexushub/web test -- use-voice-mode`
Expected: PASS (6 tests).

- [ ] **Step 5: Wire into `assistant-chat.tsx`**

Modifications précises (garder les commentaires existants intacts) :

**(a) Imports** — add after l.12 (`import { trimWidgetData } …`):

```ts
import { matchVoiceConfirm, SentenceChunker } from '@nexushub/agent';
import { useVoiceMode } from '../hooks/use-voice-mode';
import { VoiceCapsule } from './voice-capsule';
```

**(b) State/refs du mode voix** — dans `AssistantChat`, après `const escNoteId = useId();` (l.149) :

```ts
// --- Mode voix (V1.5, spec 2026-08-03) -----------------------------------
// Tour vocal ? → sortie symétrique : le TTS ne lit que les réponses aux
// questions posées à la voix. Ref (pas state) : lu dans la boucle SSE.
const voiceTurnRef = useRef(false);
// Armé par onTranscript juste avant send() — voir la note ⚠️ du bloc (d).
const nextTurnIsVoiceRef = useRef(false);
// Chunker du tour en cours — recréé à chaque tour vocal.
const chunkerRef = useRef<SentenceChunker | null>(null);
const pendingConfirmRef = useRef<{ id: string } | null>(null);
```

**(c) Hook voix** — après le bloc `answerConfirm` (l.205), insérer :

```ts
const voice = useVoiceMode({
  csrfToken,
  busy,
  onTranscript: (text) => {
    nextTurnIsVoiceRef.current = true;
    void send(text);
  },
  onVoiceConfirm: (transcript) => {
    const pending = pendingConfirmRef.current;
    if (pending === null) return false;
    const intent = matchVoiceConfirm(transcript);
    if (intent === null) {
      // Ambigu (spec §4.4) : redemander à voix haute, widget toujours cliquable.
      voice.speak('Dis clairement oui ou non, ou clique sur le bouton.');
      return true; // consommé — ne part pas en message
    }
    void answerConfirm(pending.id, intent === 'allow');
    return true;
  },
  onInterrupt: () => abortRef.current?.abort(),
});
// Miroir du pendingConfirm pour le hook voix (état → ref, même valeur).
pendingConfirmRef.current = pendingConfirm === null ? null : { id: pendingConfirm.id };
```

Note d'implémentation : `voice.speak` est utilisé dans le callback `onVoiceConfirm` passé à `useVoiceMode` — pas de cycle réel (le hook stocke les callbacks dans une ref interne, `propsRef`), mais TypeScript refusera la référence avant déclaration. Solution : déclarer `const speakRef = useRef<(s: string) => void>(() => undefined);` AVANT le hook, utiliser `speakRef.current('…')` dans le callback, et après le hook : `speakRef.current = voice.speak;`.

**(d) TTS symétrique dans la boucle SSE** — dans `send()` :

⚠️ Subtilité : `onTranscript` appelle `send(text)` avec un `textOverride` — mais les widgets aussi (`WidgetActions.sendMessage`). Le test « ce tour est-il vocal ? » ne peut donc PAS être `textOverride !== undefined`. Contrat : un flag dédié `nextTurnIsVoiceRef` est armé UNIQUEMENT par `onTranscript`, juste avant son `send(text)` ; toute autre entrée (clavier ou widget) trouve le flag à `false`. Déclarer le ref en (b) : `const nextTurnIsVoiceRef = useRef(false);` — et dans `onTranscript` (bloc (c)) : `nextTurnIsVoiceRef.current = true;` avant `void send(text)`.

Au début de `send` (après `setStreamWidgets([]);`, l.231) :

```ts
// Tour vocal ? Armé par onTranscript uniquement (voir nextTurnIsVoiceRef) —
// sortie symétrique : les envois clavier/widget restent silencieux.
voiceTurnRef.current = nextTurnIsVoiceRef.current;
nextTurnIsVoiceRef.current = false;
chunkerRef.current = voiceTurnRef.current ? new SentenceChunker() : null;
```

Dans la boucle d'événements SSE :

```ts
if (event.type === 'chunk') {
  accumulated += event.text;
  setStreamText(accumulated);
  // Tour vocal : vocaliser les phrases complètes au fil de l'eau.
  if (chunkerRef.current !== null) {
    for (const sentence of chunkerRef.current.push(event.text)) voice.speak(sentence);
  }
}
```

```ts
if (event.type === 'confirm_request') {
  setPendingConfirm({ id: event.id, tool: event.tool, description: event.description });
  setAnswering(null);
  // Tour vocal : lire le récapitulatif à voix haute (spec §4.1).
  if (voiceTurnRef.current) voice.speak(event.description);
}
```

Dans le `finally` de `send` (avant `setBusy(false)`) :

```ts
// Fin de réponse : vocaliser le reliquat sans délimiteur final.
if (chunkerRef.current !== null) {
  const rest = chunkerRef.current.flush();
  if (rest !== '') voice.speak(rest);
  chunkerRef.current = null;
}
```

⚠️ `send` est un `useCallback([busy, csrfToken])` — `voice.speak` doit y être stable. `useSpeechQueue.enqueue` est un `useCallback([drain])` stable, et `useVoiceMode` le re-expose tel quel : ajouter `voice.speak` aux deps de `send` est correct et ne casse pas la stabilité (documenter dans le commentaire des deps existant).

**(e) PTT clavier (Option) + Échap** — nouvel effet après l'effet scroll (l.180) :

```ts
// PTT ⌥ Option (spec décision produit) : maintien = écoute, relâche = envoi.
// Ignoré quand la saisie a le focus (Option+lettre y produit des caractères).
useEffect(() => {
  const isTyping = () => {
    const el = document.activeElement;
    return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
  };
  const down = (e: KeyboardEvent) => {
    if (e.key === 'Alt' && !e.repeat && !isTyping()) {
      e.preventDefault();
      void voice.pressStart();
    }
    if (e.key === 'Escape' && voice.mode === 'recording') voice.cancel();
  };
  const up = (e: KeyboardEvent) => {
    if (e.key === 'Alt' && voice.mode === 'recording') void voice.pressEnd();
  };
  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);
  return () => {
    window.removeEventListener('keydown', down);
    window.removeEventListener('keyup', up);
  };
}, [voice]);
```

**(f) Orbe** — l.365-367, passer l'état d'écoute :

```tsx
<AssistantOrb
  activity={deriveOrbActivity({
    busy,
    streaming: streamText !== null && streamText !== '',
    listening: voice.mode === 'recording',
  })}
/>
```

**(g) Capsule + notice voix** — juste au-dessus du `<form …>` (l.500) :

```tsx
<VoiceCapsule mode={voice.mode} onStop={voice.speakStop} />;
{
  voice.notice !== null && (
    <p className="text-xs text-[color:var(--color-text-ghost)]" role="status">
      {voice.notice}
    </p>
  );
}
```

**(h) Bouton micro** — remplacer le bouton placeholder désactivé (l.519-527) par :

```tsx
<button
  type="button"
  className="h-8 w-8 rounded-full bg-[color:var(--color-bg-hover)] text-sm disabled:opacity-45"
  title="Maintenir pour parler (ou maintenir ⌥ Option)"
  aria-label="Maintenir pour parler"
  disabled={voice.recorderUnsupported}
  onPointerDown={(e) => {
    e.preventDefault(); // pas de focus-steal du champ
    void voice.pressStart();
  }}
  onPointerUp={() => void voice.pressEnd()}
  onPointerLeave={() => {
    // Souris sortie bouton pendant le maintien : équivalent relâche.
    if (voice.mode === 'recording') void voice.pressEnd();
  }}
>
  🎙
</button>
```

**(i) Placeholder du champ** — l.510, remplacer par :

```ts
placeholder = 'Demandez quelque chose… ou maintenez ⌥ Option pour parler';
```

- [ ] **Step 6: Add integration tests to `assistant-chat.test.tsx`**

Le fichier mocke déjà fetch/SSE (suivre ses helpers existants — lire ses ~50 premières lignes avant d'écrire). Add a `describe('mode voix')` block covering:

```tsx
// Cas 1 — PTT clavier : keydown Alt (champ non focus) → capsule "recording" ;
// keyup Alt → POST /api/assistant/voice/transcribe (mocké → { transcript: 'quelles cartes sont bloquées ?' })
// → une bulle user avec ce texte apparaît et POST /api/assistant/chat part.
// Cas 2 — symétrie : après un tour VOCAL avec SSE chunks « C'est fait. Voilà. »,
// des POST /api/assistant/voice/speak sont partis (au moins 1, texte = phrase) ;
// après un tour CLAVIER identique, AUCUN appel à /speak.
// Cas 3 — confirmation vocale : SSE émet confirm_request (tour vocal) ;
// nouveau PTT dont le transcript mocké est « oui » → POST /api/assistant/confirm
// avec { allowed: true } ; transcript « euh peut-être » → PAS de POST confirm,
// et un /speak « Dis clairement oui ou non… » est parti.
// Cas 4 — Échap pendant l'écoute → pas d'appel /transcribe.
// Mock MediaRecorder/mediaDevices : réutiliser la classe FakeMediaRecorder de
// use-voice-recorder.test.ts (l'extraire dans un helper partagé
// apps/web/features/assistant/hooks/fake-media-recorder.ts si besoin).
// Mock AudioContext : classe FakeAudioContext de use-speech-queue.test.ts (idem).
```

Écrire ces 4 cas en entier (pas de pseudo-code) en réutilisant les patterns du fichier (rendu `<AssistantChat csrfToken="tok" firstName="Angelo" />`, mocks fetch par URL).

- [ ] **Step 7: Run the full web test suite**

Run: `pnpm --filter @nexushub/web test`
Expected: PASS — dont les tests existants d'assistant-chat (aucune régression : un tour clavier ne doit déclencher AUCUN appel voice).

- [ ] **Step 8: Typecheck + lint**

Run: `pnpm --filter @nexushub/web typecheck && pnpm --filter @nexushub/web lint`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/web/features/assistant/
git commit -m "feat(assistant): voice mode integration — PTT, symmetric TTS, voice confirm"
```

---

### Task 10: E2E Playwright (fake media, mocks STT/TTS)

**Files:**

- Create: `e2e/tests/assistant-voice.spec.ts`
- Modify: `e2e/playwright.config.ts` (flags fake media Chromium)

- [ ] **Step 1: Add fake-media launch args**

In `e2e/playwright.config.ts`, in the chromium project's `use` (l.24 `use: { ...devices['Desktop Chrome'] }`), extend to:

```ts
      use: {
        ...devices['Desktop Chrome'],
        // Voix (V1.5) : micro factice — getUserMedia accordé sans dialog,
        // MediaRecorder produit un vrai webm silencieux. Sans effet sur les
        // autres specs.
        launchOptions: {
          args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
        },
      },
```

- [ ] **Step 2: Write the spec**

```ts
// e2e/tests/assistant-voice.spec.ts
import { expect, test } from '@playwright/test';
import { signIn } from '../helpers/sign-in';

/**
 * Parcours voix (spec §7) — gated comme assistant.spec.ts : nécessite un
 * serveur lancé avec ASSISTANT_E2E_MOCK=1 et E2E_ASSISTANT=1 côté runner.
 * Le mock STT serveur renvoie TOUJOURS « e2e:briefing » (E2E_MOCK_TRANSCRIPT),
 * que le provider scripté transforme en tour briefing ; le mock TTS renvoie
 * un WAV silencieux. Copier le mécanisme de skip exact d'assistant.spec.ts.
 */
test.describe('assistant voice (mock)', () => {
  test.skip(process.env.E2E_ASSISTANT !== '1', 'E2E_ASSISTANT=1 requis');

  test('PTT → transcript en bulle user → tour agent complet', async ({ page }) => {
    await signIn(page);
    await page.goto('/assistant');
    // PTT : maintien Option ~600 ms puis relâche.
    await page.keyboard.down('Alt');
    await expect(page.getByTestId('voice-capsule')).toHaveAttribute('data-mode', 'recording');
    await expect(page.getByTestId('assistant-orb')).toHaveAttribute('data-activity', 'listening');
    await page.waitForTimeout(600);
    await page.keyboard.up('Alt');
    // Transcript mocké inséré comme message utilisateur.
    await expect(page.getByText('e2e:briefing')).toBeVisible();
    // Le tour agent scripté déroule le briefing (widget KPI + texte final).
    await expect(page.getByText('Voici votre briefing.')).toBeVisible({ timeout: 15_000 });
  });

  test('Échap pendant l’écoute annule sans envoyer', async ({ page }) => {
    await signIn(page);
    await page.goto('/assistant');
    await page.keyboard.down('Alt');
    await expect(page.getByTestId('voice-capsule')).toHaveAttribute('data-mode', 'recording');
    await page.keyboard.press('Escape');
    await page.keyboard.up('Alt');
    await expect(page.getByTestId('voice-capsule')).toHaveCount(0);
    await expect(page.getByText('e2e:briefing')).toHaveCount(0);
  });
});
```

Adapter les deux détails suivants au fichier réel `e2e/tests/assistant.spec.ts` avant de finaliser : la signature exacte de `signIn` et le mécanisme de skip/gating (les copier à l'identique).

- [ ] **Step 3: Run the voice spec locally**

Run (deux terminaux ou `&`) :

```bash
ASSISTANT_E2E_MOCK=1 pnpm --filter @nexushub/web dev &
E2E_ASSISTANT=1 pnpm --filter e2e exec playwright test assistant-voice --project=chromium
```

Expected: 2 passed. (Si les identifiants E2E_USER_EMAIL/PASSWORD ne sont pas dans l'env local, marquer la tâche DONE_WITH_CONCERNS en le signalant — ne pas inventer d'identifiants.)

- [ ] **Step 4: Verify the CI smoke job is untouched**

Le job CI ne lance que `smoke.spec.ts` — vérifier qu'aucune modification de config ne l'affecte : `git diff e2e/playwright.config.ts` ne doit toucher que `launchOptions`.

- [ ] **Step 5: Commit**

```bash
git add e2e/tests/assistant-voice.spec.ts e2e/playwright.config.ts
git commit -m "test(assistant): E2E voice PTT flow with fake media + mocked STT/TTS"
```

---

### Task 11: Docs + finitions

**Files:**

- Modify: `CLAUDE.md` (§11 journal — une ligne)
- Modify: `progress.md` (statut itération voix)
- Modify: `docs/security.md` (si le fichier liste les intégrations externes : ajouter Deepgram/ElevenLabs, clés serveur, pas de rétention audio)

- [ ] **Step 1: CLAUDE.md journal** — add one row to the §11 table:

```markdown
| 2026-08-03 | Assistant voix V1.5 — PTT ⌥ Option, Deepgram nova-3 (STT), ElevenLabs flash (TTS streaming), confirmation vocale stricte, routes voice rate-limitées | Angelo L. + Claude |
```

- [ ] **Step 2: progress.md** — dans la section assistant, marquer l'itération voix livrée (PTT, STT/TTS, confirmation vocale, E2E) + rappeler les 3 variables Vercel à créer (`DEEPGRAM_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`).

- [ ] **Step 3: Full check**

Run: `pnpm typecheck && pnpm lint && pnpm --filter @nexushub/agent test && pnpm --filter @nexushub/web test`
Expected: ALL PASS.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md progress.md docs/security.md
git commit -m "docs(assistant): voice iteration journal + progress + security notes"
```

---

## Notes de fin (pour le contrôleur de l'exécution)

1. **Clés API** : à AUCUN moment un subagent ne doit inventer ou committer une valeur de clé. Les vraies clés (`DEEPGRAM_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`) seront demandées à Angelo par le contrôleur au moment du test manuel en local/Vercel — l'app doit fonctionner sans (routes → 503, message générique).
2. **Ordre** : Tasks 1-3 sont indépendantes ; 4-5 dépendent de 3 ; 6-7 sont indépendantes ; 8 avant 9 ; 9 dépend de 1, 2, 6, 7, 8 ; 10 dépend de 9 ; 11 en dernier.
3. **PR** : une seule PR `feat/assistant-voice` → main, après revue holistique (superpowers:requesting-code-review) et migrations : AUCUNE migration DB dans ce plan (zéro changement de schéma).
4. **Test manuel de bout en bout** (avec Angelo, après merge des clés dans Vercel/`.env.local`) : parler → transcript exact → réponse parlée ; interruption ; confirmation vocale sur un envoi de mail.
