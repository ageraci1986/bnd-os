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
    mockEnv.env.NODE_ENV = 'test';
    mockEnv.env.ASSISTANT_E2E_MOCK = undefined;
    mockEnv.env.DEEPGRAM_API_KEY = 'dg-test-key-0123456789';
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it('appelle Deepgram avec le modèle nova-3 multi et renvoie le transcript', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(
        JSON.stringify({
          results: { channels: [{ alternatives: [{ transcript: ' Bonjour BND OS ' }] }] },
        }),
        { status: 200 },
      ),
    );
    const out = await transcribeAudio(new Uint8Array([1, 2, 3]).buffer, 'audio/webm');
    expect(out).toBe('Bonjour BND OS');
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

  it('garde double : E2E mock ignoré en production même sans clé', async () => {
    mockEnv.env.ASSISTANT_E2E_MOCK = '1';
    mockEnv.env.NODE_ENV = 'production';
    mockEnv.env.DEEPGRAM_API_KEY = undefined as unknown as string;
    await expect(transcribeAudio(new ArrayBuffer(4), 'audio/webm')).rejects.toBeInstanceOf(
      SttNotConfiguredError,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  const okBody = JSON.stringify({
    results: { channels: [{ alternatives: [{ transcript: 'ok' }] }] },
  });

  it('ajoute un paramètre keyterm par terme, encodé', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(okBody, { status: 200 }));
    await transcribeAudio(new ArrayBuffer(4), 'audio/webm', ['Angelo Geraci', 'Izybizi']);
    const url = new URL(String((fetch as ReturnType<typeof vi.fn>).mock.calls[0]![0]));
    expect(url.searchParams.getAll('keyterm')).toEqual(['Angelo Geraci', 'Izybizi']);
    expect(url.searchParams.get('model')).toBe('nova-3');
    expect(url.searchParams.get('language')).toBe('multi');
    expect(url.searchParams.get('smart_format')).toBe('true');
  });

  it('sans terme, aucun paramètre keyterm', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(okBody, { status: 200 }));
    await transcribeAudio(new ArrayBuffer(4), 'audio/webm');
    const url = new URL(String((fetch as ReturnType<typeof vi.fn>).mock.calls[0]![0]));
    expect(url.searchParams.getAll('keyterm')).toEqual([]);
  });

  it('réessaie UNE fois sans termes quand Deepgram répond 400 à une requête avec termes', async () => {
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(new Response('Keyterm limit exceeded', { status: 400 }))
      .mockResolvedValueOnce(new Response(okBody, { status: 200 }));
    await expect(transcribeAudio(new ArrayBuffer(4), 'audio/webm', ['Izybizi'])).resolves.toBe(
      'ok',
    );
    const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(2);
    expect(new URL(String(calls[0]![0])).searchParams.getAll('keyterm')).toEqual(['Izybizi']);
    expect(new URL(String(calls[1]![0])).searchParams.getAll('keyterm')).toEqual([]);
    // Le réessai renvoie le MÊME audio, avec les mêmes en-têtes.
    const first = calls[0]![1] as RequestInit;
    const second = calls[1]![1] as RequestInit;
    expect(second.body).toBe(first.body);
    expect(second.headers).toEqual(first.headers);
  });

  it('signale le refus des termes sans jamais logger un terme', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(new Response('Keyterm limit exceeded', { status: 400 }))
      .mockResolvedValueOnce(new Response(okBody, { status: 200 }));
    await transcribeAudio(new ArrayBuffer(4), 'audio/webm', ['Angelo Geraci', 'Izybizi']);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![1]).toEqual({ count: 2 });
    expect(JSON.stringify(warn.mock.calls[0])).not.toMatch(/Geraci|Izybizi|limit exceeded/);
    warn.mockRestore();
  });

  it('ne réessaie pas un 400 sans rapport avec les termes (audio illisible)', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response('Bad Request: failed to process audio: corrupt or unsupported data', {
        status: 400,
      }),
    );
    await expect(
      transcribeAudio(new ArrayBuffer(4), 'audio/webm', ['Izybizi']),
    ).rejects.toBeInstanceOf(SttProviderError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('borne chaque requête par un délai', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(okBody, { status: 200 }));
    await transcribeAudio(new ArrayBuffer(4), 'audio/webm');
    const init = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('ne réessaie pas un 400 sans termes', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response('bad', { status: 400 }));
    await expect(transcribeAudio(new ArrayBuffer(4), 'audio/webm')).rejects.toBeInstanceOf(
      SttProviderError,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('ne réessaie pas un autre statut que 400, même avec des termes', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response('down', { status: 503 }));
    await expect(
      transcribeAudio(new ArrayBuffer(4), 'audio/webm', ['Izybizi']),
    ).rejects.toBeInstanceOf(SttProviderError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('un second 400 après réessai jette SttProviderError', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(new Response('Keyterm limit exceeded', { status: 400 }))
      .mockResolvedValueOnce(new Response('bad', { status: 400 }));
    await expect(
      transcribeAudio(new ArrayBuffer(4), 'audio/webm', ['Izybizi']),
    ).rejects.toBeInstanceOf(SttProviderError);
    expect(fetch).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("l'erreur ne contient jamais un terme du glossaire (PII)", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response('down', { status: 500 }));
    const err = await transcribeAudio(new ArrayBuffer(4), 'audio/webm', ['Angelo Geraci']).catch(
      (e: unknown) => e,
    );
    expect(String((err as Error).message)).not.toContain('Geraci');
  });
});
