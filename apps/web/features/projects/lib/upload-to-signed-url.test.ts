import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { uploadToSignedUrl } from './upload-to-signed-url';

type Listener = (e: { loaded: number; total: number; lengthComputable: boolean }) => void;

class FakeXhr {
  static last: FakeXhr | null = null;
  method = '';
  url = '';
  headers: Record<string, string> = {};
  body: unknown = null;
  status = 0;
  aborted = false;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  upload: { onprogress: Listener | null } = { onprogress: null };
  constructor() {
    FakeXhr.last = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(k: string, v: string) {
    this.headers[k] = v;
  }
  send(body: unknown) {
    this.body = body;
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
}

const SIGNED = 'https://x.supabase.co/storage/v1/object/upload/sign/card-attachments/a/b/c?token=t';

describe('uploadToSignedUrl', () => {
  beforeEach(() => {
    FakeXhr.last = null;
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('PUTs a FormData body like the Supabase SDK, reports progress, resolves on 2xx', async () => {
    const file = new File(['hello'], 'a.png', { type: 'image/png' });
    const onProgress = vi.fn();
    const p = uploadToSignedUrl({ signedUrl: SIGNED, file, contentType: 'image/png', onProgress });
    const xhr = FakeXhr.last!;
    expect(xhr.method).toBe('PUT');
    expect(xhr.url).toBe(SIGNED);
    expect(xhr.headers['x-upsert']).toBe('false');
    // Content-Type must be left to the browser (multipart boundary).
    expect(Object.keys(xhr.headers).map((k) => k.toLowerCase())).not.toContain('content-type');
    expect(xhr.body).toBeInstanceOf(FormData);
    const form = xhr.body as FormData;
    expect(form.get('cacheControl')).toBe('3600');
    const part = form.get('');
    expect(part).toBeInstanceOf(Blob);
    expect((part as Blob).type).toBe('image/png');

    xhr.upload.onprogress?.({ loaded: 50, total: 100, lengthComputable: true });
    expect(onProgress).toHaveBeenCalledWith(0.5);
    xhr.status = 200;
    xhr.onload?.();
    await expect(p).resolves.toBeUndefined();
  });

  it('re-types the part with the resolved content type', async () => {
    const file = new File(['a,b'], 'x.csv', { type: 'application/vnd.ms-excel' });
    const p = uploadToSignedUrl({ signedUrl: SIGNED, file, contentType: 'text/csv' });
    const xhr = FakeXhr.last!;
    expect(((xhr.body as FormData).get('') as Blob).type).toBe('text/csv');
    xhr.status = 201;
    xhr.onload?.();
    await p;
  });

  it('rejects on a non-2xx status', async () => {
    const file = new File(['x'], 'a.pdf', { type: 'application/pdf' });
    const p = uploadToSignedUrl({ signedUrl: SIGNED, file, contentType: 'application/pdf' });
    const xhr = FakeXhr.last!;
    xhr.status = 400;
    xhr.onload?.();
    await expect(p).rejects.toThrow(/400/);
  });

  it('rejects on network error', async () => {
    const file = new File(['x'], 'a.pdf', { type: 'application/pdf' });
    const p = uploadToSignedUrl({ signedUrl: SIGNED, file, contentType: 'application/pdf' });
    FakeXhr.last!.onerror?.();
    await expect(p).rejects.toThrow();
  });

  it('aborts the request when the signal fires', async () => {
    const file = new File(['x'], 'a.pdf', { type: 'application/pdf' });
    const ctrl = new AbortController();
    const p = uploadToSignedUrl({
      signedUrl: SIGNED,
      file,
      contentType: 'application/pdf',
      signal: ctrl.signal,
    });
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(FakeXhr.last!.aborted).toBe(true);
  });
});
