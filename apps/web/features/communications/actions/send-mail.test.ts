import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth', () => ({
  requireUser: vi.fn(async () => ({ userId: 'u', workspaceId: 'w' })),
}));

const rate = vi.hoisted(() => vi.fn());
vi.mock('@/lib/rate-limit', () => ({
  checkMailSendRate: (uid: string) => rate(uid),
}));

const integrationFindFirst = vi.hoisted(() => vi.fn());
const emailCreate = vi.hoisted(() => vi.fn());
const emailUpdate = vi.hoisted(() => vi.fn());
const emailAttachmentCreate = vi.hoisted(() => vi.fn());
const emailAttachmentFindFirst = vi.hoisted(() => vi.fn());
const draftDeleteMany = vi.hoisted(() => vi.fn());
const auditCreate = vi.hoisted(() => vi.fn());
vi.mock('@nexushub/db', () => ({
  prisma: {
    integration: { findFirst: integrationFindFirst },
    emailMessage: { create: emailCreate, update: emailUpdate },
    emailAttachment: { create: emailAttachmentCreate, findFirst: emailAttachmentFindFirst },
    mailDraft: { deleteMany: draftDeleteMany },
    auditLog: { create: auditCreate },
  },
}));

const graphSend = vi.hoisted(() => vi.fn());
vi.mock('@nexushub/integrations/graph', async (importOriginal) => {
  const actual = await importOriginal<typeof GraphModule>();
  return {
    ...actual,
    sendViaGraph: (...a: unknown[]) => graphSend(...a),
  };
});

vi.mock('@/features/integrations/lib/get-valid-access-token', () => ({
  getValidAccessToken: vi.fn(async () => 'AT'),
}));

const imapSend = vi.hoisted(() => vi.fn());
vi.mock('./send-mail-imap', () => ({
  sendViaImapSmtp: (...a: unknown[]) => imapSend(...a),
}));

const downloadAttachment = vi.hoisted(() => vi.fn());
vi.mock('@/lib/mail-attachment-storage', () => ({
  downloadMailAttachment: (...a: unknown[]) => downloadAttachment(...a),
}));

import { sendMail } from './send-mail';
import {
  GraphPayloadTooLargeError,
  GraphReplyAttachmentsUnsupportedError,
} from '@nexushub/integrations/graph';
import type * as GraphModule from '@nexushub/integrations/graph';

beforeEach(() => vi.clearAllMocks());

function baseInput() {
  return {
    fromIntegrationId: '00000000-0000-0000-0000-000000000000',
    mode: 'new_mail' as const,
    toRecipients: ['you@ex.com'],
    ccRecipients: [],
    bccRecipients: [],
    subject: 'Hi',
    bodyHtml: '<p>Body</p>',
  };
}

function cleanAttachment(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    filename: 'doc.pdf',
    contentType: 'application/pdf',
    sizeBytes: 1024,
    storagePath: 'w/11111111-1111-1111-1111-111111111111',
    sha256: 'a'.repeat(64),
    ...overrides,
  };
}

describe('sendMail Graph happy path', () => {
  it('inserts queued row → transitions to sent, deletes draft, audits', async () => {
    rate.mockResolvedValueOnce({ success: true });
    integrationFindFirst.mockResolvedValueOnce({
      id: 'i1',
      kind: 'graph',
      externalAccountId: 'me@ex.com',
      signatureHtml: null,
    });
    emailCreate.mockResolvedValueOnce({ id: 'e1' });
    graphSend.mockResolvedValueOnce({ ok: true });
    const r = await sendMail(baseInput());
    expect(r).toEqual({ ok: true, emailMessageId: 'e1' });
    expect(emailUpdate).toHaveBeenCalledTimes(2); // sending, then sent
    expect(draftDeleteMany).toHaveBeenCalledOnce();
    expect(auditCreate).toHaveBeenCalledOnce();
    expect(auditCreate.mock.calls[0]?.[0]).toMatchObject({ data: { action: 'mail_sent' } });
  });
});

describe('sendMail rate limit', () => {
  it('returns RATE_LIMIT without touching DB when exhausted', async () => {
    rate.mockResolvedValueOnce({ success: false, window: 'hour', reset: Date.now() + 3600_000 });
    const r = await sendMail(baseInput());
    expect(r).toEqual({
      ok: false,
      code: 'RATE_LIMIT',
      window: 'hour',
      retryAfterMs: expect.any(Number),
    });
    expect(integrationFindFirst).not.toHaveBeenCalled();
  });
});

describe('sendMail recipient cap', () => {
  it('rejects >20 total recipients', async () => {
    const many = Array.from({ length: 21 }, (_, i) => `u${i}@ex.com`);
    const r = await sendMail({ ...baseInput(), toRecipients: many });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('TOO_MANY_RECIPIENTS');
  });
});

describe('sendMail failure path', () => {
  it('marks row failed + audits, does NOT delete draft', async () => {
    rate.mockResolvedValueOnce({ success: true });
    integrationFindFirst.mockResolvedValueOnce({
      id: 'i1',
      kind: 'graph',
      externalAccountId: 'me@ex.com',
      signatureHtml: null,
    });
    emailCreate.mockResolvedValueOnce({ id: 'e1' });
    graphSend.mockRejectedValueOnce(new Error('graph 429'));
    const r = await sendMail(baseInput());
    expect(r.ok).toBe(false);
    const failUpdate = emailUpdate.mock.calls.find(
      (c) => (c[0] as { data?: Record<string, unknown> })?.data?.['sendStatus'] === 'failed',
    );
    expect(failUpdate).toBeDefined();
    expect(draftDeleteMany).not.toHaveBeenCalled();
    const auditPayload = auditCreate.mock.calls[0]?.[0] as { data: { action: string } };
    expect(auditPayload.data.action).toBe('mail_send_failed');
  });
});

describe('sendMail with attachments — Graph', () => {
  it('happy path: downloads binary, sends with attachments, creates EmailAttachment row, flips hasAttachments', async () => {
    rate.mockResolvedValueOnce({ success: true });
    integrationFindFirst.mockResolvedValueOnce({
      id: 'i1',
      kind: 'graph',
      externalAccountId: 'me@ex.com',
      signatureHtml: null,
    });
    emailCreate.mockResolvedValueOnce({ id: 'e1' });
    downloadAttachment.mockResolvedValueOnce({ ok: true, binary: Buffer.from('pdf-bytes') });
    graphSend.mockResolvedValueOnce({ ok: true });
    emailAttachmentCreate.mockResolvedValueOnce({ id: 'att1' });

    const att = cleanAttachment();
    const r = await sendMail({ ...baseInput(), composeAttachments: [att] });

    expect(r).toEqual({ ok: true, emailMessageId: 'e1' });
    expect(downloadAttachment).toHaveBeenCalledWith(att.storagePath);
    const graphArgs = graphSend.mock.calls[0]?.[1] as { attachments?: unknown[] };
    expect(graphArgs.attachments).toEqual([
      { filename: 'doc.pdf', contentType: 'application/pdf', content: Buffer.from('pdf-bytes') },
    ]);
    expect(emailAttachmentCreate).toHaveBeenCalledOnce();
    expect(emailAttachmentCreate.mock.calls[0]?.[0]).toMatchObject({
      data: {
        id: att.id,
        emailMessageId: 'e1',
        filename: 'doc.pdf',
        storagePath: att.storagePath,
        scanStatus: 'clean',
        sha256: att.sha256,
      },
    });
    const hasAttachmentsUpdate = emailUpdate.mock.calls.find(
      (c) => (c[0] as { data?: Record<string, unknown> })?.data?.['hasAttachments'] === true,
    );
    expect(hasAttachmentsUpdate).toBeDefined();
  });

  it('Graph oversize attachment → SEND_FAILED_TOO_LARGE', async () => {
    rate.mockResolvedValueOnce({ success: true });
    integrationFindFirst.mockResolvedValueOnce({
      id: 'i1',
      kind: 'graph',
      externalAccountId: 'me@ex.com',
      signatureHtml: null,
    });
    emailCreate.mockResolvedValueOnce({ id: 'e1' });
    downloadAttachment.mockResolvedValueOnce({ ok: true, binary: Buffer.alloc(4_000_000) });
    graphSend.mockRejectedValueOnce(new GraphPayloadTooLargeError(4_000_000));

    const r = await sendMail({ ...baseInput(), composeAttachments: [cleanAttachment()] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('SEND_FAILED_TOO_LARGE');
  });

  it('Graph reply + attachments → SEND_FAILED_UNSUPPORTED', async () => {
    rate.mockResolvedValueOnce({ success: true });
    integrationFindFirst.mockResolvedValueOnce({
      id: 'i1',
      kind: 'graph',
      externalAccountId: 'me@ex.com',
      signatureHtml: null,
    });
    emailCreate.mockResolvedValueOnce({ id: 'e1' });
    downloadAttachment.mockResolvedValueOnce({ ok: true, binary: Buffer.from('x') });
    graphSend.mockRejectedValueOnce(new GraphReplyAttachmentsUnsupportedError());

    const r = await sendMail({
      ...baseInput(),
      mode: 'reply',
      replyToExternalId: 'ext-1',
      composeAttachments: [cleanAttachment()],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('SEND_FAILED_UNSUPPORTED');
  });

  it('Storage download failure → generic SEND_FAILED, no raw error leaked', async () => {
    rate.mockResolvedValueOnce({ success: true });
    integrationFindFirst.mockResolvedValueOnce({
      id: 'i1',
      kind: 'graph',
      externalAccountId: 'me@ex.com',
      signatureHtml: null,
    });
    emailCreate.mockResolvedValueOnce({ id: 'e1' });
    downloadAttachment.mockResolvedValueOnce({
      ok: false,
      message: 'internal bucket policy denied xyz',
    });

    const r = await sendMail({ ...baseInput(), composeAttachments: [cleanAttachment()] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('SEND_FAILED');
      expect(r.message).not.toContain('internal bucket policy denied');
    }
    expect(graphSend).not.toHaveBeenCalled();
  });
});

describe('sendMail with attachments — readiness check', () => {
  it('refuses a reprised attachment whose source is not clean → ATTACHMENTS_NOT_READY', async () => {
    rate.mockResolvedValueOnce({ success: true });
    integrationFindFirst.mockResolvedValueOnce({
      id: 'i1',
      kind: 'graph',
      externalAccountId: 'me@ex.com',
      signatureHtml: null,
    });
    // findFirst filtered by scanStatus:'clean' finds nothing → not ready.
    emailAttachmentFindFirst.mockResolvedValueOnce(null);

    const reprised = cleanAttachment({
      reprisedFromAttachmentId: '22222222-2222-2222-2222-222222222222',
    });
    const r = await sendMail({ ...baseInput(), composeAttachments: [reprised] });

    expect(r).toEqual({
      ok: false,
      code: 'ATTACHMENTS_NOT_READY',
      message: expect.any(String),
    });
    expect(emailCreate).not.toHaveBeenCalled();
    expect(downloadAttachment).not.toHaveBeenCalled();
  });

  it('refuses a storagePath scoped to a foreign workspace → ATTACHMENTS_NOT_READY', async () => {
    rate.mockResolvedValueOnce({ success: true });
    integrationFindFirst.mockResolvedValueOnce({
      id: 'i1',
      kind: 'graph',
      externalAccountId: 'me@ex.com',
      signatureHtml: null,
    });
    const foreign = cleanAttachment({
      storagePath: 'other-workspace/11111111-1111-1111-1111-111111111111',
    });
    const r = await sendMail({ ...baseInput(), composeAttachments: [foreign] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('ATTACHMENTS_NOT_READY');
    expect(emailCreate).not.toHaveBeenCalled();
  });

  it('accepts a reprised attachment whose source IS clean, preserves reprisedFrom in scanReport', async () => {
    rate.mockResolvedValueOnce({ success: true });
    integrationFindFirst.mockResolvedValueOnce({
      id: 'i1',
      kind: 'imap',
      externalAccountId: 'me@ex.com',
      signatureHtml: null,
    });
    emailAttachmentFindFirst.mockResolvedValueOnce({ id: '22222222-2222-2222-2222-222222222222' });
    emailCreate.mockResolvedValueOnce({ id: 'e1' });
    downloadAttachment.mockResolvedValueOnce({ ok: true, binary: Buffer.from('y') });
    imapSend.mockResolvedValueOnce(undefined);
    emailAttachmentCreate.mockResolvedValueOnce({ id: 'att1' });

    const reprised = cleanAttachment({
      reprisedFromAttachmentId: '22222222-2222-2222-2222-222222222222',
    });
    const r = await sendMail({ ...baseInput(), composeAttachments: [reprised] });

    expect(r).toEqual({ ok: true, emailMessageId: 'e1' });
    expect(emailAttachmentCreate.mock.calls[0]?.[0]).toMatchObject({
      data: {
        scanReport: {
          deduped: true,
          reprisedFrom: '22222222-2222-2222-2222-222222222222',
        },
      },
    });
  });
});

describe('sendMail with attachments — SMTP', () => {
  it('happy path with 2 attachments via SMTP', async () => {
    rate.mockResolvedValueOnce({ success: true });
    integrationFindFirst.mockResolvedValueOnce({
      id: 'i1',
      kind: 'imap',
      externalAccountId: 'me@ex.com',
      signatureHtml: null,
    });
    emailCreate.mockResolvedValueOnce({ id: 'e1' });
    downloadAttachment
      .mockResolvedValueOnce({ ok: true, binary: Buffer.from('a') })
      .mockResolvedValueOnce({ ok: true, binary: Buffer.from('b') });
    imapSend.mockResolvedValueOnce(undefined);
    emailAttachmentCreate.mockResolvedValue({ id: 'att' });

    const att1 = cleanAttachment();
    const att2 = cleanAttachment({
      id: '33333333-3333-3333-3333-333333333333',
      filename: 'img.png',
      contentType: 'image/png',
      storagePath: 'w/33333333-3333-3333-3333-333333333333',
      sha256: 'b'.repeat(64),
    });
    const r = await sendMail({ ...baseInput(), composeAttachments: [att1, att2] });

    expect(r).toEqual({ ok: true, emailMessageId: 'e1' });
    const imapArgs = imapSend.mock.calls[0]?.[0] as {
      payload: { attachments?: unknown[] };
    };
    expect(imapArgs.payload.attachments).toHaveLength(2);
    expect(emailAttachmentCreate).toHaveBeenCalledTimes(2);
  });
});
