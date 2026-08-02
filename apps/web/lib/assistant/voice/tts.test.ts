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
    mockEnv.env.NODE_ENV = 'test';
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

  it('garde double : mock OFF en production même si ASSISTANT_E2E_MOCK=1', async () => {
    mockEnv.env.ASSISTANT_E2E_MOCK = '1';
    mockEnv.env.NODE_ENV = 'production';
    mockEnv.env.ELEVENLABS_API_KEY = undefined as unknown as string;
    await expect(synthesizeSpeech('x')).rejects.toBeInstanceOf(TtsNotConfiguredError);
    expect(fetch).not.toHaveBeenCalled();
  });
});
