import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchWithCsrfRetry } from './csrf-retry';

function csrfInvalidResponse(): Response {
  return new Response(JSON.stringify({ ok: false, message: 'CSRF invalide.' }), { status: 403 });
}

describe('fetchWithCsrfRetry', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it('succès direct : aucun appel à /api/assistant/csrf, header envoyé avec le token courant', async () => {
    const fetchMock = fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const getToken = vi.fn().mockReturnValue('tok-1');
    const onNewToken = vi.fn();

    const res = await fetchWithCsrfRetry(
      '/api/assistant/chat',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
      getToken,
      onNewToken,
    );

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('/api/assistant/chat');
    expect((init as RequestInit).headers).toMatchObject({ 'x-csrf-token': 'tok-1' });
    expect(onNewToken).not.toHaveBeenCalled();
  });

  it('403 CSRF → refresh via /api/assistant/csrf + retry unique avec le nouveau token', async () => {
    const fetchMock = fetch as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(csrfInvalidResponse())
      .mockResolvedValueOnce(Response.json({ ok: true, token: 'tok-2' }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const getToken = vi.fn().mockReturnValue('tok-1');
    const onNewToken = vi.fn();

    const res = await fetchWithCsrfRetry(
      '/api/assistant/chat',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
      getToken,
      onNewToken,
    );

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const [firstUrl, firstInit] = fetchMock.mock.calls[0]!;
    expect(String(firstUrl)).toBe('/api/assistant/chat');
    expect((firstInit as RequestInit).headers).toMatchObject({ 'x-csrf-token': 'tok-1' });

    const [refreshUrl] = fetchMock.mock.calls[1]!;
    expect(String(refreshUrl)).toBe('/api/assistant/csrf');

    const [secondUrl, secondInit] = fetchMock.mock.calls[2]!;
    expect(String(secondUrl)).toBe('/api/assistant/chat');
    expect((secondInit as RequestInit).headers).toMatchObject({ 'x-csrf-token': 'tok-2' });

    expect(onNewToken).toHaveBeenCalledTimes(1);
    expect(onNewToken).toHaveBeenCalledWith('tok-2');
  });

  it('403 non-CSRF (message différent) → aucun refresh, la réponse 403 d’origine est renvoyée', async () => {
    const fetchMock = fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, message: 'Trop de requêtes.' }), { status: 403 }),
    );
    const getToken = vi.fn().mockReturnValue('tok-1');
    const onNewToken = vi.fn();

    const res = await fetchWithCsrfRetry('/api/assistant/chat', {}, getToken, onNewToken);

    expect(res.status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onNewToken).not.toHaveBeenCalled();
    // La réponse renvoyée reste lisible par l'appelant (body pas déjà consommé).
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe('Trop de requêtes.');
  });

  it('403 CSRF mais /api/assistant/csrf échoue (non-ok) → renvoie le 403 d’origine, un seul retry tenté', async () => {
    const fetchMock = fetch as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(csrfInvalidResponse())
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    const getToken = vi.fn().mockReturnValue('tok-1');
    const onNewToken = vi.fn();

    const res = await fetchWithCsrfRetry('/api/assistant/chat', {}, getToken, onNewToken);

    expect(res.status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onNewToken).not.toHaveBeenCalled();
  });

  it('403 CSRF mais le refresh JETTE (réseau) → renvoie le 403 d’origine sans lever', async () => {
    const fetchMock = fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(csrfInvalidResponse()).mockRejectedValueOnce(new Error('net'));
    const getToken = vi.fn().mockReturnValue('tok-1');
    const onNewToken = vi.fn();

    const res = await fetchWithCsrfRetry('/api/assistant/chat', {}, getToken, onNewToken);

    expect(res.status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onNewToken).not.toHaveBeenCalled();
  });

  it('500 → jamais de retry, jamais d’appel à /api/assistant/csrf', async () => {
    const fetchMock = fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(new Response('boom', { status: 500 }));
    const getToken = vi.fn().mockReturnValue('tok-1');
    const onNewToken = vi.fn();

    const res = await fetchWithCsrfRetry('/api/assistant/chat', {}, getToken, onNewToken);

    expect(res.status).toBe(500);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onNewToken).not.toHaveBeenCalled();
  });

  it('une réponse retentée qui échoue à nouveau en 403 CSRF n’est PAS re-retentée (jamais de boucle)', async () => {
    const fetchMock = fetch as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(csrfInvalidResponse())
      .mockResolvedValueOnce(Response.json({ ok: true, token: 'tok-2' }))
      .mockResolvedValueOnce(csrfInvalidResponse());
    const getToken = vi.fn().mockReturnValue('tok-1');
    const onNewToken = vi.fn();

    const res = await fetchWithCsrfRetry('/api/assistant/chat', {}, getToken, onNewToken);

    expect(res.status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(onNewToken).toHaveBeenCalledTimes(1);
    expect(onNewToken).toHaveBeenCalledWith('tok-2');
  });
});
