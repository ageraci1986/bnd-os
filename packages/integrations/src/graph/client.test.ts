import { describe, expect, it, vi, beforeEach } from 'vitest';
import { graphFetch } from './client';

describe('graphFetch', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns parsed JSON on 200', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ value: 42 }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const res = await graphFetch<{ value: number }>('https://example/api', { token: 'tok' });
    expect(res).toEqual({ value: 42 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer tok' });
  });

  it('retries on 429 with backoff and succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Headers(),
        text: async () => '',
      })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);
    const res = await graphFetch('https://example/api', {
      token: 'tok',
      sleep: () => Promise.resolve(),
    });
    expect(res).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws GraphError with status on 4xx (non-429)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => '{"error":{"code":"InvalidAuthenticationToken"}}',
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(graphFetch('https://example/api', { token: 'tok' })).rejects.toMatchObject({
      name: 'GraphError',
      status: 401,
    });
  });

  it('gives up after 3 retries on persistent 503', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 503, headers: new Headers(), text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      graphFetch('https://example/api', { token: 'tok', sleep: () => Promise.resolve() }),
    ).rejects.toMatchObject({ name: 'GraphError', status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(4); // initial + 3 retries
  });
});
