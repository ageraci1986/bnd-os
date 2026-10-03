import { describe, expect, it } from 'vitest';
import {
  CARD_ATTACHMENT_MAX_BYTES,
  CARD_ATTACHMENT_MAX_PER_CARD,
  ALLOWED_CARD_ATTACHMENT_TYPES,
  attachmentKind,
  isAllowedAttachment,
  isSniffCompatible,
  sanitizeAttachmentFilename,
} from './index';

describe('limits', () => {
  it('caps size at 50 MB and count at 50', () => {
    expect(CARD_ATTACHMENT_MAX_BYTES).toBe(50 * 1024 * 1024);
    expect(CARD_ATTACHMENT_MAX_PER_CARD).toBe(50);
  });
});

describe('sanitizeAttachmentFilename', () => {
  it('strips control chars and path separators, trims, caps at 255', () => {
    expect(sanitizeAttachmentFilename('  ../a\\b/c\u0000.pdf ')).toBe('..abc.pdf');
    expect(sanitizeAttachmentFilename('x'.repeat(300) + '.png')).toHaveLength(255);
  });
  it('falls back when empty', () => {
    expect(sanitizeAttachmentFilename('   ')).toBe('fichier');
  });
});

describe('isAllowedAttachment', () => {
  it('accepts allow-listed extension + matching MIME', () => {
    expect(isAllowedAttachment('photo.JPG', 'image/jpeg')).toBe(true);
    expect(isAllowedAttachment('clip.mov', 'video/quicktime')).toBe(true);
    expect(isAllowedAttachment('brief.pdf', 'application/pdf')).toBe(true);
    expect(
      isAllowedAttachment(
        'deck.pptx',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      ),
    ).toBe(true);
  });
  it('rejects unknown extension, mismatched MIME, or no extension', () => {
    expect(isAllowedAttachment('setup.exe', 'application/octet-stream')).toBe(false);
    expect(isAllowedAttachment('photo.jpg', 'application/pdf')).toBe(false);
    expect(isAllowedAttachment('README', 'text/plain')).toBe(false);
    expect(isAllowedAttachment('page.html', 'text/html')).toBe(false);
  });
});

describe('attachmentKind', () => {
  it('maps MIME to a preview kind', () => {
    expect(attachmentKind('image/png')).toBe('image');
    expect(attachmentKind('video/mp4')).toBe('video');
    expect(attachmentKind('application/pdf')).toBe('pdf');
    expect(attachmentKind('text/csv')).toBe('file');
  });
});

describe('isSniffCompatible', () => {
  it('accepts exact matches', () => {
    expect(isSniffCompatible('image/png', 'image/png')).toBe(true);
  });
  it('accepts Office OOXML sniffed as zip', () => {
    expect(
      isSniffCompatible(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/zip',
      ),
    ).toBe(true);
  });
  it('accepts text types that cannot be sniffed (undefined)', () => {
    expect(isSniffCompatible('text/plain', undefined)).toBe(true);
    expect(isSniffCompatible('text/csv', undefined)).toBe(true);
  });
  it('rejects binaries that cannot be sniffed and real spoofs', () => {
    expect(isSniffCompatible('application/pdf', undefined)).toBe(false);
    expect(isSniffCompatible('application/pdf', 'application/x-msdownload')).toBe(false);
    expect(isSniffCompatible('image/jpeg', 'image/png')).toBe(false);
  });
  it('accepts quicktime/mp4 container aliases', () => {
    expect(isSniffCompatible('video/quicktime', 'video/quicktime')).toBe(true);
    expect(isSniffCompatible('video/mp4', 'video/mp4')).toBe(true);
  });
  it('exposes the allow-list', () => {
    expect(ALLOWED_CARD_ATTACHMENT_TYPES.length).toBeGreaterThanOrEqual(15);
  });
});
