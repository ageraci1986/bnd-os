// apps/web/features/assistant/hooks/use-speech-queue.test.ts
// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSpeechQueue } from './use-speech-queue';

interface FakeSource {
  buffer: AudioBuffer | null;
  onended: (() => void) | null;
  connect: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}

/** Faux AudioContext : lecture instantanée (onended via microtask au start). */
class FakeAudioContext {
  static created = 0;
  /** Toutes les sources créées, dans l'ordre — pour asserter sur la bonne instance. */
  static sources: FakeSource[] = [];
  /** false → onended ne se déclenche jamais tout seul (timing contrôlé par le test). */
  static autoEnd = true;
  state = 'running';
  constructor() {
    FakeAudioContext.created += 1;
  }
  decodeAudioData(buf: ArrayBuffer): Promise<AudioBuffer> {
    if (buf.byteLength === 0) return Promise.reject(new Error('decode'));
    return Promise.resolve({ duration: 0.1 } as AudioBuffer);
  }
  createBufferSource() {
    const source: FakeSource = {
      buffer: null,
      onended: null,
      connect: vi.fn(),
      start: vi.fn(() => {
        if (FakeAudioContext.autoEnd) queueMicrotask(() => source.onended?.());
      }),
      stop: vi.fn(),
    };
    FakeAudioContext.sources.push(source);
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
    FakeAudioContext.sources = [];
    FakeAudioContext.autoEnd = true;
    vi.stubGlobal('AudioContext', FakeAudioContext);
    // Une Response FRAÎCHE par appel : un body de Response ne se consomme
    // qu'une fois — un mockResolvedValue partagé ferait échouer arrayBuffer()
    // dès la 2e phrase (« body already used »).
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(new Uint8Array([1, 2]), { status: 200 }))),
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
    // La 2e phrase a bien été JOUÉE (pas seulement fetchée) : une seule
    // source créée (la phrase en échec n'atteint jamais la lecture) et démarrée.
    expect(FakeAudioContext.sources).toHaveLength(1);
    expect(FakeAudioContext.sources[0]!.start).toHaveBeenCalledTimes(1);
  });

  it('un échec de DÉCODAGE (pas seulement réseau) est sauté, la suivante joue', async () => {
    (fetch as ReturnType<typeof vi.fn>)
      // Body vide → byteLength 0 → decodeAudioData rejette (voir FakeAudioContext).
      .mockResolvedValueOnce(new Response(new Uint8Array(0), { status: 200 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1]), { status: 200 }));
    const { result } = renderHook(() => useSpeechQueue('t'));
    act(() => {
      result.current.enqueue('Indécodable.');
      result.current.enqueue('Lisible.');
    });
    await waitFor(() => expect(result.current.speaking).toBe(false));
    expect(fetch).toHaveBeenCalledTimes(2);
    // Seule la 2e phrase atteint la lecture.
    expect(FakeAudioContext.sources).toHaveLength(1);
    expect(FakeAudioContext.sources[0]!.start).toHaveBeenCalledTimes(1);
  });

  it('après stop(), un nouvel enqueue relance la file (réutilisable pour le tour suivant)', async () => {
    const { result } = renderHook(() => useSpeechQueue('t'));
    act(() => {
      result.current.enqueue('Une.');
      result.current.enqueue('Deux.');
    });
    act(() => result.current.stop());
    await waitFor(() => expect(result.current.speaking).toBe(false));
    const callsAfterStop = (fetch as ReturnType<typeof vi.fn>).mock.calls.length;

    act(() => result.current.enqueue('Nouvelle phrase.'));
    await waitFor(() => expect(result.current.speaking).toBe(true));
    await waitFor(() => expect(result.current.speaking).toBe(false));

    expect((fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsAfterStop + 1);
    const lastCall = (fetch as ReturnType<typeof vi.fn>).mock.calls.at(-1)!;
    expect(JSON.parse(String((lastCall[1] as RequestInit).body))).toEqual({
      text: 'Nouvelle phrase.',
    });
  });

  it("l'onended en retard d'un run stoppé n'efface pas la source du run suivant", async () => {
    // Timing contrôlé : les sources ne se terminent jamais toutes seules.
    FakeAudioContext.autoEnd = false;
    const { result } = renderHook(() => useSpeechQueue('t'));

    // Phrase A démarre et « joue » (drain A suspendu sur la promesse de lecture).
    act(() => result.current.enqueue('A.'));
    await waitFor(() => expect(FakeAudioContext.sources).toHaveLength(1));
    const sourceA = FakeAudioContext.sources[0]!;
    expect(sourceA.start).toHaveBeenCalledTimes(1);

    // stop() : coupe A (son onended arrivera EN RETARD), bump du runId.
    act(() => result.current.stop());
    expect(sourceA.stop).toHaveBeenCalledTimes(1);

    // Nouveau tour : B démarre, sourceRef pointe sur sourceB.
    act(() => result.current.enqueue('B.'));
    await waitFor(() => expect(FakeAudioContext.sources).toHaveLength(2));
    const sourceB = FakeAudioContext.sources[1]!;
    expect(sourceB.start).toHaveBeenCalledTimes(1);

    // L'onended tardif de A réveille le drain périmé de A pendant que B joue.
    // Sans le guard runId sur le null-out, il écraserait sourceRef (= sourceB).
    await act(async () => {
      sourceA.onended?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Un second stop() doit encore pouvoir couper B.
    act(() => result.current.stop());
    expect(sourceB.stop).toHaveBeenCalledTimes(1);
  });

  it('stop() pendant le fetch : la branche AbortError sort proprement et la file reste réutilisable', async () => {
    const fetchMock = fetch as ReturnType<typeof vi.fn>;
    // 1er fetch : suspendu jusqu'à l'abort du signal → rejet AbortError réel.
    fetchMock.mockImplementationOnce(
      (_url: unknown, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    );
    const { result } = renderHook(() => useSpeechQueue('t'));
    act(() => result.current.enqueue('Interrompue.'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.speaking).toBe(true));

    // stop() → abortRef.abort() → le fetch en vol rejette AbortError.
    act(() => result.current.stop());
    await waitFor(() => expect(result.current.speaking).toBe(false));
    // La phrase interrompue n'a jamais atteint la lecture.
    expect(FakeAudioContext.sources).toHaveLength(0);

    // La file repart normalement après l'abort.
    act(() => result.current.enqueue('Après.'));
    await waitFor(() => expect(result.current.speaking).toBe(false));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(FakeAudioContext.sources).toHaveLength(1);
    expect(FakeAudioContext.sources[0]!.start).toHaveBeenCalledTimes(1);
  });
});
