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
  // Garde double identique au provider Deepgram (jamais actif en production).
  if (env.ASSISTANT_E2E_MOCK === '1' && env.NODE_ENV !== 'production') {
    return { body: new Response(silentWav().buffer as ArrayBuffer).body, contentType: 'audio/wav' };
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
