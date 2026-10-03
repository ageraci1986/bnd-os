import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getCardAttachmentUrl, getCardAttachmentThumbUrls } = vi.hoisted(() => ({
  getCardAttachmentUrl: vi.fn(),
  getCardAttachmentThumbUrls: vi.fn(),
}));
vi.mock('../actions/card-attachments', () => ({
  getCardAttachmentUrl,
  getCardAttachmentThumbUrls,
}));

import {
  getAttachmentInlineUrl,
  getAttachmentThumbUrl,
  resetAttachmentUrlCache,
} from './attachment-url-cache';

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

describe('getAttachmentThumbUrl', () => {
  beforeEach(() => {
    resetAttachmentUrlCache();
    getCardAttachmentUrl.mockReset();
    getCardAttachmentThumbUrls.mockReset();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('loads every thumbnail of a card with ONE batch call shared by concurrent callers', async () => {
    getCardAttachmentThumbUrls.mockResolvedValue({ ok: true, urls: { a: 'ua', b: 'ub' } });
    const [a, b] = await Promise.all([
      getAttachmentThumbUrl('card', 'a'),
      getAttachmentThumbUrl('card', 'b'),
    ]);
    expect([a, b]).toEqual(['ua', 'ub']);
    expect(getCardAttachmentThumbUrls).toHaveBeenCalledTimes(1);
    expect(getCardAttachmentThumbUrls).toHaveBeenCalledWith({ cardId: 'card' });
    expect(getCardAttachmentUrl).not.toHaveBeenCalled();
  });

  it('fills the shared cache (viewer reuses it) and refetches only when stale or forced', async () => {
    getCardAttachmentThumbUrls.mockResolvedValueOnce({ ok: true, urls: { a: 'ua' } });
    getCardAttachmentThumbUrls.mockResolvedValueOnce({ ok: true, urls: { a: 'ua2' } });
    expect(await getAttachmentThumbUrl('card', 'a')).toBe('ua');
    expect(await getAttachmentInlineUrl('a')).toBe('ua');
    expect(await getAttachmentThumbUrl('card', 'a')).toBe('ua');
    expect(getCardAttachmentThumbUrls).toHaveBeenCalledTimes(1);
    expect(await getAttachmentThumbUrl('card', 'a', { force: true })).toBe('ua2');
    expect(getCardAttachmentThumbUrls).toHaveBeenCalledTimes(2);
  });

  it('returns null when the batch fails or omits the attachment', async () => {
    getCardAttachmentThumbUrls.mockResolvedValueOnce({
      ok: false,
      code: 'RATE_LIMIT',
      message: 'x',
    });
    expect(await getAttachmentThumbUrl('card', 'a')).toBeNull();
    getCardAttachmentThumbUrls.mockResolvedValueOnce({ ok: true, urls: {} });
    expect(await getAttachmentThumbUrl('card', 'a')).toBeNull();
    getCardAttachmentThumbUrls.mockRejectedValueOnce(new Error('network'));
    expect(await getAttachmentThumbUrl('card', 'a')).toBeNull();
  });
});
