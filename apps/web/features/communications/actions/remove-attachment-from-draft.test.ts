import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth', () => ({
  requireUser: vi.fn(async () => ({ userId: 'u', workspaceId: 'w' })),
}));

const findFirst = vi.hoisted(() => vi.fn());
const update = vi.hoisted(() => vi.fn());
vi.mock('@nexushub/db', () => ({
  prisma: { mailDraft: { findFirst, update } },
}));

const deleteMailAttachment = vi.hoisted(() => vi.fn());
vi.mock('@/lib/mail-attachment-storage', () => ({
  deleteMailAttachment: (...a: unknown[]) => deleteMailAttachment(...a),
}));

import { removeAttachmentFromDraft } from './remove-attachment-from-draft';

const FRESH_ID = '00000000-0000-0000-0000-000000000001';
const REPRISE_ID = '00000000-0000-0000-0000-000000000002';

function draftRow(overrides?: Partial<{ composeAttachments: unknown[] }>) {
  return {
    id: 'd1',
    composeAttachments: overrides?.composeAttachments ?? [
      {
        id: FRESH_ID,
        filename: 'a.pdf',
        contentType: 'application/pdf',
        sizeBytes: 100,
        storagePath: 'w/fresh',
        sha256: 'a'.repeat(64),
      },
      {
        id: REPRISE_ID,
        filename: 'b.pdf',
        contentType: 'application/pdf',
        sizeBytes: 200,
        storagePath: 'w/reprise',
        sha256: 'b'.repeat(64),
        reprisedFromAttachmentId: '00000000-0000-0000-0000-000000000099',
      },
    ],
  };
}

beforeEach(() => vi.clearAllMocks());

describe('removeAttachmentFromDraft', () => {
  it('removes a fresh upload from the JSON array and deletes it from Storage', async () => {
    findFirst.mockResolvedValueOnce(draftRow());
    update.mockResolvedValueOnce({ id: 'd1' });

    const r = await removeAttachmentFromDraft({ attachmentDraftId: FRESH_ID });

    expect(r).toEqual({ ok: true });
    const args = update.mock.calls[0]?.[0] as {
      where: { id: string };
      data: { composeAttachments: { id: string }[] };
    };
    expect(args.where).toEqual({ id: 'd1' });
    expect(args.data.composeAttachments).toHaveLength(1);
    expect(args.data.composeAttachments[0]?.id).toBe(REPRISE_ID);
    expect(deleteMailAttachment).toHaveBeenCalledWith('w/fresh');
  });

  it('removes a reprised (Forward) entry without deleting it from Storage', async () => {
    findFirst.mockResolvedValueOnce(draftRow());
    update.mockResolvedValueOnce({ id: 'd1' });

    const r = await removeAttachmentFromDraft({ attachmentDraftId: REPRISE_ID });

    expect(r).toEqual({ ok: true });
    expect(deleteMailAttachment).not.toHaveBeenCalled();
  });

  it('returns an error when the caller has no draft', async () => {
    findFirst.mockResolvedValueOnce(null);
    const r = await removeAttachmentFromDraft({ attachmentDraftId: FRESH_ID });
    expect(r).toEqual({ ok: false, message: 'Aucun brouillon.' });
    expect(update).not.toHaveBeenCalled();
  });

  it('returns an error when the attachment id is not present in the draft', async () => {
    findFirst.mockResolvedValueOnce(draftRow());
    const r = await removeAttachmentFromDraft({
      attachmentDraftId: '00000000-0000-0000-0000-000000000999',
    });
    expect(r).toEqual({ ok: false, message: 'Pièce jointe introuvable dans le brouillon.' });
    expect(update).not.toHaveBeenCalled();
    expect(deleteMailAttachment).not.toHaveBeenCalled();
  });

  it('scopes the draft lookup to the caller workspace and user (never trusts client draftId)', async () => {
    findFirst.mockResolvedValueOnce(draftRow());
    update.mockResolvedValueOnce({ id: 'd1' });

    await removeAttachmentFromDraft({ attachmentDraftId: FRESH_ID });

    const args = findFirst.mock.calls[0]?.[0] as { where: { workspaceId: string; userId: string } };
    expect(args.where).toEqual({ workspaceId: 'w', userId: 'u' });
  });
});
