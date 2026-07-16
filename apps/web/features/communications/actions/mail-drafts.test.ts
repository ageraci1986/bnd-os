import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth', () => ({
  requireUser: vi.fn(async () => ({ userId: 'u', workspaceId: 'w' })),
}));

const upsert = vi.hoisted(() => vi.fn());
const findFirst = vi.hoisted(() => vi.fn());
const deleteMany = vi.hoisted(() => vi.fn());
vi.mock('@nexushub/db', () => ({
  prisma: { mailDraft: { upsert, findFirst, deleteMany } },
}));

import { saveDraft, loadDraft, deleteDraft } from './mail-drafts';

beforeEach(() => vi.clearAllMocks());

describe('saveDraft', () => {
  it('upserts on the composite (workspaceId, userId) key', async () => {
    upsert.mockResolvedValueOnce({ id: 'd1' });
    const r = await saveDraft({
      fromIntegrationId: '00000000-0000-0000-0000-000000000000',
      kind: 'new_mail',
      toRecipients: ['you@ex.com'],
      ccRecipients: [],
      bccRecipients: [],
      subject: 'Hi',
      bodyHtml: '<p>Body</p>',
    });
    expect(r).toEqual({ ok: true, id: 'd1' });
    const args = upsert.mock.calls[0]?.[0] as { where: { workspaceId_userId: unknown } };
    expect(args.where.workspaceId_userId).toEqual({ workspaceId: 'w', userId: 'u' });
  });
});

describe('loadDraft', () => {
  it('returns null when no draft exists', async () => {
    findFirst.mockResolvedValueOnce(null);
    const r = await loadDraft();
    expect(r).toEqual({ ok: true, draft: null });
  });
});

describe('deleteDraft', () => {
  it('deletes rows for the caller', async () => {
    deleteMany.mockResolvedValueOnce({ count: 1 });
    const r = await deleteDraft();
    expect(r).toEqual({ ok: true });
  });
});
