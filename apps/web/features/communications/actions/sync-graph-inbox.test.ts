import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  integrationFindFirst: vi.fn(),
  integrationUpdate: vi.fn(),
  clientFindMany: vi.fn(),
  emailUpsert: vi.fn(),
  emailUpdateMany: vi.fn(),
  getValidAccessToken: vi.fn(),
  listInboxInitial: vi.fn(),
  listInboxDelta: vi.fn(),
}));

vi.mock('@nexushub/db', () => ({
  prisma: {
    integration: { findFirst: mocks.integrationFindFirst, update: mocks.integrationUpdate },
    client: { findMany: mocks.clientFindMany },
    emailMessage: { upsert: mocks.emailUpsert, updateMany: mocks.emailUpdateMany },
  },
}));
vi.mock('@/lib/auth', () => ({ requireUser: mocks.requireUser }));
vi.mock('@/features/integrations/lib/get-valid-access-token', () => ({
  getValidAccessToken: mocks.getValidAccessToken,
}));
vi.mock('@nexushub/integrations/graph', () => ({
  listInboxInitial: mocks.listInboxInitial,
  listInboxDelta: mocks.listInboxDelta,
}));

import { syncGraphInbox } from './sync-graph-inbox';

beforeEach(() => {
  for (const m of Object.values(mocks)) (m as { mockReset?: () => void }).mockReset?.();
  mocks.requireUser.mockResolvedValue({
    userId: 'U1',
    workspaceId: 'W1',
    role: 'user',
    isSuperAdmin: false,
    email: 'a@b.c',
  });
});

describe('syncGraphInbox', () => {
  it('runs initial sync when deltaToken null, upserts messages, sets deltaToken', async () => {
    mocks.integrationFindFirst.mockResolvedValue({
      id: 'I1',
      deltaToken: null,
      lastSyncedAt: null,
      status: 'active',
    });
    mocks.getValidAccessToken.mockResolvedValue('AT');
    mocks.clientFindMany.mockResolvedValue([{ id: 'C1', domains: ['acme.com'] }]);
    mocks.listInboxInitial.mockResolvedValue({
      messages: [
        {
          externalId: 'M1',
          subject: 'Hi',
          fromEmail: 'a@acme.com',
          fromName: 'A',
          toRecipients: ['me@x'],
          ccRecipients: [],
          receivedAt: new Date('2026-05-28T10:00:00Z'),
          isRead: false,
          conversationId: 'c',
          bodyText: 'plain',
          bodyHtmlSanitized: null,
        },
      ],
      deltaLink: 'https://graph/delta',
    });
    mocks.emailUpsert.mockResolvedValue({});
    mocks.integrationUpdate.mockResolvedValue({});

    const res = await syncGraphInbox();
    expect(res).toEqual({ ok: true, fetched: 1, removed: 0 });
    expect(mocks.emailUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          workspaceId: 'W1',
          externalId: 'M1',
          clientId: 'C1',
          isRead: false,
        }),
      }),
    );
    expect(mocks.integrationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ deltaToken: 'https://graph/delta' }),
      }),
    );
  });

  it('throttles when lastSyncedAt < 30s ago', async () => {
    mocks.integrationFindFirst.mockResolvedValue({
      id: 'I1',
      deltaToken: 'D',
      lastSyncedAt: new Date(Date.now() - 5_000),
      status: 'active',
    });
    const res = await syncGraphInbox();
    expect(res).toEqual({ ok: true, throttled: true });
    expect(mocks.getValidAccessToken).not.toHaveBeenCalled();
  });

  it('runs delta sync when deltaToken present', async () => {
    mocks.integrationFindFirst.mockResolvedValue({
      id: 'I1',
      deltaToken: 'https://graph/d',
      lastSyncedAt: new Date(Date.now() - 60_000),
      status: 'active',
    });
    mocks.getValidAccessToken.mockResolvedValue('AT');
    mocks.clientFindMany.mockResolvedValue([]);
    mocks.listInboxDelta.mockResolvedValue({
      messages: [],
      removedIds: ['MX'],
      deltaLink: 'https://graph/d2',
    });
    mocks.emailUpdateMany.mockResolvedValue({ count: 1 });
    mocks.integrationUpdate.mockResolvedValue({});
    const res = await syncGraphInbox();
    expect(res).toEqual({ ok: true, fetched: 0, removed: 1 });
    expect(mocks.emailUpdateMany).toHaveBeenCalledWith({
      where: {
        workspaceId: 'W1',
        integrationId: 'I1',
        externalId: { in: ['MX'] },
        deletedAt: null,
      },
      data: { deletedAt: expect.any(Date) },
    });
  });

  it('returns ok:false when no active integration', async () => {
    mocks.integrationFindFirst.mockResolvedValue(null);
    const res = await syncGraphInbox();
    expect(res).toEqual({ ok: false, message: 'Aucune boîte connectée.' });
  });
});
