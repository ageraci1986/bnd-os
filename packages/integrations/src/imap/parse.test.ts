import { describe, it, expect } from 'vitest';
import { parseImapMessage, type RawImapMessage } from './parse';

const base: RawImapMessage = {
  uid: 42,
  envelope: {
    date: new Date('2026-07-15T10:00:00Z'),
    subject: 'Hello',
    from: [{ address: 'a@Ex.com', name: 'Alice' }],
    to: [{ address: 'b@ex.com' }],
    cc: [],
    inReplyTo: null,
    messageId: '<abc@ex.com>',
  },
  flags: new Set(['\\Seen']),
  bodyText: null,
  bodyHtml: null,
  headers: {},
};

describe('parseImapMessage', () => {
  it('maps envelope + Seen flag to ParsedMailMessage', () => {
    const r = parseImapMessage(base);
    expect(r).toMatchObject({
      externalId: '42',
      subject: 'Hello',
      fromEmail: 'a@ex.com',
      fromName: 'Alice',
      toRecipients: ['b@ex.com'],
      ccRecipients: [],
      isRead: true,
      conversationId: '<abc@ex.com>',
    });
  });

  it('marks unread when Seen flag absent', () => {
    const r = parseImapMessage({ ...base, flags: new Set() });
    expect(r.isRead).toBe(false);
  });

  it('falls back to internalDate when envelope date is missing', () => {
    const r = parseImapMessage({
      ...base,
      envelope: { ...base.envelope, date: null },
      internalDate: new Date('2026-07-14T09:00:00Z'),
    });
    expect(r.receivedAt.toISOString()).toBe('2026-07-14T09:00:00.000Z');
  });

  it('sanitizes HTML body through the shared allowlist', () => {
    const r = parseImapMessage({ ...base, bodyHtml: '<p>ok</p><script>bad</script>' });
    expect(r.bodyHtmlSanitized).toContain('<p>ok</p>');
    expect(r.bodyHtmlSanitized).not.toContain('<script>');
    expect(r.bodyText).toBe('ok');
  });

  it('uses text body directly when no HTML', () => {
    const r = parseImapMessage({ ...base, bodyText: 'plain body' });
    expect(r.bodyText).toBe('plain body');
    expect(r.bodyHtmlSanitized).toBeNull();
  });

  it('uses In-Reply-To when messageId absent', () => {
    const r = parseImapMessage({
      ...base,
      envelope: { ...base.envelope, messageId: null, inReplyTo: '<parent@ex.com>' },
    });
    expect(r.conversationId).toBe('<parent@ex.com>');
  });
});
