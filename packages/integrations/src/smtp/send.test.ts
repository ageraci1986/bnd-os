import { describe, it, expect } from 'vitest';
import { sendViaSmtp, SmtpSendError } from './send';

function makeFakeTransport(
  opts: {
    raw?: string;
    throws?: Error;
  } = {},
) {
  return {
    async sendMail(mail: Record<string, unknown>) {
      if (opts.throws) throw opts.throws;
      return {
        messageId: '<generated@ex.com>',
        envelope: { from: mail['from'], to: mail['to'] },
        accepted: mail['to'],
        rejected: [],
        response: '250 OK',
        raw: opts.raw ?? 'raw-rfc822',
      };
    },
    async close() {
      /* noop */
    },
  };
}

describe('sendViaSmtp', () => {
  it('sends a plain new email and returns the messageId + accepted/rejected', async () => {
    const t = makeFakeTransport();
    const r = await sendViaSmtp(t as never, {
      from: 'me@ex.com',
      to: ['you@ex.com'],
      cc: [],
      bcc: [],
      subject: 'Hi',
      html: '<p>Body</p>',
      text: 'Body',
    });
    expect(r.messageId).toBe('<generated@ex.com>');
    expect(r.accepted).toEqual(['you@ex.com']);
    expect(r.rejected).toEqual([]);
  });

  it('adds threading headers on reply', async () => {
    let captured: Record<string, unknown> = {};
    const t = {
      async sendMail(mail: Record<string, unknown>) {
        captured = mail;
        return {
          messageId: '<new@ex.com>',
          envelope: {},
          accepted: ['you@ex.com'],
          rejected: [],
          response: '250 OK',
        };
      },
      async close() {
        /* noop */
      },
    };
    await sendViaSmtp(t as never, {
      from: 'me@ex.com',
      to: ['you@ex.com'],
      cc: [],
      bcc: [],
      subject: 'Re: Hi',
      html: '<blockquote>quoted</blockquote>',
      text: 'quoted',
      inReplyTo: '<original@ex.com>',
      references: ['<original@ex.com>'],
    });
    expect(captured['inReplyTo']).toBe('<original@ex.com>');
    expect(captured['references']).toEqual(['<original@ex.com>']);
  });

  it('wraps sendMail errors in SmtpSendError', async () => {
    const t = makeFakeTransport({ throws: new Error('550 5.7.1 relay denied') });
    await expect(
      sendViaSmtp(t as never, {
        from: 'me@ex.com',
        to: ['you@ex.com'],
        cc: [],
        bcc: [],
        subject: 'Hi',
        html: '',
        text: '',
      }),
    ).rejects.toBeInstanceOf(SmtpSendError);
  });
});
