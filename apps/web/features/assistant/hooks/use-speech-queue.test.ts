// apps/web/features/assistant/hooks/use-speech-queue.test.ts
// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSpeechQueue } from './use-speech-queue';

/** Faux AudioContext : lecture instantanée (onended via microtask au start). */
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
});
