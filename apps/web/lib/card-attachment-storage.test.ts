import { describe, expect, it, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => {
  const bucket = {
    createSignedUploadUrl: vi.fn(),
    createSignedUrl: vi.fn(),
    createSignedUrls: vi.fn(),
    download: vi.fn(),
    info: vi.fn(),
    remove: vi.fn(),
  };
  return { bucket, from: vi.fn(() => bucket) };
});
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseAdmin: () => ({ storage: { from: m.from } }),
}));

import {
  CARD_ATTACHMENTS_BUCKET,
  cardAttachmentPath,
  createCardAttachmentUploadUrl,
  getCardAttachmentSignedUrl,
  getCardAttachmentSignedUrls,
  downloadCardAttachment,
  removeCardAttachment,
  statCardAttachment,
} from './card-attachment-storage';

beforeEach(() => {
  for (const f of Object.values(m.bucket)) f.mockReset();
  m.from.mockClear();
});

describe('card attachment storage', () => {
  it('builds the workspace/card/id path', () => {
    expect(cardAttachmentPath('ws', 'card', 'att')).toBe('ws/card/att');
  });

  it('creates a signed upload URL in the private bucket', async () => {
    m.bucket.createSignedUploadUrl.mockResolvedValue({
      data: { signedUrl: 'https://x/upload?token=t', token: 't', path: 'ws/card/att' },
      error: null,
    });
    const res = await createCardAttachmentUploadUrl('ws/card/att');
    expect(m.from).toHaveBeenCalledWith(CARD_ATTACHMENTS_BUCKET);
    expect(res).toEqual({
      ok: true,
      signedUrl: 'https://x/upload?token=t',
      token: 't',
      path: 'ws/card/att',
    });
  });

  it('signs read URLs for 300 s, with download disposition when asked', async () => {
    m.bucket.createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://x/r' }, error: null });
    await getCardAttachmentSignedUrl('p', { download: 'a.pdf' });
    expect(m.bucket.createSignedUrl).toHaveBeenCalledWith('p', 300, { download: 'a.pdf' });
    await getCardAttachmentSignedUrl('p', {});
    expect(m.bucket.createSignedUrl).toHaveBeenLastCalledWith('p', 300, undefined);
  });

  it('batch-signs inline read URLs for 300 s in one call, skipping per-path failures', async () => {
    m.bucket.createSignedUrls.mockResolvedValueOnce({
      data: [
        { path: 'p1', signedUrl: 'https://x/1', error: null },
        { path: 'p2', signedUrl: null, error: 'Either the object does not exist' },
      ],
      error: null,
    });
    const res = await getCardAttachmentSignedUrls(['p1', 'p2']);
    expect(m.bucket.createSignedUrls).toHaveBeenCalledWith(['p1', 'p2'], 300);
    expect(res).toEqual({ ok: true, urls: new Map([['p1', 'https://x/1']]) });

    m.bucket.createSignedUrls.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    expect((await getCardAttachmentSignedUrls(['p1'])).ok).toBe(false);
  });

  it('batch-signing nothing makes no Storage call', async () => {
    expect(await getCardAttachmentSignedUrls([])).toEqual({ ok: true, urls: new Map() });
    expect(m.bucket.createSignedUrls).not.toHaveBeenCalled();
  });

  it('downloads to a Buffer and reports missing objects', async () => {
    // NOTE: jsdom's `Blob` polyfill doesn't implement `arrayBuffer()` (the
    // real Supabase Storage SDK returns a Blob backed by fetch/undici, which
    // does) — use a fake with the method, same pattern as
    // mail-attachment-storage.test.ts's downloadMailAttachment test.
    m.bucket.download.mockResolvedValueOnce({
      data: { arrayBuffer: async () => new Uint8Array([1, 2]).buffer },
      error: null,
    });
    const ok = await downloadCardAttachment('p');
    expect(ok.ok && ok.binary.length).toBe(2);
    m.bucket.download.mockResolvedValueOnce({ data: null, error: { message: 'Object not found' } });
    expect((await downloadCardAttachment('p')).ok).toBe(false);
  });

  it('stats an object: stored size + MIME, undefined when absent, fail on error', async () => {
    m.bucket.info.mockResolvedValueOnce({
      data: { size: 42, contentType: 'application/pdf', name: 'att' },
      error: null,
    });
    expect(await statCardAttachment('p')).toEqual({
      ok: true,
      size: 42,
      contentType: 'application/pdf',
    });
    expect(m.bucket.info).toHaveBeenCalledWith('p');
    m.bucket.info.mockResolvedValueOnce({ data: { name: 'att' }, error: null });
    expect(await statCardAttachment('p')).toEqual({
      ok: true,
      size: undefined,
      contentType: undefined,
    });
    m.bucket.info.mockResolvedValueOnce({ data: null, error: { message: 'Object not found' } });
    expect((await statCardAttachment('p')).ok).toBe(false);
  });

  it('remove is best-effort', async () => {
    m.bucket.remove.mockRejectedValue(new Error('boom'));
    await expect(removeCardAttachment('p')).resolves.toBeUndefined();
  });
});
