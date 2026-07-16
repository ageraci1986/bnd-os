import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth', () => ({
  requireUser: vi.fn(async () => ({ userId: 'u', workspaceId: 'w' })),
}));

const findFirstIntegration = vi.hoisted(() => vi.fn());
const updateIntegration = vi.hoisted(() => vi.fn());
const upsertMessage = vi.hoisted(() => vi.fn());
const clientsFindMany = vi.hoisted(() => vi.fn(async () => []));

vi.mock('@nexushub/db', () => ({
  prisma: {
    integration: { findFirst: findFirstIntegration, update: updateIntegration },
    client: { findMany: clientsFindMany },
    emailMessage: { upsert: upsertMessage },
  },
}));

vi.mock('@/features/integrations/lib/get-valid-imap-credentials', () => ({
  getValidImapCredentials: vi.fn(async () => ({
    host: 'h',
    port: 993,
    secure: true,
    username: 'u@ex',
    password: 'p',
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
});
