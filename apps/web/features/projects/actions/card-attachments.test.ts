import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as StorageModule from '@/lib/card-attachment-storage';
import type * as CoreModule from '../lib/card-attachment-core';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  loadAccessibleCard: vi.fn(),
  listCardAttachmentDTOs: vi.fn(),
  rateCheck: vi.fn(),
  getRateLimiter: vi.fn(),
  attachmentCount: vi.fn(),
  attachmentCreate: vi.fn(),
  attachmentFindFirst: vi.fn(),
  attachmentFindMany: vi.fn(),
  listRecentlyRejected: vi.fn(),
  getSignedUrls: vi.fn(),
  attachmentDelete: vi.fn(),
  auditCreate: vi.fn(),
  createUploadUrl: vi.fn(),
  getSignedUrl: vi.fn(),
  removeObject: vi.fn(),
  inngestSend: vi.fn(),
}));

vi.mock('@nexushub/db', () => ({
  prisma: {
    cardAttachment: {
      count: mocks.attachmentCount,
      create: mocks.attachmentCreate,
      findFirst: mocks.attachmentFindFirst,
      findMany: mocks.attachmentFindMany,
      deleteMany: mocks.attachmentDelete,
    },
    auditLog: { create: mocks.auditCreate },
  },
}));
vi.mock('@/lib/auth', () => ({ requireUser: mocks.requireUser }));
vi.mock('@/lib/rate-limit', () => ({ getRateLimiter: mocks.getRateLimiter }));
vi.mock('@/lib/card-attachment-storage', async () => {
  const actual = await vi.importActual<typeof StorageModule>('@/lib/card-attachment-storage');
  return {
    cardAttachmentPath: actual.cardAttachmentPath,
    createCardAttachmentUploadUrl: mocks.createUploadUrl,
    getCardAttachmentSignedUrl: mocks.getSignedUrl,
    getCardAttachmentSignedUrls: mocks.getSignedUrls,
    removeCardAttachment: mocks.removeObject,
  };
});
vi.mock('@/lib/supabase/server', () => ({ createSupabaseAdmin: vi.fn() }));
vi.mock('@/lib/inngest/client', () => ({ inngestClient: { send: mocks.inngestSend } }));
vi.mock('../lib/card-attachment-core', async () => {
  const actual = await vi.importActual<typeof CoreModule>('../lib/card-attachment-core');
  return {
    canDeleteAttachment: actual.canDeleteAttachment,
    loadAccessibleCard: mocks.loadAccessibleCard,
    listCardAttachmentDTOs: mocks.listCardAttachmentDTOs,
    listRecentlyRejectedAttachments: mocks.listRecentlyRejected,
  };
});

import {
  deleteCardAttachment,
  finalizeCardAttachment,
  getCardAttachmentThumbUrls,
  getCardAttachmentUrl,
  listCardAttachments,
  requestCardAttachmentUpload,
} from './card-attachments';

const WS = '11111111-1111-1111-1111-111111111111';
const CARD = '22222222-2222-2222-2222-222222222222';
const PROJECT = '33333333-3333-3333-3333-333333333333';
const ME = '55555555-5555-5555-5555-555555555555';
const OTHER = '66666666-6666-6666-6666-666666666666';
const ATT = '77777777-7777-7777-7777-777777777777';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function user(role: 'admin' | 'user' | 'viewer' = 'user', userId = ME) {
  return { userId, email: 'me@test', workspaceId: WS, role, isSuperAdmin: false };
}

const validRequest = {
  cardId: CARD,
  filename: 'brief.pdf',
  contentType: 'application/pdf',
  sizeBytes: 1024,
};

const ROW = {
  id: ATT,
  workspaceId: WS,
  cardId: CARD,
  uploadedById: ME,
  filename: 'brief.pdf',
  contentType: 'application/pdf',
  sizeBytes: 1024,
  storagePath: `${WS}/${CARD}/${ATT}`,
  scanStatus: 'clean',
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireUser.mockResolvedValue(user());
  mocks.rateCheck.mockResolvedValue({ success: true });
  mocks.getRateLimiter.mockReturnValue({ check: mocks.rateCheck });
  mocks.loadAccessibleCard.mockResolvedValue({ id: CARD, projectId: PROJECT });
  mocks.attachmentCount.mockResolvedValue(0);
  mocks.attachmentCreate.mockResolvedValue({ id: ATT });
  mocks.createUploadUrl.mockImplementation(async (path: string) => ({
    ok: true,
    signedUrl: `https://storage.test/upload/${path}?token=tok`,
    token: 'tok',
    path,
  }));
  mocks.getSignedUrl.mockResolvedValue({ ok: true, signedUrl: 'https://storage.test/read' });
  mocks.attachmentFindFirst.mockResolvedValue(ROW);
  mocks.attachmentDelete.mockResolvedValue(ROW);
  mocks.auditCreate.mockResolvedValue({});
  mocks.removeObject.mockResolvedValue(undefined);
  mocks.inngestSend.mockResolvedValue({ ids: ['evt'] });
  mocks.listRecentlyRejected.mockResolvedValue([]);
  mocks.attachmentFindMany.mockResolvedValue([]);
  mocks.getSignedUrls.mockResolvedValue({ ok: true, urls: new Map() });
});

describe('requestCardAttachmentUpload', () => {
  it('refuses a Viewer before anything else', async () => {
    mocks.requireUser.mockResolvedValue(user('viewer'));
    const res = await requestCardAttachmentUpload(validRequest);
    expect(res).toEqual({
      ok: false,
      code: 'FORBIDDEN',
      message: 'Action indisponible : rôle Viewer en lecture seule.',
    });
    expect(mocks.loadAccessibleCard).not.toHaveBeenCalled();
    expect(mocks.attachmentCreate).not.toHaveBeenCalled();
  });

  it('rejects invalid input', async () => {
    const res = await requestCardAttachmentUpload({ ...validRequest, cardId: 'nope' });
    expect(res).toMatchObject({ ok: false, code: 'INVALID_INPUT' });
    const res2 = await requestCardAttachmentUpload({ ...validRequest, contentType: 'bad type' });
    expect(res2).toMatchObject({ ok: false, code: 'INVALID_INPUT' });
    const res3 = await requestCardAttachmentUpload({ ...validRequest, sizeBytes: 0 });
    expect(res3).toMatchObject({ ok: false, code: 'INVALID_INPUT' });
  });

  it('returns NOT_FOUND for a card out of scope', async () => {
    mocks.loadAccessibleCard.mockResolvedValue(null);
    const res = await requestCardAttachmentUpload(validRequest);
    expect(res).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(mocks.attachmentCreate).not.toHaveBeenCalled();
  });

  it('applies the per-user upload rate limit', async () => {
    mocks.rateCheck.mockResolvedValue({ success: false });
    const res = await requestCardAttachmentUpload(validRequest);
    expect(res).toMatchObject({ ok: false, code: 'RATE_LIMIT' });
    expect(mocks.getRateLimiter).toHaveBeenCalledWith('card_attachment_upload');
    expect(mocks.rateCheck).toHaveBeenCalledWith(ME);
  });

  it('refuses a disallowed type (.exe)', async () => {
    const res = await requestCardAttachmentUpload({
      ...validRequest,
      filename: 'setup.exe',
      contentType: 'application/x-msdownload',
    });
    expect(res).toEqual({
      ok: false,
      code: 'TYPE_NOT_ALLOWED',
      message: 'Type de fichier non autorisé.',
    });
    expect(mocks.attachmentCreate).not.toHaveBeenCalled();
  });

  it('refuses files over 50 MB', async () => {
    const res = await requestCardAttachmentUpload({
      ...validRequest,
      sizeBytes: 50 * 1024 * 1024 + 1,
    });
    expect(res).toEqual({
      ok: false,
      code: 'TOO_LARGE',
      message: 'Fichier trop volumineux (max 50 Mo).',
    });
  });

  it('refuses when the card already holds 50 visible attachments', async () => {
    mocks.attachmentCount.mockResolvedValue(50);
    const res = await requestCardAttachmentUpload(validRequest);
    expect(res).toMatchObject({ ok: false, code: 'TOO_MANY' });
    expect(mocks.attachmentCount.mock.calls[0]![0]).toEqual({
      where: { workspaceId: WS, cardId: CARD, scanStatus: { in: ['pending', 'clean'] } },
    });
    expect(mocks.attachmentCreate).not.toHaveBeenCalled();
  });

  it('returns UPLOAD_FAILED with a generic message when signing fails, dropping the row', async () => {
    mocks.createUploadUrl.mockResolvedValue({ ok: false, message: 'bucket internals' });
    const res = await requestCardAttachmentUpload(validRequest);
    expect(res).toMatchObject({ ok: false, code: 'UPLOAD_FAILED' });
    expect(JSON.stringify(res)).not.toContain('bucket internals');
    const id = mocks.attachmentCreate.mock.calls[0]![0].data.id;
    expect(mocks.attachmentDelete).toHaveBeenCalledWith({ where: { id, workspaceId: WS } });
  });

  it('creates the row BEFORE signing the upload URL (no signed URL without a row)', async () => {
    const order: string[] = [];
    mocks.attachmentCreate.mockImplementation(async () => {
      order.push('create');
      return { id: ATT };
    });
    mocks.createUploadUrl.mockImplementation(async (path: string) => {
      order.push('sign');
      return { ok: true, signedUrl: `https://storage.test/${path}`, token: 'tok', path };
    });
    const res = await requestCardAttachmentUpload(validRequest);
    expect(res.ok).toBe(true);
    expect(order).toEqual(['create', 'sign']);
    expect(mocks.attachmentDelete).not.toHaveBeenCalled();
  });

  it('creates a pending row at ws/card/<uuid> and returns the signed upload URL', async () => {
    const res = await requestCardAttachmentUpload({
      ...validRequest,
      contentType: 'Application/PDF',
    });
    if (!res.ok) throw new Error(`expected ok, got ${res.code}`);
    expect(res.attachmentId).toMatch(UUID_RE);
    expect(res.path).toBe(`${WS}/${CARD}/${res.attachmentId}`);
    expect(res.token).toBe('tok');
    expect(res.signedUrl).toContain(res.path);

    const data = mocks.attachmentCreate.mock.calls[0]![0].data;
    expect(data).toEqual({
      id: res.attachmentId,
      workspaceId: WS,
      cardId: CARD,
      uploadedById: ME,
      filename: 'brief.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1024,
      storagePath: res.path,
    });
  });

  it('sanitizes the filename before storing it', async () => {
    const res = await requestCardAttachmentUpload({
      ...validRequest,
      filename: '../../etc/\u0000brief.pdf',
    });
    expect(res.ok).toBe(true);
    const data = mocks.attachmentCreate.mock.calls[0]![0].data;
    expect(data.filename).toBe('....etcbrief.pdf');
  });
});

describe('finalizeCardAttachment', () => {
  it('returns NOT_FOUND for another user’s (or non-pending) attachment', async () => {
    mocks.attachmentFindFirst.mockResolvedValue(null);
    const res = await finalizeCardAttachment({ attachmentId: ATT });
    expect(res).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(mocks.attachmentFindFirst.mock.calls[0]![0].where).toEqual({
      id: ATT,
      workspaceId: WS,
      uploadedById: ME,
      scanStatus: 'pending',
    });
    expect(mocks.inngestSend).not.toHaveBeenCalled();
  });

  it('emits card-attachment/uploaded with a dedup id on success', async () => {
    mocks.attachmentFindFirst.mockResolvedValue({ ...ROW, scanStatus: 'pending' });
    const res = await finalizeCardAttachment({ attachmentId: ATT });
    expect(res).toEqual({ ok: true });
    // Inngest déduplique sur `id` (24 h) : un double finalize ne lance qu'un scan.
    expect(mocks.inngestSend).toHaveBeenCalledWith({
      id: `card-attachment-uploaded:${ATT}`,
      name: 'card-attachment/uploaded',
      data: { attachmentId: ATT },
    });
  });

  it('rate-limits finalize per user with a dedicated key', async () => {
    mocks.attachmentFindFirst.mockResolvedValue({ ...ROW, scanStatus: 'pending' });
    mocks.rateCheck.mockResolvedValue({ success: false });
    const res = await finalizeCardAttachment({ attachmentId: ATT });
    expect(res).toMatchObject({ ok: false, code: 'RATE_LIMIT' });
    expect(mocks.getRateLimiter).toHaveBeenCalledWith('card_attachment_finalize');
    expect(mocks.rateCheck).toHaveBeenCalledWith(ME);
    expect(mocks.inngestSend).not.toHaveBeenCalled();
  });

  it('re-checks card access (scope may have changed since the request)', async () => {
    mocks.attachmentFindFirst.mockResolvedValue({ ...ROW, scanStatus: 'pending' });
    mocks.loadAccessibleCard.mockResolvedValue(null);
    const res = await finalizeCardAttachment({ attachmentId: ATT });
    expect(res).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(mocks.loadAccessibleCard).toHaveBeenCalledWith(expect.anything(), CARD);
    expect(mocks.inngestSend).not.toHaveBeenCalled();
  });

  it('rejects an invalid id', async () => {
    const res = await finalizeCardAttachment({ attachmentId: 'x' });
    expect(res).toMatchObject({ ok: false, code: 'INVALID_INPUT' });
  });
});

describe('listCardAttachments', () => {
  it('returns NOT_FOUND when the card is not accessible', async () => {
    mocks.loadAccessibleCard.mockResolvedValue(null);
    const res = await listCardAttachments({ cardId: CARD });
    expect(res).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(mocks.listCardAttachmentDTOs).not.toHaveBeenCalled();
  });

  it('returns the DTOs (Viewer allowed)', async () => {
    mocks.requireUser.mockResolvedValue(user('viewer'));
    mocks.listCardAttachmentDTOs.mockResolvedValue([{ id: ATT }]);
    const res = await listCardAttachments({ cardId: CARD });
    expect(res).toEqual({ ok: true, attachments: [{ id: ATT }], recentlyRejected: [] });
  });

  it("also returns the caller's recent rejections (id + reason only)", async () => {
    mocks.listCardAttachmentDTOs.mockResolvedValue([]);
    mocks.listRecentlyRejected.mockResolvedValue([{ id: ATT, rejectReason: 'virus' }]);
    const res = await listCardAttachments({ cardId: CARD });
    expect(res).toEqual({
      ok: true,
      attachments: [],
      recentlyRejected: [{ id: ATT, rejectReason: 'virus' }],
    });
    expect(mocks.listRecentlyRejected).toHaveBeenCalledWith(
      expect.objectContaining({ userId: ME, workspaceId: WS }),
      CARD,
    );
  });
});

describe('getCardAttachmentUrl', () => {
  it('rate-limits downloads per user', async () => {
    mocks.rateCheck.mockResolvedValue({ success: false });
    const res = await getCardAttachmentUrl({ attachmentId: ATT, disposition: 'inline' });
    expect(res).toMatchObject({ ok: false, code: 'RATE_LIMIT' });
    expect(mocks.getRateLimiter).toHaveBeenCalledWith('card_attachment_download');
  });

  it('scopes the row to the workspace and checks card access', async () => {
    mocks.loadAccessibleCard.mockResolvedValue(null);
    const res = await getCardAttachmentUrl({ attachmentId: ATT, disposition: 'inline' });
    expect(res).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(mocks.attachmentFindFirst.mock.calls[0]![0].where).toEqual({
      id: ATT,
      workspaceId: WS,
    });
    expect(mocks.getSignedUrl).not.toHaveBeenCalled();
  });

  it('returns NOT_READY for a pending attachment', async () => {
    mocks.attachmentFindFirst.mockResolvedValue({ ...ROW, scanStatus: 'pending' });
    const res = await getCardAttachmentUrl({ attachmentId: ATT, disposition: 'inline' });
    expect(res).toMatchObject({ ok: false, code: 'NOT_READY' });
    expect(mocks.getSignedUrl).not.toHaveBeenCalled();
  });

  it('signs inline without a download option', async () => {
    const res = await getCardAttachmentUrl({ attachmentId: ATT, disposition: 'inline' });
    expect(res).toEqual({ ok: true, url: 'https://storage.test/read' });
    expect(mocks.getSignedUrl).toHaveBeenCalledWith(ROW.storagePath, {});
  });

  it('forces a download disposition for non-previewable files even when inline is asked', async () => {
    mocks.attachmentFindFirst.mockResolvedValue({
      ...ROW,
      filename: 'notes.txt',
      contentType: 'text/plain',
    });
    const res = await getCardAttachmentUrl({ attachmentId: ATT, disposition: 'inline' });
    expect(res.ok).toBe(true);
    expect(mocks.getSignedUrl).toHaveBeenCalledWith(ROW.storagePath, { download: 'notes.txt' });
  });

  it('passes the filename as download option for disposition=attachment', async () => {
    mocks.requireUser.mockResolvedValue(user('viewer'));
    const res = await getCardAttachmentUrl({ attachmentId: ATT, disposition: 'attachment' });
    expect(res.ok).toBe(true);
    expect(mocks.getSignedUrl).toHaveBeenCalledWith(ROW.storagePath, { download: 'brief.pdf' });
  });
});

describe('deleteCardAttachment', () => {
  it('refuses a Member who is not the author', async () => {
    mocks.requireUser.mockResolvedValue(user('user', OTHER));
    const res = await deleteCardAttachment({ attachmentId: ATT });
    expect(res).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(mocks.removeObject).not.toHaveBeenCalled();
    expect(mocks.attachmentDelete).not.toHaveBeenCalled();
  });

  it('refuses a Viewer', async () => {
    mocks.requireUser.mockResolvedValue(user('viewer'));
    const res = await deleteCardAttachment({ attachmentId: ATT });
    expect(res).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });

  it('returns NOT_FOUND when the card is not accessible', async () => {
    mocks.loadAccessibleCard.mockResolvedValue(null);
    const res = await deleteCardAttachment({ attachmentId: ATT });
    expect(res).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });

  it('lets an Admin delete: object removed, row deleted, audit without filename', async () => {
    mocks.requireUser.mockResolvedValue(user('admin', OTHER));
    const res = await deleteCardAttachment({ attachmentId: ATT });
    expect(res).toEqual({ ok: true });
    expect(mocks.removeObject).toHaveBeenCalledWith(ROW.storagePath);
    expect(mocks.attachmentDelete).toHaveBeenCalledWith({ where: { id: ATT, workspaceId: WS } });
    const audit = mocks.auditCreate.mock.calls[0]![0].data;
    expect(audit).toEqual({
      action: 'card_attachment_deleted',
      workspaceId: WS,
      actorId: OTHER,
      subjectType: 'card_attachment',
      subjectId: ATT,
      data: { contentType: 'application/pdf', sizeBytes: 1024 },
    });
    expect(JSON.stringify(audit)).not.toContain('brief.pdf');
  });

  it('lets the author delete their own attachment', async () => {
    const res = await deleteCardAttachment({ attachmentId: ATT });
    expect(res).toEqual({ ok: true });
  });
});

describe('getCardAttachmentThumbUrls', () => {
  const IMG1 = '88888888-8888-8888-8888-888888888888';
  const IMG2 = '99999999-9999-9999-9999-999999999999';

  it('rejects invalid input and inaccessible cards', async () => {
    expect(await getCardAttachmentThumbUrls({ cardId: 'x' })).toMatchObject({
      code: 'INVALID_INPUT',
    });
    mocks.loadAccessibleCard.mockResolvedValue(null);
    expect(await getCardAttachmentThumbUrls({ cardId: CARD })).toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(mocks.getSignedUrls).not.toHaveBeenCalled();
  });

  it('is rate-limited once per call with the thumbs key', async () => {
    mocks.rateCheck.mockResolvedValue({ success: false });
    const res = await getCardAttachmentThumbUrls({ cardId: CARD });
    expect(res).toMatchObject({ ok: false, code: 'RATE_LIMIT' });
    expect(mocks.getRateLimiter).toHaveBeenCalledWith('card_attachment_thumbs');
  });

  it('batch-signs the clean previewable images of the card only (one Storage call)', async () => {
    mocks.attachmentFindMany.mockResolvedValue([
      { id: IMG1, contentType: 'image/png', storagePath: `${WS}/${CARD}/${IMG1}` },
      { id: IMG2, contentType: 'image/jpeg', storagePath: `${WS}/${CARD}/${IMG2}` },
      { id: ATT, contentType: 'image/heic', storagePath: `${WS}/${CARD}/${ATT}` },
    ]);
    mocks.getSignedUrls.mockResolvedValue({
      ok: true,
      urls: new Map([
        [`${WS}/${CARD}/${IMG1}`, 'https://storage.test/1'],
        [`${WS}/${CARD}/${IMG2}`, 'https://storage.test/2'],
      ]),
    });
    const res = await getCardAttachmentThumbUrls({ cardId: CARD });
    expect(res).toEqual({
      ok: true,
      urls: { [IMG1]: 'https://storage.test/1', [IMG2]: 'https://storage.test/2' },
    });
    expect(mocks.attachmentFindMany.mock.calls[0]![0].where).toEqual({
      workspaceId: WS,
      cardId: CARD,
      scanStatus: 'clean',
      contentType: { startsWith: 'image/' },
    });
    // HEIC exclu (non prévisualisable).
    expect(mocks.getSignedUrls).toHaveBeenCalledTimes(1);
    expect(mocks.getSignedUrls).toHaveBeenCalledWith([
      `${WS}/${CARD}/${IMG1}`,
      `${WS}/${CARD}/${IMG2}`,
    ]);
  });

  it('returns URL_FAILED with a generic message when batch signing fails', async () => {
    mocks.attachmentFindMany.mockResolvedValue([
      { id: IMG1, contentType: 'image/png', storagePath: 'p' },
    ]);
    mocks.getSignedUrls.mockResolvedValue({ ok: false, message: 'internals' });
    const res = await getCardAttachmentThumbUrls({ cardId: CARD });
    expect(res).toMatchObject({ ok: false, code: 'URL_FAILED' });
    expect(JSON.stringify(res)).not.toContain('internals');
  });
});
