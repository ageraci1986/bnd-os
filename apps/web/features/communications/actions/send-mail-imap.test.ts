import { describe, it, expect, vi, beforeEach } from 'vitest';

const getCreds = vi.hoisted(() => vi.fn());
vi.mock('@/features/integrations/lib/get-valid-imap-credentials', () => ({
  getValidImapCredentials: (...a: unknown[]) => getCreds(...a),
}));

const openSmtp = vi.hoisted(() => vi.fn());
const send = vi.hoisted(() => vi.fn());
const append = vi.hoisted(() => vi.fn());
vi.mock('@nexushub/integrations/smtp', () => ({
  openSmtpTransport: (...a: unknown[]) => openSmtp(...a),
  sendViaSmtp: (...a: unknown[]) => send(...a),
  appendToSentFolder: (...a: unknown[]) => append(...a),
}));

const openImap = vi.hoisted(() => vi.fn());
vi.mock('@nexushub/integrations/imap', () => ({
  openImapSession: (...a: unknown[]) => openImap(...a),
}));

const mailFindUnique = vi.hoisted(() => vi.fn());
vi.mock('@nexushub/db', () => ({
  prisma: { emailMessage: { findUnique: mailFindUnique } },
}));

import { sendViaImapSmtp } from './send-mail-imap';

beforeEach(() => vi.clearAllMocks());

describe('sendViaImapSmtp', () => {
  it('throws SMTP_NOT_CONFIGURED when creds have no smtp block', async () => {
    getCreds.mockResolvedValueOnce({
      imap: { host: 'i.h', port: 993, secure: true, username: 'u', password: 'p' },
      smtp: null,
    });
    await expect(
      sendViaImapSmtp({
        integrationId: 'i1',
        workspaceId: 'w',
        userId: 'u',
        fromEmail: 'me@ex.com',
        payload: {
          subject: 'Hi',
          to: ['you@ex.com'],
          cc: [],
          bcc: [],
          bodyHtml: '<p>Body</p>',
          bodyText: 'Body',
        },
      }),
    ).rejects.toThrow(/SMTP_NOT_CONFIGURED/);
    expect(openSmtp).not.toHaveBeenCalled();
  });

  it('sends + appends to Sent folder on happy path', async () => {
    getCreds.mockResolvedValueOnce({
      imap: { host: 'i.h', port: 993, secure: true, username: 'u', password: 'p' },
      smtp: {
        host: 's.h',
        port: 587,
        secure: false,
        requireTls: true,
        username: 'u',
        password: 'p',
      },
    });
    const transport = { close: vi.fn() };
    openSmtp.mockResolvedValueOnce(transport);
    send.mockResolvedValueOnce({
      messageId: '<id@ex.com>',
      accepted: ['you@ex.com'],
      rejected: [],
    });
    const session = { logout: vi.fn().mockResolvedValue(undefined) };
    openImap.mockResolvedValueOnce(session);
    append.mockResolvedValueOnce(undefined);

    await sendViaImapSmtp({
      integrationId: 'i1',
      workspaceId: 'w',
      userId: 'u',
      fromEmail: 'me@ex.com',
      payload: {
        subject: 'Hi',
        to: ['you@ex.com'],
        cc: [],
        bcc: [],
        bodyHtml: '<p>Body</p>',
        bodyText: 'Body',
      },
    });
    expect(send).toHaveBeenCalledOnce();
    expect(append).toHaveBeenCalledOnce();
    expect(session.logout).toHaveBeenCalledOnce();
    expect(transport.close).toHaveBeenCalledOnce();
  });

  it('propagates threading headers from replyToLocalId lookup', async () => {
    getCreds.mockResolvedValueOnce({
      imap: { host: 'i.h', port: 993, secure: true, username: 'u', password: 'p' },
      smtp: {
        host: 's.h',
        port: 587,
        secure: false,
        requireTls: true,
        username: 'u',
        password: 'p',
      },
    });
    mailFindUnique.mockResolvedValueOnce({ conversationId: '<original@ex.com>' });
    openSmtp.mockResolvedValueOnce({ close: vi.fn() });
    send.mockResolvedValueOnce({ messageId: '<new@ex.com>', accepted: [], rejected: [] });
    openImap.mockResolvedValueOnce({ logout: vi.fn().mockResolvedValue(undefined) });
    append.mockResolvedValueOnce(undefined);

    await sendViaImapSmtp({
      integrationId: 'i1',
      workspaceId: 'w',
      userId: 'u',
      fromEmail: 'me@ex.com',
      payload: {
        subject: 'Re: Hi',
        to: ['you@ex.com'],
        cc: [],
        bcc: [],
        bodyHtml: '<blockquote>orig</blockquote>',
        bodyText: 'orig',
        replyToLocalId: 'em-1',
      },
    });
    const sendArgs = send.mock.calls[0]?.[1] as {
      inReplyTo?: string;
      references?: readonly string[];
    };
    expect(sendArgs.inReplyTo).toBe('<original@ex.com>');
    expect(sendArgs.references).toEqual(['<original@ex.com>']);
  });
});
