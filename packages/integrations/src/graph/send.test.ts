import { describe, it, expect, vi, beforeEach } from 'vitest';

// NOTE: the real `graphFetch` signature is `graphFetch(url, opts)` where
// `opts.token` carries the bearer token (see client.ts) — not
// `graphFetch(token, path, opts)`. We spy on it here to assert the outbound
// call shape (url + method + body) rather than relying on its return value,
// since Graph's send/reply/forward endpoints return 202 with an empty body.
const graphFetchMock = vi.fn(async (url: string, opts: { method?: string; body?: string }) => ({
  url,
  method: opts.method,
  body: opts.body ? JSON.parse(opts.body) : null,
}));

vi.mock('./client', () => ({
  graphFetch: (...args: unknown[]) =>
    graphFetchMock(...(args as [string, { method?: string; body?: string }])),
}));

const { sendViaGraph, GraphPayloadTooLargeError, GraphReplyAttachmentsUnsupportedError } =
  await import('./send');

function lastCall(): [string, { method?: string; body?: string }] {
  const calls = graphFetchMock.mock.calls;
  const call = calls[calls.length - 1];
  if (!call) throw new Error('graphFetch was not called');
  return call as [string, { method?: string; body?: string }];
}

describe('sendViaGraph', () => {
  beforeEach(() => {
    graphFetchMock.mockClear();
  });

  it('POSTs /me/sendMail for a new mail with saveToSentItems=true', async () => {
    const result = await sendViaGraph('token', {
      subject: 'Hi',
      toRecipients: ['you@ex.com'],
      ccRecipients: [],
      bccRecipients: [],
      bodyHtmlSanitized: '<p>Body</p>',
    });
    expect(result).toEqual({ ok: true });

    const [url, opts] = lastCall();
    expect(url).toContain('/me/sendMail');
    expect(opts.method).toBe('POST');
    const body = opts.body ? JSON.parse(opts.body) : null;
    expect(body).toMatchObject({
      saveToSentItems: true,
      message: { subject: 'Hi', toRecipients: [{ emailAddress: { address: 'you@ex.com' } }] },
    });
  });

  it('POSTs /me/messages/{id}/reply when inReplyToMessageId is set with mode=reply', async () => {
    await sendViaGraph('token', {
      subject: 'Re: Hi',
      toRecipients: ['you@ex.com'],
      ccRecipients: [],
      bccRecipients: [],
      bodyHtmlSanitized: '<p>Response</p>',
      inReplyToMessageId: 'MSG-1',
      mode: 'reply',
    });
    const [url] = lastCall();
    expect(url).toContain('/me/messages/MSG-1/reply');
  });

  it('POSTs /me/messages/{id}/forward when mode=forward', async () => {
    await sendViaGraph('token', {
      subject: 'Fwd: Hi',
      toRecipients: ['other@ex.com'],
      ccRecipients: [],
      bccRecipients: [],
      bodyHtmlSanitized: '',
      inReplyToMessageId: 'MSG-1',
      mode: 'forward',
    });
    const [url] = lastCall();
    expect(url).toContain('/me/messages/MSG-1/forward');
  });

  it('attaches a single small file on the /sendMail (new mail) path', async () => {
    const result = await sendViaGraph('token', {
      subject: 'Hi',
      toRecipients: ['you@ex.com'],
      ccRecipients: [],
      bccRecipients: [],
      bodyHtmlSanitized: '<p>Body</p>',
      attachments: [
        { filename: 'a.pdf', contentType: 'application/pdf', content: Buffer.from('hello') },
      ],
    });
    expect(result).toEqual({ ok: true });

    const [url, opts] = lastCall();
    expect(url).toContain('/me/sendMail');
    const body = opts.body ? JSON.parse(opts.body) : null;
    expect(body.message.attachments).toEqual([
      {
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: 'a.pdf',
        contentType: 'application/pdf',
        contentBytes: Buffer.from('hello').toString('base64'),
      },
    ]);
  });

  it('attaches multiple files totaling under 3 MB on /sendMail', async () => {
    const small = Buffer.alloc(1_000_000, 'a');
    const result = await sendViaGraph('token', {
      subject: 'Hi',
      toRecipients: ['you@ex.com'],
      ccRecipients: [],
      bccRecipients: [],
      bodyHtmlSanitized: '<p>Body</p>',
      attachments: [
        { filename: 'a.bin', contentType: 'application/octet-stream', content: small },
        { filename: 'b.bin', contentType: 'application/octet-stream', content: small },
      ],
    });
    expect(result).toEqual({ ok: true });
    const [, opts] = lastCall();
    const body = opts.body ? JSON.parse(opts.body) : null;
    expect(body.message.attachments).toHaveLength(2);
  });

  it('throws GraphPayloadTooLargeError when a single attachment exceeds 3 MB', async () => {
    const big = Buffer.alloc(3_000_001, 'a');
    await expect(
      sendViaGraph('token', {
        subject: 'Hi',
        toRecipients: ['you@ex.com'],
        ccRecipients: [],
        bccRecipients: [],
        bodyHtmlSanitized: '<p>Body</p>',
        attachments: [
          { filename: 'big.bin', contentType: 'application/octet-stream', content: big },
        ],
      }),
    ).rejects.toBeInstanceOf(GraphPayloadTooLargeError);
    expect(graphFetchMock).not.toHaveBeenCalled();
  });

  it('throws GraphPayloadTooLargeError when multiple attachments sum over 3 MB', async () => {
    const half = Buffer.alloc(1_600_000, 'a');
    await expect(
      sendViaGraph('token', {
        subject: 'Hi',
        toRecipients: ['you@ex.com'],
        ccRecipients: [],
        bccRecipients: [],
        bodyHtmlSanitized: '<p>Body</p>',
        attachments: [
          { filename: 'a.bin', contentType: 'application/octet-stream', content: half },
          { filename: 'b.bin', contentType: 'application/octet-stream', content: half },
        ],
      }),
    ).rejects.toBeInstanceOf(GraphPayloadTooLargeError);
    expect(graphFetchMock).not.toHaveBeenCalled();
  });

  it('throws GraphReplyAttachmentsUnsupportedError for reply mode with an attachment', async () => {
    await expect(
      sendViaGraph('token', {
        subject: 'Re: Hi',
        toRecipients: ['you@ex.com'],
        ccRecipients: [],
        bccRecipients: [],
        bodyHtmlSanitized: '<p>Response</p>',
        inReplyToMessageId: 'MSG-1',
        mode: 'reply',
        attachments: [
          { filename: 'a.pdf', contentType: 'application/pdf', content: Buffer.from('data') },
        ],
      }),
    ).rejects.toBeInstanceOf(GraphReplyAttachmentsUnsupportedError);
    expect(graphFetchMock).not.toHaveBeenCalled();
  });

  it('throws GraphReplyAttachmentsUnsupportedError for forward mode with an attachment', async () => {
    await expect(
      sendViaGraph('token', {
        subject: 'Fwd: Hi',
        toRecipients: ['you@ex.com'],
        ccRecipients: [],
        bccRecipients: [],
        bodyHtmlSanitized: '',
        inReplyToMessageId: 'MSG-1',
        mode: 'forward',
        attachments: [
          { filename: 'a.pdf', contentType: 'application/pdf', content: Buffer.from('data') },
        ],
      }),
    ).rejects.toBeInstanceOf(GraphReplyAttachmentsUnsupportedError);
    expect(graphFetchMock).not.toHaveBeenCalled();
  });

  it('replyAll mode with no attachments still works (no regression)', async () => {
    const result = await sendViaGraph('token', {
      subject: 'Re: Hi',
      toRecipients: ['you@ex.com'],
      ccRecipients: [],
      bccRecipients: [],
      bodyHtmlSanitized: '<p>Response</p>',
      inReplyToMessageId: 'MSG-1',
      mode: 'reply_all',
    });
    expect(result).toEqual({ ok: true });
    const [url] = lastCall();
    expect(url).toContain('/me/messages/MSG-1/replyAll');
  });
});
