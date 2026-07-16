import { describe, it, expect } from 'vitest';
import { computePrefill } from './compose-prefill';

const original = {
  id: 'e1',
  externalId: 'EXT-1',
  subject: 'Hi',
  fromEmail: 'a@ex.com',
  toRecipients: ['me@ex.com'],
  ccRecipients: ['b@ex.com'],
  bodyText: 'Original body',
  bodyHtmlSanitized: '<p>Original body</p>',
  receivedAt: new Date('2026-07-15T10:00:00Z').toISOString(),
  integrationId: 'i1',
};

describe('computePrefill', () => {
  it('reply → To=original.from, subject prefixed once', () => {
    const r = computePrefill({
      mode: 'reply',
      replyTo: original,
      myEmail: 'me@ex.com',
      signatureHtml: null,
    });
    expect(r.toRecipients).toEqual(['a@ex.com']);
    expect(r.ccRecipients).toEqual([]);
    expect(r.subject).toBe('Re: Hi');
  });

  it('reply keeps existing Re: prefix instead of stacking', () => {
    const r = computePrefill({
      mode: 'reply',
      replyTo: { ...original, subject: 'Re: Hi' },
      myEmail: 'me@ex.com',
      signatureHtml: null,
    });
    expect(r.subject).toBe('Re: Hi');
  });

  it('reply_all: CC = original to+cc minus my email', () => {
    const r = computePrefill({
      mode: 'reply_all',
      replyTo: original,
      myEmail: 'me@ex.com',
      signatureHtml: null,
    });
    expect(r.toRecipients).toEqual(['a@ex.com']);
    expect(r.ccRecipients).toEqual(['b@ex.com']);
  });

  it('forward → subject prefixed Fwd:', () => {
    const r = computePrefill({
      mode: 'forward',
      replyTo: original,
      myEmail: 'me@ex.com',
      signatureHtml: null,
    });
    expect(r.subject).toBe('Fwd: Hi');
    expect(r.toRecipients).toEqual([]);
  });

  it('new_mail: empty everything except signature', () => {
    const r = computePrefill({
      mode: 'new_mail',
      replyTo: null,
      myEmail: 'me@ex.com',
      signatureHtml: '<p>Sig</p>',
    });
    expect(r.toRecipients).toEqual([]);
    expect(r.subject).toBe('');
    expect(r.bodyHtml).toContain('<p>Sig</p>');
  });

  it('includes quoted original body on reply', () => {
    const r = computePrefill({
      mode: 'reply',
      replyTo: original,
      myEmail: 'me@ex.com',
      signatureHtml: '<p>Sig</p>',
    });
    expect(r.bodyHtml).toContain('<p>Sig</p>');
    expect(r.bodyHtml).toContain('a@ex.com');
    expect(r.bodyHtml).toContain('<blockquote');
    expect(r.bodyHtml).toContain('Original body');
  });
});
