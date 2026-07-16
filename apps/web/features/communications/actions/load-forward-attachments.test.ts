// @vitest-environment node
//
// Server Action test — mirrors the mock setup pattern from
// fetch-attachment.test.ts / remove-attachment-from-draft.test.ts.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth', () => ({
  requireUser: vi.fn(async () => ({ userId: 'u', workspaceId: 'w' })),
}));

const rate = vi.hoisted(() => vi.fn());
vi.mock('@/lib/rate-limit', () => ({
  getRateLimiter: () => ({ check: rate }),
}));

const fetchAttachmentBinary = vi.hoisted(() => vi.fn());
vi.mock('./fetch-attachment', () => ({
  fetchAttachmentBinary: (...a: unknown[]) => fetchAttachmentBinary(...a),
}));

// mail-drafts.ts pulls in mail-attachment-storage at module scope — stub it
// out so importing the real attachmentDraftSchema/AttachmentDraft type
// doesn't require a live Supabase client.
vi.mock('@/lib/mail-attachment-storage', () => ({
  deleteMailAttachment: vi.fn(),
  uploadMailAttachment: vi.fn(),
  getMailAttachmentSignedUrl: vi.fn(),
}));

const findFirstMessage = vi.hoisted(() => vi.fn());
const findFirstDraft = vi.hoisted(() => vi.fn());
const updateDraft = vi.hoisted(() => vi.fn());
const findFirstAttachment = vi.hoisted(() => vi.fn());
const auditCreate = vi.hoisted(() => vi.fn());
vi.mock('@nexushub/db', () => ({
  prisma: {
    emailMessage: { findFirst: findFirstMessage },
    mailDraft: { findFirst: findFirstDraft, update: updateDraft },
    emailAttachment: { findFirst: findFirstAttachment },
    auditLog: { create: auditCreate },
  },
}));

import { loadForwardAttachments } from './load-forward-attachments';

const MSG_ID = '11111111-1111-1111-1111-111111111111';
const DRAFT_ID = '22222222-2222-2222-2222-222222222222';

function cleanAttachment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'att-1',
    filename: 'rapport.pdf',
    contentType: 'application/pdf',
    sizeBytes: 100,
    storagePath: 'w/att-1',
    sha256: 'a'.repeat(64),
    scanStatus: 'clean',
    ...overrides,
  };
}

function uncachedAttachment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'att-2',
    filename: 'logo.png',
    contentType: 'image/png',
    sizeBytes: 200,
    storagePath: null,
    sha256: null,
    scanStatus: null,
    ...overrides,
  };
}

function dirtyAttachment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'att-3',
    filename: 'virus.exe.pdf',
    contentType: 'application/pdf',
    sizeBytes: 50,
    storagePath: null,
    sha256: null,
    scanStatus: 'dirty',
    ...overrides,
  };
}

function emptyDraftRow(overrides: Record<string, unknown> = {}) {
  return { id: DRAFT_ID, composeAttachments: [], ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  rate.mockResolvedValue({ success: true });
  findFirstDraft.mockResolvedValue(emptyDraftRow());
  updateDraft.mockResolvedValue({ id: DRAFT_ID });
});

describe('loadForwardAttachments', () => {
  it('happy path: 3 clean cached attachments → all added, drafted merged, one audit each', async () => {
    findFirstMessage.mockResolvedValueOnce({
      integrationId: 'int-1',
      emailAttachments: [
        cleanAttachment({ id: 'att-1', filename: 'a.pdf' }),
        cleanAttachment({ id: 'att-2', filename: 'b.pdf' }),
        cleanAttachment({ id: 'att-3', filename: 'c.pdf' }),
      ],
    });

    const r = await loadForwardAttachments({ emailMessageId: MSG_ID, draftId: DRAFT_ID });

    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('expected ok');
    expect(r.added).toHaveLength(3);
    expect(r.skipped).toHaveLength(0);
    for (const a of r.added) {
      expect(a.reprisedFromAttachmentId).toBeDefined();
    }
    expect(fetchAttachmentBinary).not.toHaveBeenCalled();
    expect(auditCreate).toHaveBeenCalledTimes(3);
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'attachment_downloaded' }),
    });
    expect(updateDraft).toHaveBeenCalledWith({
      where: { id: DRAFT_ID },
      data: {
        composeAttachments: expect.arrayContaining([
          expect.objectContaining({ id: expect.any(String) }),
        ]),
      },
    });
    const args = updateDraft.mock.calls[0]?.[0] as { data: { composeAttachments: unknown[] } };
    expect(args.data.composeAttachments).toHaveLength(3);
  });

  it('mixed: 1 clean cached, 1 clean lazy-fetched, 1 dirty → 2 added, 1 skipped(DIRTY)', async () => {
    findFirstMessage.mockResolvedValueOnce({
      integrationId: 'int-1',
      emailAttachments: [
        cleanAttachment({ id: 'att-1' }),
        uncachedAttachment({ id: 'att-2' }),
        dirtyAttachment({ id: 'att-3' }),
      ],
    });
    fetchAttachmentBinary.mockResolvedValueOnce({
      ok: true,
      signedUrl: 'https://signed/url',
      expiresAt: Date.now(),
      filename: 'logo.png',
    });
    findFirstAttachment.mockResolvedValueOnce({ storagePath: 'w/att-2', sha256: 'b'.repeat(64) });

    const r = await loadForwardAttachments({ emailMessageId: MSG_ID, draftId: DRAFT_ID });

    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('expected ok');
    expect(r.added).toHaveLength(2);
    expect(r.skipped).toEqual([{ filename: 'virus.exe.pdf', reason: 'DIRTY' }]);
    expect(fetchAttachmentBinary).toHaveBeenCalledTimes(1);
    expect(fetchAttachmentBinary).toHaveBeenCalledWith({ attachmentId: 'att-2' });
    // Cached path audits itself once; lazy-fetch path's audit lives inside
    // fetchAttachmentBinary (mocked away here) — so exactly one audit call.
    expect(auditCreate).toHaveBeenCalledTimes(1);
  });

  it('all dirty → 0 added, 3 skipped with DIRTY, no draft write', async () => {
    findFirstMessage.mockResolvedValueOnce({
      integrationId: 'int-1',
      emailAttachments: [
        dirtyAttachment({ id: 'att-1', filename: 'x1.pdf' }),
        dirtyAttachment({ id: 'att-2', filename: 'x2.pdf' }),
        dirtyAttachment({ id: 'att-3', filename: 'x3.pdf' }),
      ],
    });

    const r = await loadForwardAttachments({ emailMessageId: MSG_ID, draftId: DRAFT_ID });

    expect(r).toEqual({
      ok: true,
      added: [],
      skipped: [
        { filename: 'x1.pdf', reason: 'DIRTY' },
        { filename: 'x2.pdf', reason: 'DIRTY' },
        { filename: 'x3.pdf', reason: 'DIRTY' },
      ],
    });
    expect(updateDraft).not.toHaveBeenCalled();
  });

  it('ownership mismatch (wrong workspace / wrong mailbox owner) → refused, no draft lookup', async () => {
    findFirstMessage.mockResolvedValueOnce(null);

    const r = await loadForwardAttachments({ emailMessageId: MSG_ID, draftId: DRAFT_ID });

    expect(r).toEqual({ ok: false, message: 'Mail introuvable.' });
    expect(findFirstMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId: 'w',
          integration: expect.objectContaining({ workspaceId: 'w', ownerUserId: 'u' }),
        }),
      }),
    );
    expect(findFirstDraft).not.toHaveBeenCalled();
  });

  it('spoofed draftId (does not match the caller draft row) → refused', async () => {
    findFirstMessage.mockResolvedValueOnce({ integrationId: 'int-1', emailAttachments: [] });
    findFirstDraft.mockResolvedValueOnce(emptyDraftRow({ id: 'some-other-draft-id' }));

    const r = await loadForwardAttachments({ emailMessageId: MSG_ID, draftId: DRAFT_ID });

    expect(r).toEqual({ ok: false, message: 'Brouillon introuvable.' });
    expect(updateDraft).not.toHaveBeenCalled();
  });

  it('overflow: draft already has 18 attachments, email has 5 clean cached → 2 added, 3 skipped(CAP_REACHED)', async () => {
    const existing = Array.from({ length: 18 }, (_, i) => ({
      id: `33333333-3333-3333-3333-3333333333${String(i).padStart(2, '0')}`,
      filename: `existing-${i}.pdf`,
      contentType: 'application/pdf',
      sizeBytes: 10,
      storagePath: `w/existing-${i}`,
      sha256: 'c'.repeat(64),
    }));
    findFirstDraft.mockResolvedValueOnce(emptyDraftRow({ composeAttachments: existing }));
    findFirstMessage.mockResolvedValueOnce({
      integrationId: 'int-1',
      emailAttachments: Array.from({ length: 5 }, (_, i) =>
        cleanAttachment({ id: `new-${i}`, filename: `new-${i}.pdf` }),
      ),
    });

    const r = await loadForwardAttachments({ emailMessageId: MSG_ID, draftId: DRAFT_ID });

    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('expected ok');
    expect(r.added).toHaveLength(2);
    expect(r.skipped).toEqual([
      { filename: 'new-2.pdf', reason: 'CAP_REACHED' },
      { filename: 'new-3.pdf', reason: 'CAP_REACHED' },
      { filename: 'new-4.pdf', reason: 'CAP_REACHED' },
    ]);
    const args = updateDraft.mock.calls[0]?.[0] as { data: { composeAttachments: unknown[] } };
    expect(args.data.composeAttachments).toHaveLength(20);
  });

  it('rate limit exhausted (cached path) → all skipped with RATE_LIMIT, nothing added', async () => {
    rate.mockResolvedValue({ success: false });
    findFirstMessage.mockResolvedValueOnce({
      integrationId: 'int-1',
      emailAttachments: [
        cleanAttachment({ id: 'att-1', filename: 'a.pdf' }),
        cleanAttachment({ id: 'att-2', filename: 'b.pdf' }),
      ],
    });

    const r = await loadForwardAttachments({ emailMessageId: MSG_ID, draftId: DRAFT_ID });

    expect(r).toEqual({
      ok: true,
      added: [],
      skipped: [
        { filename: 'a.pdf', reason: 'RATE_LIMIT' },
        { filename: 'b.pdf', reason: 'RATE_LIMIT' },
      ],
    });
    expect(updateDraft).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('rate limit exhausted (lazy-fetch path) → propagates RATE_LIMIT from fetchAttachmentBinary', async () => {
    findFirstMessage.mockResolvedValueOnce({
      integrationId: 'int-1',
      emailAttachments: [uncachedAttachment({ id: 'att-2', filename: 'logo.png' })],
    });
    fetchAttachmentBinary.mockResolvedValueOnce({
      ok: false,
      code: 'RATE_LIMIT',
      message: 'Trop de téléchargements.',
    });

    const r = await loadForwardAttachments({ emailMessageId: MSG_ID, draftId: DRAFT_ID });

    expect(r).toEqual({
      ok: true,
      added: [],
      skipped: [{ filename: 'logo.png', reason: 'RATE_LIMIT' }],
    });
  });

  it('lazy fetch failure (FETCH_FAILED from fetchAttachmentBinary) → skipped with FETCH_FAILED', async () => {
    findFirstMessage.mockResolvedValueOnce({
      integrationId: 'int-1',
      emailAttachments: [uncachedAttachment({ id: 'att-2', filename: 'logo.png' })],
    });
    fetchAttachmentBinary.mockResolvedValueOnce({
      ok: false,
      code: 'FETCH_FAILED',
      message: 'boom',
    });

    const r = await loadForwardAttachments({ emailMessageId: MSG_ID, draftId: DRAFT_ID });

    expect(r).toEqual({
      ok: true,
      added: [],
      skipped: [{ filename: 'logo.png', reason: 'FETCH_FAILED' }],
    });
  });

  it('no attachments on source email → added: [], skipped: [], no draft write', async () => {
    findFirstMessage.mockResolvedValueOnce({ integrationId: 'int-1', emailAttachments: [] });

    const r = await loadForwardAttachments({ emailMessageId: MSG_ID, draftId: DRAFT_ID });

    expect(r).toEqual({ ok: true, added: [], skipped: [] });
    expect(updateDraft).not.toHaveBeenCalled();
  });

  it('never leaks storagePath outside the AttachmentDraft-shaped response (no raw signedUrl echoed)', async () => {
    findFirstMessage.mockResolvedValueOnce({
      integrationId: 'int-1',
      emailAttachments: [cleanAttachment({ id: 'att-1' })],
    });

    const r = await loadForwardAttachments({ emailMessageId: MSG_ID, draftId: DRAFT_ID });

    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('expected ok');
    expect(r.added[0]).toEqual({
      id: expect.any(String),
      filename: 'rapport.pdf',
      contentType: 'application/pdf',
      sizeBytes: 100,
      storagePath: 'w/att-1',
      sha256: 'a'.repeat(64),
      reprisedFromAttachmentId: 'att-1',
    });
  });
});
