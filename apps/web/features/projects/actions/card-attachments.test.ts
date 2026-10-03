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
  };
});

import {
  deleteCardAttachment,
  finalizeCardAttachment,
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

  it('returns UPLOAD_FAILED with a generic message when signing fails', async () => {
    mocks.createUploadUrl.mockResolvedValue({ ok: false, message: 'bucket internals' });
    const res = await requestCardAttachmentUpload(validRequest);
    expect(res).toMatchObject({ ok: false, code: 'UPLOAD_FAILED' });
    expect(JSON.stringify(res)).not.toContain('bucket internals');
    expect(mocks.attachmentCreate).not.toHaveBeenCalled();
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

  it('emits card-attachment/uploaded on success', async () => {
    mocks.attachmentFindFirst.mockResolvedValue({ ...ROW, scanStatus: 'pending' });
    const res = await finalizeCardAttachment({ attachmentId: ATT });
    expect(res).toEqual({ ok: true });
    expect(mocks.inngestSend).toHaveBeenCalledWith({
      name: 'card-attachment/uploaded',
      data: { attachmentId: ATT },
    });
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
    expect(res).toEqual({ ok: true, attachments: [{ id: ATT }] });
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
