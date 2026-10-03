import { describe, expect, it } from 'vitest';
import { formatAttachmentSize, resolveUploadContentType } from './attachment-format';

describe('resolveUploadContentType', () => {
  it('keeps an allowed declared type', () => {
    expect(resolveUploadContentType({ name: 'a.PNG', type: 'image/png' })).toBe('image/png');
  });
  it('infers from the extension when the browser type is generic', () => {
    expect(resolveUploadContentType({ name: 'x.csv', type: 'application/vnd.ms-excel' })).toBe(
      'text/csv',
    );
    expect(resolveUploadContentType({ name: 'p.heic', type: '' })).toBe('image/heic');
    expect(resolveUploadContentType({ name: 'z.zip', type: 'application/x-zip-compressed' })).toBe(
      'application/zip',
    );
  });
  it('rejects disallowed files', () => {
    expect(resolveUploadContentType({ name: 'evil.exe', type: 'application/x-msdownload' })).toBe(
      null,
    );
    expect(resolveUploadContentType({ name: 'evil.exe', type: '' })).toBe(null);
    expect(resolveUploadContentType({ name: 'a.png', type: 'text/html' })).toBe(null);
  });
});

describe('formatAttachmentSize', () => {
  it('formats bytes, Ko and Mo', () => {
    expect(formatAttachmentSize(500)).toBe('500 o');
    expect(formatAttachmentSize(2048)).toBe('2 Ko');
    expect(formatAttachmentSize(1.5 * 1024 * 1024)).toBe('1,5 Mo');
  });
});
