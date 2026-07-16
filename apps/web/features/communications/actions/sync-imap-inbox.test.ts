import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth', () => ({
  requireUser: vi.fn(async () => ({ userId: 'u', workspaceId: 'w' })),
}));

const findFirstIntegration = vi.hoisted(() => vi.fn());
const updateIntegration = vi.hoisted(() => vi.fn());
const upsertMessage = vi.hoisted(() => vi.fn());
const upsertAttachment = vi.hoisted(() => vi.fn());
const clientsFindMany = vi.hoisted(() => vi.fn(async () => []));

vi.mock('@nexushub/db', () => ({
  prisma: {
    integration: { findFirst: findFirstIntegration, update: updateIntegration },
    client: { findMany: clientsFindMany },
    emailMessage: { upsert: upsertMessage },
    emailAttachment: { upsert: upsertAttachment },
  },
}));

vi.mock('@/features/integrations/lib/get-valid-imap-credentials', () => ({
  getValidImapCredentials: vi.fn(async () => ({
    imap: {
      host: 'h',
      port: 993,
      secure: true,
      username: 'u@ex',
      password: 'p',
    },
    smtp: null,
  })),
}));

const openSession = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => ({ logout: vi.fn() })));
const listInitial = vi.hoisted(() => vi.fn());
const listIncremental = vi.hoisted(() => vi.fn());

vi.mock('@nexushub/integrations/imap', () => ({
  openImapSession: (...a: unknown[]) => openSession(...a),
  listInboxInitial: (...a: unknown[]) => listInitial(...a),
  listInboxIncremental: (...a: unknown[]) => listIncremental(...a),
  UidValidityChangedError: class extends Error {},
}));

import { syncImapInbox } from './sync-imap-inbox';

// Mocks are module-level (vi.hoisted), so call counts leak across `it`
// blocks unless reset here — keeps each test isolated per CLAUDE.md §5.4.
beforeEach(() => {
  findFirstIntegration.mockReset();
  updateIntegration.mockReset();
  upsertMessage.mockReset();
  upsertMessage.mockResolvedValue({ id: 'em-1' });
  upsertAttachment.mockReset();
  clientsFindMany.mockReset();
  clientsFindMany.mockResolvedValue([]);
  openSession.mockReset();
  openSession.mockImplementation(async (..._args: unknown[]) => ({ logout: vi.fn() }));
  listInitial.mockReset();
  listIncremental.mockReset();
});

describe('syncImapInbox', () => {
  it('bails out when throttled', async () => {
    findFirstIntegration.mockResolvedValueOnce({
      id: 'i1',
      imapUidValidity: null,
      imapLastSeenUid: null,
      lastSyncedAt: new Date(Date.now() - 5_000),
    });
    const r = await syncImapInbox('i1');
    expect(r).toEqual({ ok: true, throttled: true });
    expect(openSession).not.toHaveBeenCalled();
  });

  it('does initial fetch when uidValidity is null', async () => {
    findFirstIntegration.mockResolvedValueOnce({
      id: 'i1',
      imapUidValidity: null,
      imapLastSeenUid: null,
      lastSyncedAt: null,
    });
    listInitial.mockResolvedValueOnce({
      messages: [
        {
          externalId: '1',
          subject: 's',
          fromEmail: 'a@ex.com',
          fromName: null,
          toRecipients: [],
          ccRecipients: [],
          receivedAt: new Date(),
          isRead: false,
          conversationId: null,
          bodyText: '',
          bodyHtmlSanitized: null,
        },
      ],
      uidValidity: 100n,
      lastSeenUid: 1n,
    });
    const r = await syncImapInbox('i1');
    expect(r).toMatchObject({ ok: true, fetched: 1 });
    expect(upsertMessage).toHaveBeenCalledOnce();
    expect(updateIntegration).toHaveBeenCalledOnce();
  });

  it('records error + bumps lastSyncedAt on failure', async () => {
    findFirstIntegration.mockResolvedValueOnce({
      id: 'i1',
      imapUidValidity: null,
      imapLastSeenUid: null,
      lastSyncedAt: null,
    });
    listInitial.mockRejectedValueOnce(new Error('boom'));
    const r = await syncImapInbox('i1');
    expect(r.ok).toBe(false);
    expect(updateIntegration).toHaveBeenCalledOnce();
    const call = updateIntegration.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(call.data['lastError']).toBe('boom');
    expect(call.data['status']).toBe('error');
  });

  it('persists attachment metadata + sets hasAttachments when the source has attachments', async () => {
    findFirstIntegration.mockResolvedValueOnce({
      id: 'i1',
      imapUidValidity: null,
      imapLastSeenUid: null,
      lastSyncedAt: null,
    });
    upsertMessage.mockResolvedValueOnce({ id: 'em-42' });
    listInitial.mockResolvedValueOnce({
      messages: [
        {
          externalId: '42',
          subject: 's',
          fromEmail: 'a@ex.com',
          fromName: null,
          toRecipients: [],
          ccRecipients: [],
          receivedAt: new Date(),
          isRead: false,
          conversationId: null,
          bodyText: '',
          bodyHtmlSanitized: null,
          attachments: [
            {
              sourceExternalId: '2',
              filename: 'rapport.pdf',
              contentType: 'application/pdf',
              sizeBytes: 12345,
              contentId: null,
              isInline: false,
            },
          ],
        },
      ],
      uidValidity: 100n,
      lastSeenUid: 42n,
    });

    const r = await syncImapInbox('i1');

    expect(r).toMatchObject({ ok: true, fetched: 1 });

    // EmailMessage upsert carries hasAttachments: true in its create/update.
    expect(upsertMessage).toHaveBeenCalledOnce();
    const messageArgs = upsertMessage.mock.calls[0]?.[0] as {
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };
    expect(messageArgs.create['hasAttachments']).toBe(true);
    expect(messageArgs.update['hasAttachments']).toBe(true);

    // EmailAttachment upserted with storagePath/scanStatus null (lazy state).
    expect(upsertAttachment).toHaveBeenCalledOnce();
    const attachmentArgs = upsertAttachment.mock.calls[0]?.[0] as {
      where: {
        emailMessageId_sourceExternalId: { emailMessageId: string; sourceExternalId: string };
      };
      create: Record<string, unknown>;
    };
    expect(attachmentArgs.where.emailMessageId_sourceExternalId).toEqual({
      emailMessageId: 'em-42',
      sourceExternalId: '2',
    });
    expect(attachmentArgs.create).toMatchObject({
      filename: 'rapport.pdf',
      contentType: 'application/pdf',
      sizeBytes: 12345,
      sourceExternalId: '2',
      isInline: false,
      storagePath: null,
      scanStatus: null,
    });
  });

  it('does not touch emailAttachment when the source has no attachments', async () => {
    findFirstIntegration.mockResolvedValueOnce({
      id: 'i1',
      imapUidValidity: null,
      imapLastSeenUid: null,
      lastSyncedAt: null,
    });
    listInitial.mockResolvedValueOnce({
      messages: [
        {
          externalId: '1',
          subject: 's',
          fromEmail: 'a@ex.com',
          fromName: null,
          toRecipients: [],
          ccRecipients: [],
          receivedAt: new Date(),
          isRead: false,
          conversationId: null,
          bodyText: '',
          bodyHtmlSanitized: null,
        },
      ],
      uidValidity: 100n,
      lastSeenUid: 1n,
    });

    await syncImapInbox('i1');

    expect(upsertAttachment).not.toHaveBeenCalled();
    const messageArgs = upsertMessage.mock.calls[0]?.[0] as { create: Record<string, unknown> };
    expect(messageArgs.create['hasAttachments']).toBe(false);
  });
});
