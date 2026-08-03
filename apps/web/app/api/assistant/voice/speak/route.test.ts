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
    const res503 = await POST(makeReq({ text: 'x' }));
    expect(res503.status).toBe(503);
    const body503 = (await res503.json()) as { message: string };
    expect(body503.message).not.toMatch(/ELEVENLABS|clé|key/i);
    mocks.synthesizeSpeech.mockRejectedValue(new Error('elevenlabs status 500'));
    expect((await POST(makeReq({ text: 'x' }))).status).toBe(502);
  });
});
