import { describe, expect, it } from 'vitest';
import { parseGraphMessage } from './parse';

const baseGraph = {
  id: 'AAMkAGUw',
  subject: 'Hello',
  from: { emailAddress: { name: 'Marie', address: 'Marie@Acme.com' } },
  toRecipients: [{ emailAddress: { name: 'Me', address: 'me@nexushub.app' } }],
  ccRecipients: [],
  receivedDateTime: '2026-05-28T10:00:00Z',
  isRead: false,
  conversationId: 'conv-1',
  bodyPreview: 'Hi…',
  body: {
    contentType: 'html',
    content: '<p>Hi <strong>Angelo</strong></p><script>alert(1)</script>',
  },
};

describe('parseGraphMessage', () => {
  it('normalizes a typical message and sanitizes HTML', () => {
    const m = parseGraphMessage(baseGraph);
    expect(m).toEqual({
      externalId: 'AAMkAGUw',
      subject: 'Hello',
      fromEmail: 'marie@acme.com',
      fromName: 'Marie',
      toRecipients: ['me@nexushub.app'],
      ccRecipients: [],
      receivedAt: new Date('2026-05-28T10:00:00Z'),
      isRead: false,
      conversationId: 'conv-1',
      bodyText: 'Hi Angelo',
      bodyHtmlSanitized: '<p>Hi <strong>Angelo</strong></p>',
    });
  });

  it('handles missing from name', () => {
    const m = parseGraphMessage({ ...baseGraph, from: { emailAddress: { address: 'x@y.io' } } });
    expect(m.fromName).toBeNull();
    expect(m.fromEmail).toBe('x@y.io');
  });

  it('handles plain-text body', () => {
    const m = parseGraphMessage({
      ...baseGraph,
      body: { contentType: 'text', content: 'Plain body' },
    });
    expect(m.bodyText).toBe('Plain body');
    expect(m.bodyHtmlSanitized).toBeNull();
  });

  it('returns empty body when body is missing', () => {
    const m = parseGraphMessage({ ...baseGraph, body: undefined });
    expect(m.bodyText).toBe('');
    expect(m.bodyHtmlSanitized).toBeNull();
  });

  it('lowercases from email for matching', () => {
    const m = parseGraphMessage(baseGraph);
    expect(m.fromEmail).toBe('marie@acme.com');
  });

  it('omits hasAttachments when the source field is absent', () => {
    const m = parseGraphMessage(baseGraph);
    expect(m.hasAttachments).toBeUndefined();
    expect('hasAttachments' in m).toBe(false);
  });

  it('passes through hasAttachments: true', () => {
    const m = parseGraphMessage({ ...baseGraph, hasAttachments: true });
    expect(m.hasAttachments).toBe(true);
  });

  it('passes through hasAttachments: false', () => {
    const m = parseGraphMessage({ ...baseGraph, hasAttachments: false });
    expect(m.hasAttachments).toBe(false);
  });
});
