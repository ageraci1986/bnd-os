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

  it('garde double : E2E mock ignoré en production même sans clé', async () => {
    mockEnv.env.ASSISTANT_E2E_MOCK = '1';
    mockEnv.env.NODE_ENV = 'production';
    mockEnv.env.DEEPGRAM_API_KEY = undefined as unknown as string;
    await expect(transcribeAudio(new ArrayBuffer(4), 'audio/webm')).rejects.toBeInstanceOf(
      SttNotConfiguredError,
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});
