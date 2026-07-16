import { describe, it, expect } from 'vitest';
import { parseImapAttachments } from './attachments';

describe('parseImapAttachments', () => {
  it('returns [] on a plain text body', () => {
    const bodyStructure = { type: 'text', subtype: 'plain', part: '1' };
    expect(parseImapAttachments(bodyStructure)).toEqual([]);
  });

  it('extracts a single attachment from multipart/mixed', () => {
    const bodyStructure = {
      type: 'multipart',
      subtype: 'mixed',
      childNodes: [
        { type: 'text', subtype: 'html', part: '1' },
        {
          type: 'application',
          subtype: 'pdf',
          part: '2',
          disposition: 'attachment',
          dispositionParameters: { filename: 'rapport.pdf' },
          size: 12345,
        },
      ],
    };
    const r = parseImapAttachments(bodyStructure);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      partNumber: '2',
      filename: 'rapport.pdf',
      contentType: 'application/pdf',
      sizeBytes: 12345,
      isInline: false,
    });
  });

  it('extracts inline images (cid: scheme)', () => {
    const bodyStructure = {
      type: 'multipart',
      subtype: 'related',
      childNodes: [
        { type: 'text', subtype: 'html', part: '1' },
        {
          type: 'image',
          subtype: 'png',
          part: '2',
          disposition: 'inline',
          id: '<logo@ex.com>',
          size: 5000,
          parameters: { name: 'logo.png' },
        },
      ],
    };
    const r = parseImapAttachments(bodyStructure);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      partNumber: '2',
      filename: 'logo.png',
      contentType: 'image/png',
      isInline: true,
      contentId: '<logo@ex.com>',
    });
  });

  it('walks nested multipart trees', () => {
    const bodyStructure = {
      type: 'multipart',
      subtype: 'mixed',
      childNodes: [
        {
          type: 'multipart',
          subtype: 'alternative',
          childNodes: [
            { type: 'text', subtype: 'plain', part: '1.1' },
            { type: 'text', subtype: 'html', part: '1.2' },
          ],
        },
        {
          type: 'application',
          subtype: 'pdf',
          part: '2',
          disposition: 'attachment',
          dispositionParameters: { filename: 'A.pdf' },
          size: 1000,
        },
      ],
    };
    expect(parseImapAttachments(bodyStructure)).toHaveLength(1);
  });

  it('uses parameters.name as fallback when dispositionParameters.filename is missing', () => {
    const bodyStructure = {
      type: 'application',
      subtype: 'octet-stream',
      part: '1',
      disposition: 'attachment',
      parameters: { name: 'file.bin' },
      size: 200,
    };
    expect(parseImapAttachments(bodyStructure)[0]?.filename).toBe('file.bin');
  });

  it('assigns "attachment.bin" when no filename is anywhere', () => {
    const bodyStructure = {
      type: 'application',
      subtype: 'octet-stream',
      part: '1',
      disposition: 'attachment',
      size: 100,
    };
    expect(parseImapAttachments(bodyStructure)[0]?.filename).toBe('attachment.bin');
  });
});
