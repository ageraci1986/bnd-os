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

const deleteMailAttachment = vi.hoisted(() => vi.fn());
vi.mock('@/lib/mail-attachment-storage', () => ({
  deleteMailAttachment: (...a: unknown[]) => deleteMailAttachment(...a),
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

  it('persists composeAttachments', async () => {
    upsert.mockResolvedValueOnce({ id: 'd1' });
    const r = await saveDraft({
      fromIntegrationId: '00000000-0000-0000-0000-000000000000',
      kind: 'new_mail',
      toRecipients: [],
      ccRecipients: [],
      bccRecipients: [],
      subject: '',
      bodyHtml: '',
      composeAttachments: [
        {
          id: '00000000-0000-0000-0000-000000000001',
          filename: 'a.pdf',
          contentType: 'application/pdf',
          sizeBytes: 100,
          storagePath: 'w/00000000-0000-0000-0000-000000000001',
          sha256: 'a'.repeat(64),
        },
      ],
    });
    expect(r).toEqual({ ok: true, id: 'd1' });
    const created = upsert.mock.calls[0]?.[0] as { create: { composeAttachments: unknown[] } };
    expect(created.create.composeAttachments).toHaveLength(1);
  });

  it('rejects saveDraft with > 20 attachments', async () => {
    const many = Array.from({ length: 21 }, (_, i) => ({
      id: '00000000-0000-0000-0000-' + String(i).padStart(12, '0'),
      filename: `a${i}.pdf`,
      contentType: 'application/pdf',
      sizeBytes: 100,
      storagePath: `w/00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
      sha256: 'a'.repeat(64),
    }));
    await expect(
      saveDraft({
        fromIntegrationId: '00000000-0000-0000-0000-000000000000',
        kind: 'new_mail',
        toRecipients: [],
        ccRecipients: [],
        bccRecipients: [],
        subject: '',
        bodyHtml: '',
        composeAttachments: many,
      }),
    ).rejects.toBeDefined();
  });
});

describe('loadDraft', () => {
  it('returns null when no draft exists', async () => {
    findFirst.mockResolvedValueOnce(null);
    const r = await loadDraft();
    expect(r).toEqual({ ok: true, draft: null });
  });

  it('returns composeAttachments parsed from the persisted JSONB', async () => {
    findFirst.mockResolvedValueOnce({
      id: 'd1',
      fromIntegrationId: '00000000-0000-0000-0000-000000000000',
      kind: 'new_mail',
      replyToId: null,
      toRecipients: [],
      ccRecipients: [],
      bccRecipients: [],
      subject: '',
      bodyHtml: '',
      composeAttachments: [
        {
          id: '00000000-0000-0000-0000-000000000001',
          filename: 'a.pdf',
          contentType: 'application/pdf',
          sizeBytes: 100,
          storagePath: 'w/00000000-0000-0000-0000-000000000001',
          sha256: 'a'.repeat(64),
        },
      ],
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });
    const r = await loadDraft();
    expect(r.draft?.composeAttachments).toHaveLength(1);
    expect(r.draft?.composeAttachments[0]?.filename).toBe('a.pdf');
  });

  it('falls back to an empty array when the persisted JSONB is malformed', async () => {
    findFirst.mockResolvedValueOnce({
      id: 'd1',
      fromIntegrationId: '00000000-0000-0000-0000-000000000000',
      kind: 'new_mail',
      replyToId: null,
      toRecipients: [],
      ccRecipients: [],
      bccRecipients: [],
      subject: '',
      bodyHtml: '',
      composeAttachments: [{ garbage: true }],
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });
    const r = await loadDraft();
    expect(r.draft?.composeAttachments).toEqual([]);
  });
});

describe('deleteDraft', () => {
  it('deletes rows for the caller', async () => {
    findFirst.mockResolvedValueOnce(null);
    deleteMany.mockResolvedValueOnce({ count: 1 });
    const r = await deleteDraft();
    expect(r).toEqual({ ok: true });
  });

  it('best-effort deletes fresh compose-time uploads from Storage, skipping reprised entries', async () => {
    findFirst.mockResolvedValueOnce({
      composeAttachments: [
        {
          id: '00000000-0000-0000-0000-000000000001',
          filename: 'a.pdf',
          contentType: 'application/pdf',
          sizeBytes: 100,
          storagePath: 'w/fresh',
          sha256: 'a'.repeat(64),
        },
        {
          id: '00000000-0000-0000-0000-000000000002',
          filename: 'b.pdf',
          contentType: 'application/pdf',
          sizeBytes: 200,
          storagePath: 'w/reprise',
          sha256: 'b'.repeat(64),
          reprisedFromAttachmentId: '00000000-0000-0000-0000-000000000099',
        },
      ],
    });
    deleteMany.mockResolvedValueOnce({ count: 1 });
    const r = await deleteDraft();
    expect(r).toEqual({ ok: true });
    expect(deleteMailAttachment).toHaveBeenCalledTimes(1);
    expect(deleteMailAttachment).toHaveBeenCalledWith('w/fresh');
  });
});
