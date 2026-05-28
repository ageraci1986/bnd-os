import { describe, expect, it, vi, beforeEach } from 'vitest';
import { listInboxInitial, listInboxDelta } from './messages';

describe('listInboxInitial', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('paginates up to maxMessages and returns the deltaLink from the final page', async () => {
    const page1 = {
      value: Array.from({ length: 50 }, (_, i) => ({
        id: `M${i}`,
        receivedDateTime: '2026-05-20T10:00:00Z',
        from: { emailAddress: { address: 'x@y.io' } },
        body: { contentType: 'text', content: '' },
      })),
      '@odata.nextLink': 'https://graph/next1',
    };
    const page2 = {
      value: Array.from({ length: 50 }, (_, i) => ({
        id: `M${50 + i}`,
        receivedDateTime: '2026-05-20T10:00:00Z',
        from: { emailAddress: { address: 'x@y.io' } },
        body: { contentType: 'text', content: '' },
      })),
      '@odata.deltaLink': 'https://graph/delta',
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => page1 })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => page2 });
    vi.stubGlobal('fetch', fetchMock);

    const res = await listInboxInitial({ token: 'tok', sinceDays: 30, maxMessages: 200 });
    expect(res.messages).toHaveLength(100);
    expect(res.deltaLink).toBe('https://graph/delta');
  });

  it('stops at maxMessages cap', async () => {
    const page = {
      value: Array.from({ length: 50 }, (_, i) => ({
        id: `M${i}`,
        receivedDateTime: '2026-05-20T10:00:00Z',
        from: { emailAddress: { address: 'x@y.io' } },
        body: { contentType: 'text', content: '' },
      })),
      '@odata.nextLink': 'https://graph/next',
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => page });
    vi.stubGlobal('fetch', fetchMock);
    const res = await listInboxInitial({ token: 'tok', sinceDays: 30, maxMessages: 75 });
    expect(res.messages).toHaveLength(75);
  });
});

describe('listInboxDelta', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('paginates the delta and returns the new deltaLink + removed ids', async () => {
    const page = {
      value: [
        {
          id: 'M1',
          receivedDateTime: '2026-05-28T10:00:00Z',
          from: { emailAddress: { address: 'x@y.io' } },
          body: { contentType: 'text', content: '' },
        },
        { id: 'M2', '@removed': { reason: 'deleted' } },
      ],
      '@odata.deltaLink': 'https://graph/new-delta',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => page }),
    );
    const res = await listInboxDelta({ token: 'tok', deltaUrl: 'https://graph/old-delta' });
    expect(res.messages).toHaveLength(1);
    expect(res.removedIds).toEqual(['M2']);
    expect(res.deltaLink).toBe('https://graph/new-delta');
  });
});
