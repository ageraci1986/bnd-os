// @vitest-environment node
//
// Server Action test — mirrors the mock setup pattern from
// upload-attachment.test.ts / fetch-mail-body.ts / sync-imap-inbox.test.ts.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth', () => ({
  requireUser: vi.fn(async () => ({ userId: 'u', workspaceId: 'w' })),
}));

const rate = vi.hoisted(() => vi.fn());
vi.mock('@/lib/rate-limit', () => ({
  getRateLimiter: () => ({ check: rate }),
}));

// SECURITY (ClamAV pivot, see docs/superpowers/plans/2026-07-16-mail-attachments.md
// Task 14 header note + Task 12 precedent): the plan/design-spec draft
// targets VirusTotal (`scanFileWithVirusTotal(binary, apiKey)`); Task 5
// shipped ClamAV instead (`scanFileWithClamAV(binary, { host, port })`).
const scan = vi.hoisted(() => vi.fn());
vi.mock('@nexushub/integrations/antivirus', () => ({
  scanFileWithClamAV: (...a: unknown[]) => scan(...a),
}));

const envState = vi.hoisted(() => ({
  CLAMAV_HOST: 'clamav.internal' as string | undefined,
  CLAMAV_PORT: 3310,
}));
vi.mock('@/lib/env', () => ({
  getServerEnv: () => envState,
}));

const fetchImapAttachmentBinary = vi.hoisted(() => vi.fn());
const mailboxOpen = vi.hoisted(() => vi.fn(async () => ({})));
const logout = vi.hoisted(() => vi.fn(async () => undefined));
const openImapSession = vi.hoisted(() =>
  vi.fn(async (..._args: unknown[]) => ({ mailboxOpen, logout })),
);
vi.mock('@nexushub/integrations/imap', () => ({
  fetchImapAttachmentBinary: (...a: unknown[]) => fetchImapAttachmentBinary(...a),
  openImapSession: (...a: unknown[]) => openImapSession(...a),
}));

const fetchGraphAttachmentBinary = vi.hoisted(() => vi.fn());
vi.mock('@nexushub/integrations/graph', () => ({
  fetchGraphAttachmentBinary: (...a: unknown[]) => fetchGraphAttachmentBinary(...a),
}));

const getValidImapCredentials = vi.hoisted(() => vi.fn());
vi.mock('@/features/integrations/lib/get-valid-imap-credentials', () => ({
  getValidImapCredentials: (...a: unknown[]) => getValidImapCredentials(...a),
}));

const getValidAccessToken = vi.hoisted(() => vi.fn());
vi.mock('@/features/integrations/lib/get-valid-access-token', () => ({
  getValidAccessToken: (...a: unknown[]) => getValidAccessToken(...a),
}));

const uploadMailAttachment = vi.hoisted(() => vi.fn());
const getMailAttachmentSignedUrl = vi.hoisted(() => vi.fn());
vi.mock('@/lib/mail-attachment-storage', () => ({
  uploadMailAttachment: (...a: unknown[]) => uploadMailAttachment(...a),
  getMailAttachmentSignedUrl: (...a: unknown[]) => getMailAttachmentSignedUrl(...a),
}));

const fromBuffer = vi.hoisted(() => vi.fn());
vi.mock('file-type', () => ({
  fileTypeFromBuffer: (...a: unknown[]) => fromBuffer(...a),
}));

const findFirstAttachment = vi.hoisted(() => vi.fn());
const updateAttachment = vi.hoisted(() => vi.fn());
const auditCreate = vi.hoisted(() => vi.fn());
vi.mock('@nexushub/db', () => ({
  prisma: {
    emailAttachment: { findFirst: findFirstAttachment, update: updateAttachment },
    auditLog: { create: auditCreate },
  },
}));

import { fetchAttachmentBinary } from './fetch-attachment';

const BASE_BINARY = Buffer.from('x'.repeat(100));

function imapAttachmentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'att-1',
    filename: 'rapport.pdf',
    contentType: 'application/pdf',
    sizeBytes: 100,
    sourceExternalId: '2.1',
    storagePath: null,
    scanStatus: null,
    emailMessage: {
      externalId: '42',
      integration: { id: 'int-1', kind: 'imap' },
    },
    ...overrides,
  };
}

function graphAttachmentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'att-1',
    filename: 'rapport.pdf',
    contentType: 'application/pdf',
    sizeBytes: 100,
    sourceExternalId: 'AAMk-graph-id',
    storagePath: null,
    scanStatus: null,
    emailMessage: {
      externalId: 'graph-msg-1',
      integration: { id: 'int-1', kind: 'graph' },
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  envState.CLAMAV_HOST = 'clamav.internal';
  envState.CLAMAV_PORT = 3310;
  rate.mockResolvedValue({ success: true });
  fromBuffer.mockResolvedValue({ mime: 'application/pdf' });
  getValidImapCredentials.mockResolvedValue({
    imap: { host: 'h', port: 993, secure: true, username: 'u', password: 'p' },
  });
  getValidAccessToken.mockResolvedValue('graph-token');
  fetchImapAttachmentBinary.mockResolvedValue(BASE_BINARY);
  fetchGraphAttachmentBinary.mockResolvedValue(BASE_BINARY);
  scan.mockResolvedValue({ clean: true, verdict: 'clean', stats: {}, analysisId: 'a1' });
  uploadMailAttachment.mockResolvedValue({ ok: true, storagePath: 'w/att-1' });
  getMailAttachmentSignedUrl.mockResolvedValue({ ok: true, signedUrl: 'https://signed/url' });
});

describe('fetchAttachmentBinary', () => {
  it('rejects when rate-limit exhausted, without querying the DB', async () => {
    rate.mockResolvedValueOnce({ success: false });
    const r = await fetchAttachmentBinary({ attachmentId: '11111111-1111-1111-1111-111111111111' });
    expect(r).toEqual({ ok: false, code: 'RATE_LIMIT', message: expect.any(String) });
    expect(findFirstAttachment).not.toHaveBeenCalled();
  });

  it('ownership guard: query is scoped to caller workspace + mailbox owner; not found → NOT_FOUND', async () => {
    findFirstAttachment.mockResolvedValueOnce(null);
    const r = await fetchAttachmentBinary({ attachmentId: '11111111-1111-1111-1111-111111111111' });
    expect(r).toEqual({ ok: false, code: 'NOT_FOUND', message: expect.any(String) });
    expect(findFirstAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId: 'w',
          emailMessage: expect.objectContaining({
            integration: expect.objectContaining({ workspaceId: 'w', ownerUserId: 'u' }),
          }),
        }),
      }),
    );
    expect(fetchImapAttachmentBinary).not.toHaveBeenCalled();
    expect(fetchGraphAttachmentBinary).not.toHaveBeenCalled();
  });

  it('right workspace, wrong mailbox owner → refused via the same query (Prisma returns null), no fetch', async () => {
    // The double-ownership where-clause means a wrong-owner row simply never
    // matches — Prisma returns null regardless of whether the row exists in
    // a different user's mailbox within the same workspace.
    findFirstAttachment.mockResolvedValueOnce(null);
    const r = await fetchAttachmentBinary({ attachmentId: '11111111-1111-1111-1111-111111111111' });
    expect(r).toEqual({ ok: false, code: 'NOT_FOUND', message: expect.any(String) });
    expect(fetchImapAttachmentBinary).not.toHaveBeenCalled();
  });

  it('cache hit clean: skips scan/fetch, returns signed URL, audits attachment_downloaded', async () => {
    findFirstAttachment.mockResolvedValueOnce(
      imapAttachmentRow({ storagePath: 'w/att-1', scanStatus: 'clean' }),
    );
    const r = await fetchAttachmentBinary({ attachmentId: '11111111-1111-1111-1111-111111111111' });
    expect(r).toEqual({
      ok: true,
      signedUrl: 'https://signed/url',
      expiresAt: expect.any(Number),
      filename: 'rapport.pdf',
    });
    expect(scan).not.toHaveBeenCalled();
    expect(fetchImapAttachmentBinary).not.toHaveBeenCalled();
    expect(uploadMailAttachment).not.toHaveBeenCalled();
    expect(getMailAttachmentSignedUrl).toHaveBeenCalledWith('w/att-1');
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'attachment_downloaded' }),
    });
    // PII: filename must never appear in the attachment_downloaded audit payload.
    const call = auditCreate.mock.calls[0]?.[0] as { data: { data: Record<string, unknown> } };
    expect(call.data.data).not.toHaveProperty('filename');
  });

  it('cache hit dirty → DIRTY error, no fetch, no scan', async () => {
    findFirstAttachment.mockResolvedValueOnce(
      imapAttachmentRow({ storagePath: 'w/att-1', scanStatus: 'dirty' }),
    );
    const r = await fetchAttachmentBinary({ attachmentId: '11111111-1111-1111-1111-111111111111' });
    expect(r).toEqual({ ok: false, code: 'DIRTY', message: expect.any(String) });
    expect(fetchImapAttachmentBinary).not.toHaveBeenCalled();
    expect(scan).not.toHaveBeenCalled();
    expect(getMailAttachmentSignedUrl).not.toHaveBeenCalled();
  });

  it('cache hit scan_failed → treated as dirty (fail-closed), no fetch', async () => {
    findFirstAttachment.mockResolvedValueOnce(
      imapAttachmentRow({ storagePath: null, scanStatus: 'scan_failed' }),
    );
    const r = await fetchAttachmentBinary({ attachmentId: '11111111-1111-1111-1111-111111111111' });
    expect(r).toEqual({ ok: false, code: 'DIRTY', message: expect.any(String) });
    expect(fetchImapAttachmentBinary).not.toHaveBeenCalled();
  });

  it('IMAP lazy fetch happy path: creds + session + mailboxOpen + fetch + clean scan + Storage + signed URL', async () => {
    findFirstAttachment.mockResolvedValueOnce(imapAttachmentRow());
    findFirstAttachment.mockResolvedValueOnce(null); // dedup miss
    const r = await fetchAttachmentBinary({ attachmentId: '11111111-1111-1111-1111-111111111111' });
    expect(r).toEqual({
      ok: true,
      signedUrl: 'https://signed/url',
      expiresAt: expect.any(Number),
      filename: 'rapport.pdf',
    });
    expect(getValidImapCredentials).toHaveBeenCalledWith({
      workspaceId: 'w',
      userId: 'u',
      integrationId: 'int-1',
    });
    expect(openImapSession).toHaveBeenCalledOnce();
    expect(mailboxOpen).toHaveBeenCalledWith('INBOX');
    expect(fetchImapAttachmentBinary).toHaveBeenCalledWith(expect.anything(), 42, '2.1');
    expect(logout).toHaveBeenCalledOnce();
    expect(scan).toHaveBeenCalledWith(expect.any(Buffer), { host: 'clamav.internal', port: 3310 });
    expect(uploadMailAttachment).toHaveBeenCalledWith({
      workspaceId: 'w',
      attachmentId: 'att-1',
      contentType: 'application/pdf',
      binary: expect.any(Buffer),
    });
    expect(updateAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'att-1' },
        data: expect.objectContaining({ storagePath: 'w/att-1', scanStatus: 'clean' }),
      }),
    );
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'attachment_downloaded' }),
    });
  });

  it('IMAP path always logs out the session, even on adapter throw', async () => {
    findFirstAttachment.mockResolvedValueOnce(imapAttachmentRow());
    fetchImapAttachmentBinary.mockRejectedValueOnce(new Error('IMAP fetch boom'));
    const r = await fetchAttachmentBinary({ attachmentId: '11111111-1111-1111-1111-111111111111' });
    expect(r).toEqual({ ok: false, code: 'FETCH_FAILED', message: 'IMAP fetch boom' });
    expect(logout).toHaveBeenCalledOnce();
  });

  it('Graph lazy fetch happy path: token + fetch + clean scan + Storage + signed URL', async () => {
    findFirstAttachment.mockResolvedValueOnce(graphAttachmentRow());
    findFirstAttachment.mockResolvedValueOnce(null); // dedup miss
    const r = await fetchAttachmentBinary({ attachmentId: '11111111-1111-1111-1111-111111111111' });
    expect(r.ok).toBe(true);
    expect(getValidAccessToken).toHaveBeenCalledWith('int-1');
    expect(fetchGraphAttachmentBinary).toHaveBeenCalledWith(
      'graph-token',
      'graph-msg-1',
      'AAMk-graph-id',
    );
    expect(openImapSession).not.toHaveBeenCalled();
    expect(uploadMailAttachment).toHaveBeenCalledOnce();
  });

  it('size mismatch: FETCH_FAILED + audit, no scan', async () => {
    findFirstAttachment.mockResolvedValueOnce(imapAttachmentRow({ sizeBytes: 999 }));
    const r = await fetchAttachmentBinary({ attachmentId: '11111111-1111-1111-1111-111111111111' });
    expect(r).toEqual({ ok: false, code: 'FETCH_FAILED', message: expect.any(String) });
    expect(scan).not.toHaveBeenCalled();
    expect(uploadMailAttachment).not.toHaveBeenCalled();
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'attachment_rejected_upload',
        data: expect.objectContaining({ reason: 'size_mismatch' }),
      }),
    });
  });

  it('dedup hit: skips ClamAV, clones storagePath, audits attachment_downloaded', async () => {
    findFirstAttachment.mockResolvedValueOnce(imapAttachmentRow());
    findFirstAttachment.mockResolvedValueOnce({
      storagePath: 'w/existing-clean',
      scanReport: { analysisId: 'old' },
    });
    const r = await fetchAttachmentBinary({ attachmentId: '11111111-1111-1111-1111-111111111111' });
    expect(r.ok).toBe(true);
    expect(scan).not.toHaveBeenCalled();
    expect(uploadMailAttachment).not.toHaveBeenCalled();
    expect(updateAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ storagePath: 'w/existing-clean', scanStatus: 'clean' }),
      }),
    );
    expect(getMailAttachmentSignedUrl).toHaveBeenCalledWith('w/existing-clean');
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'attachment_downloaded' }),
    });
  });

  it('magic-byte sniff mismatch: DIRTY, DB marked dirty, audit, no scan', async () => {
    findFirstAttachment.mockResolvedValueOnce(imapAttachmentRow());
    findFirstAttachment.mockResolvedValueOnce(null); // dedup miss
    fromBuffer.mockResolvedValueOnce({ mime: 'application/x-msdownload' });
    const r = await fetchAttachmentBinary({ attachmentId: '11111111-1111-1111-1111-111111111111' });
    expect(r).toEqual({ ok: false, code: 'DIRTY', message: expect.any(String) });
    expect(scan).not.toHaveBeenCalled();
    expect(uploadMailAttachment).not.toHaveBeenCalled();
    expect(updateAttachment).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ scanStatus: 'dirty' }) }),
    );
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'attachment_rejected_upload',
        data: expect.objectContaining({ reason: 'type_spoof' }),
      }),
    });
  });

  it('scan dirty: audit attachment_scanned_dirty WITH filename, DIRTY, no Storage upload', async () => {
    findFirstAttachment.mockResolvedValueOnce(imapAttachmentRow());
    findFirstAttachment.mockResolvedValueOnce(null); // dedup miss
    scan.mockResolvedValueOnce({
      clean: false,
      verdict: 'dirty',
      stats: { malicious: 1, suspicious: 0, harmless: 0, undetected: 0 },
      analysisId: 'a-dirty',
      detectingEngines: ['ClamAV: EngineA'],
    });
    const r = await fetchAttachmentBinary({ attachmentId: '11111111-1111-1111-1111-111111111111' });
    expect(r).toEqual({ ok: false, code: 'DIRTY', message: expect.any(String) });
    expect(uploadMailAttachment).not.toHaveBeenCalled();
    expect(updateAttachment).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ scanStatus: 'dirty' }) }),
    );
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'attachment_scanned_dirty',
        data: expect.objectContaining({ filename: 'rapport.pdf' }),
      }),
    });
  });

  it('scan_failed from the daemon: treated as dirty (fail-closed), no Storage upload', async () => {
    findFirstAttachment.mockResolvedValueOnce(imapAttachmentRow());
    findFirstAttachment.mockResolvedValueOnce(null); // dedup miss
    scan.mockResolvedValueOnce({
      clean: false,
      verdict: 'scan_failed',
      stats: {},
      analysisId: 'a-fail',
    });
    const r = await fetchAttachmentBinary({ attachmentId: '11111111-1111-1111-1111-111111111111' });
    expect(r).toEqual({ ok: false, code: 'DIRTY', message: expect.any(String) });
    expect(uploadMailAttachment).not.toHaveBeenCalled();
    expect(updateAttachment).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ scanStatus: 'scan_failed' }) }),
    );
  });

  it('fails closed with SCAN_FAILED when ClamAV is not configured (no CLAMAV_HOST)', async () => {
    envState.CLAMAV_HOST = undefined;
    findFirstAttachment.mockResolvedValueOnce(imapAttachmentRow());
    findFirstAttachment.mockResolvedValueOnce(null); // dedup miss
    const r = await fetchAttachmentBinary({ attachmentId: '11111111-1111-1111-1111-111111111111' });
    expect(r).toEqual({ ok: false, code: 'SCAN_FAILED', message: expect.any(String) });
    expect(scan).not.toHaveBeenCalled();
    expect(uploadMailAttachment).not.toHaveBeenCalled();
  });

  it('never surfaces the raw Storage/service-role error to the client on upload failure', async () => {
    findFirstAttachment.mockResolvedValueOnce(imapAttachmentRow());
    findFirstAttachment.mockResolvedValueOnce(null); // dedup miss
    uploadMailAttachment.mockResolvedValueOnce({
      ok: false,
      message: 'insert into "storage"."objects" ... service_role key abcdef123 rejected',
    });
    const r = await fetchAttachmentBinary({ attachmentId: '11111111-1111-1111-1111-111111111111' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('FETCH_FAILED');
      expect(r.message).not.toMatch(/service_role|storage\.objects/i);
    }
  });

  it('never surfaces the raw signed-URL service error to the client', async () => {
    findFirstAttachment.mockResolvedValueOnce(
      imapAttachmentRow({ storagePath: 'w/att-1', scanStatus: 'clean' }),
    );
    getMailAttachmentSignedUrl.mockResolvedValueOnce({
      ok: false,
      message: 'service_role token xyz rejected by storage.objects',
    });
    const r = await fetchAttachmentBinary({ attachmentId: '11111111-1111-1111-1111-111111111111' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).not.toMatch(/service_role|storage\.objects/i);
    }
  });
});
