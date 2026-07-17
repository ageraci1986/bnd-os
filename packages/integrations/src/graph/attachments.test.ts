import { describe, it, expect, vi, beforeEach } from 'vitest';

// NOTE: the real `graphFetch` signature is `graphFetch(url, opts)` where
// `opts.token` carries the bearer token (see client.ts), not
// `graphFetch(token, path, opts)`. Mirrors the mocking convention used in
// send.test.ts.
const graphFetchMock = vi.fn(async (url: string, opts: { raw?: boolean } = {}) => {
  if (url.endsWith('/attachments') && !opts.raw) {
    return {
      value: [
        {
          '@odata.type': '#microsoft.graph.fileAttachment',
          id: 'ATT-1',
          name: 'rapport.pdf',
          contentType: 'application/pdf',
          size: 12345,
          contentId: null,
          isInline: false,
        },
        {
          '@odata.type': '#microsoft.graph.itemAttachment',
          id: 'ATT-2',
          name: 'nested-mail.eml',
        },
        {
          '@odata.type': '#microsoft.graph.fileAttachment',
          id: 'ATT-3',
          name: 'logo.png',
          contentType: 'image/png',
          size: 500,
          contentId: 'logo@ex.com',
          isInline: true,
        },
      ],
    };
  }
  if (url.endsWith('/$value') && opts.raw) {
    return Buffer.from('binary-data');
  }
  return {};
});

vi.mock('./client', () => ({
  graphFetch: (...args: unknown[]) => graphFetchMock(...(args as [string, { raw?: boolean }])),
}));

const { listGraphAttachments, fetchGraphAttachmentBinary } = await import('./attachments');

describe('listGraphAttachments', () => {
  beforeEach(() => {
    graphFetchMock.mockClear();
  });

  it('filters out non-file attachments (itemAttachment, referenceAttachment)', async () => {
    const r = await listGraphAttachments('token', 'MSG-1');
    expect(r).toHaveLength(2);
    expect(r.map((a) => a.id)).toEqual(['ATT-1', 'ATT-3']);
  });

  it('preserves isInline + contentId for cid: references', async () => {
    const r = await listGraphAttachments('token', 'MSG-1');
    const logo = r.find((a) => a.id === 'ATT-3');
    expect(logo?.isInline).toBe(true);
    expect(logo?.contentId).toBe('logo@ex.com');
  });
});

describe('fetchGraphAttachmentBinary', () => {
  it('returns the raw buffer from the $value endpoint', async () => {
    const b = await fetchGraphAttachmentBinary('token', 'MSG-1', 'ATT-1');
    expect(b).toBeInstanceOf(Buffer);
    expect(b?.toString()).toBe('binary-data');
  });
});
