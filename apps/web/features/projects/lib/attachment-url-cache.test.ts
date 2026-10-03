import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getCardAttachmentUrl } = vi.hoisted(() => ({ getCardAttachmentUrl: vi.fn() }));
vi.mock('../actions/card-attachments', () => ({ getCardAttachmentUrl }));

import { getAttachmentInlineUrl, resetAttachmentUrlCache } from './attachment-url-cache';

describe('getAttachmentInlineUrl', () => {
  beforeEach(() => {
    resetAttachmentUrlCache();
    getCardAttachmentUrl.mockReset();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('caches for 4 minutes, then refreshes', async () => {
    getCardAttachmentUrl.mockResolvedValueOnce({ ok: true, url: 'u1' });
    getCardAttachmentUrl.mockResolvedValueOnce({ ok: true, url: 'u2' });
    expect(await getAttachmentInlineUrl('a')).toBe('u1');
    vi.advanceTimersByTime(3 * 60 * 1000);
    expect(await getAttachmentInlineUrl('a')).toBe('u1');
    expect(getCardAttachmentUrl).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(61 * 1000);
    expect(await getAttachmentInlineUrl('a')).toBe('u2');
    expect(getCardAttachmentUrl).toHaveBeenCalledWith({ attachmentId: 'a', disposition: 'inline' });
  });

  it('dedupes concurrent calls and returns null on error', async () => {
    getCardAttachmentUrl.mockResolvedValue({ ok: false, code: 'NOT_READY', message: 'x' });
    const [a, b] = await Promise.all([getAttachmentInlineUrl('b'), getAttachmentInlineUrl('b')]);
    expect(a).toBeNull();
    expect(b).toBeNull();
    expect(getCardAttachmentUrl).toHaveBeenCalledTimes(1);
  });
});
