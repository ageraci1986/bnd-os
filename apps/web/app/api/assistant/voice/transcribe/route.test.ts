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

  it('400 sur un audio vide', async () => {
    // NB : dans l'environnement de test jsdom, `Request` avec un body `Blob`
    // sérialise en la chaîne "[object Blob]" au lieu du contenu réel — un
    // Uint8Array(0) est le seul moyen fiable d'obtenir byteLength === 0 ici.
    expect((await POST(makeReq(new Uint8Array(0)))).status).toBe(400);
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
