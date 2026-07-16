// @vitest-environment node
//
// jsdom's File/Blob implementation (as of jsdom 25) does not implement
// arrayBuffer()/stream()/text() — this action reads the upload via
// `file.arrayBuffer()`, which only Node's native File (undici) supports.
// Server Action tests belong in the node environment anyway; jsdom is for
// component tests. See apps/web/lib/auth/verify-jwt.test.ts for precedent.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth', () => ({
  requireUser: vi.fn(async () => ({ userId: 'u', workspaceId: 'w' })),
}));

const rate = vi.hoisted(() => vi.fn());
vi.mock('@/lib/rate-limit', () => ({
  getRateLimiter: () => ({ check: rate }),
}));

// SECURITY (ClamAV pivot, see docs/superpowers/plans/2026-07-16-mail-attachments.md
// Task 12 header note): the plan originally targeted VirusTotal
// (`scanFileWithVirusTotal(binary, apiKey)`); Task 5 shipped ClamAV instead
// (`scanFileWithClamAV(binary, { host, port })`). Config now flows through
// `@/lib/env` (project convention — every server-only value MUST be read via
// apps/web/lib/env.ts, see .env.example header) rather than raw
// `process.env['VIRUSTOTAL_API_KEY']`.
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

const upload = vi.hoisted(() =>
  vi.fn(
    async (
      ..._args: unknown[]
    ): Promise<{ ok: true; storagePath: string } | { ok: false; message: string }> => ({
      ok: true,
      storagePath: 'w/att-1',
    }),
  ),
);
vi.mock('@/lib/mail-attachment-storage', () => ({
  uploadMailAttachment: (...a: unknown[]) => upload(...a),
}));

const fromBuffer = vi.hoisted(() =>
  vi.fn(
    async (..._args: unknown[]): Promise<{ mime: string } | undefined> => ({
      mime: 'application/pdf',
    }),
  ),
);
vi.mock('file-type', () => ({
  fileTypeFromBuffer: (...a: unknown[]) => fromBuffer(...a),
}));

const findFirstAttachment = vi.hoisted(() => vi.fn());
const auditCreate = vi.hoisted(() => vi.fn());
vi.mock('@nexushub/db', () => ({
  prisma: {
    emailAttachment: { findFirst: findFirstAttachment },
    auditLog: { create: auditCreate },
  },
}));

import { uploadAttachment } from './upload-attachment';

beforeEach(() => {
  vi.clearAllMocks();
  envState.CLAMAV_HOST = 'clamav.internal';
  envState.CLAMAV_PORT = 3310;
});

function makeFile(name: string, type: string, size: number): File {
  return new File([new Uint8Array(size)], name, { type });
}

describe('uploadAttachment', () => {
  it('rejects when rate-limit exhausted', async () => {
    rate.mockResolvedValueOnce({ success: false, reset: Date.now() + 3600_000 });
    const fd = new FormData();
    fd.append('file', makeFile('a.pdf', 'application/pdf', 100));
    const r = await uploadAttachment(fd);
    expect(r).toEqual({ ok: false, code: 'RATE_LIMIT', message: expect.any(String) });
  });

  it('rejects files > 25 MB', async () => {
    rate.mockResolvedValueOnce({ success: true });
    const fd = new FormData();
    fd.append('file', makeFile('big.pdf', 'application/pdf', 26 * 1024 * 1024));
    const r = await uploadAttachment(fd);
    expect(r).toEqual({ ok: false, code: 'TOO_LARGE', message: expect.any(String) });
  });

  it('rejects blacklisted extensions before scan', async () => {
    rate.mockResolvedValueOnce({ success: true });
    const fd = new FormData();
    fd.append('file', makeFile('virus.exe', 'application/x-msdownload', 100));
    const r = await uploadAttachment(fd);
    expect(r).toEqual({ ok: false, code: 'BLACKLISTED_EXT', message: expect.any(String) });
    expect(scan).not.toHaveBeenCalled();
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: 'w',
        actorId: 'u',
        action: 'attachment_rejected_upload',
        data: expect.objectContaining({ reason: 'ext_blacklist' }),
      }),
    });
  });

  it.each([
    ['virus.sh', 'application/x-sh'],
    ['virus.dll', 'application/x-msdownload'],
  ])('rejects blacklisted extension %s (ClamAV pivot addition)', async (name, type) => {
    rate.mockResolvedValueOnce({ success: true });
    const fd = new FormData();
    fd.append('file', makeFile(name, type, 100));
    const r = await uploadAttachment(fd);
    expect(r).toEqual({ ok: false, code: 'BLACKLISTED_EXT', message: expect.any(String) });
    expect(scan).not.toHaveBeenCalled();
  });

  it('happy path: clean scan → row + Storage + return AttachmentDraft', async () => {
    rate.mockResolvedValueOnce({ success: true });
    findFirstAttachment.mockResolvedValueOnce(null); // no dedup hit
    scan.mockResolvedValueOnce({ clean: true, verdict: 'clean', stats: {}, analysisId: 'a1' });
    const fd = new FormData();
    fd.append('file', makeFile('rapport.pdf', 'application/pdf', 100));
    const r = await uploadAttachment(fd);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.filename).toBe('rapport.pdf');
      expect(r.contentType).toBe('application/pdf');
      expect(r.sizeBytes).toBe(100);
    }
    expect(scan).toHaveBeenCalledOnce();
    expect(scan).toHaveBeenCalledWith(expect.any(Buffer), {
      host: 'clamav.internal',
      port: 3310,
    });
    expect(upload).toHaveBeenCalledOnce();
    expect(auditCreate.mock.calls[0]?.[0]).toMatchObject({
      data: { action: 'attachment_uploaded' },
    });
    // PII: filename must never appear in the attachment_uploaded audit payload.
    const uploadedCall = auditCreate.mock.calls.find(
      (c) => (c[0] as { data: { action: string } }).data.action === 'attachment_uploaded',
    ) as [{ data: { data: Record<string, unknown> } }];
    expect(uploadedCall[0].data.data).not.toHaveProperty('filename');
  });

  it('dedup: SHA-256 hit skips ClamAV and clones the storage path', async () => {
    rate.mockResolvedValueOnce({ success: true });
    findFirstAttachment.mockResolvedValueOnce({
      storagePath: 'w/existing',
      scanReport: { analysisId: 'a-old' },
    });
    const fd = new FormData();
    fd.append('file', makeFile('rapport.pdf', 'application/pdf', 100));
    const r = await uploadAttachment(fd);
    expect(r.ok).toBe(true);
    expect(scan).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it('dirty scan: audit + return code=DIRTY, no Storage put', async () => {
    rate.mockResolvedValueOnce({ success: true });
    findFirstAttachment.mockResolvedValueOnce(null);
    scan.mockResolvedValueOnce({
      clean: false,
      verdict: 'dirty',
      stats: { malicious: 3, suspicious: 0, harmless: 0, undetected: 40 },
      analysisId: 'a-dirty',
      detectingEngines: ['ClamAV: EngineA'],
    });
    const fd = new FormData();
    fd.append('file', makeFile('mal.pdf', 'application/pdf', 100));
    const r = await uploadAttachment(fd);
    expect(r).toMatchObject({ ok: false, code: 'DIRTY' });
    expect(upload).not.toHaveBeenCalled();
    const auditEvent = auditCreate.mock.calls[0]?.[0] as { data: { action: string } };
    expect(auditEvent.data.action).toBe('attachment_scanned_dirty');
  });

  // --- Extra defensive tests (guards not covered by the plan's 6 base tests) ---

  it('magic-byte sniff: declared MIME does not match sniffed MIME → TYPE_SPOOF, no scan', async () => {
    rate.mockResolvedValueOnce({ success: true });
    findFirstAttachment.mockResolvedValueOnce(null);
    fromBuffer.mockResolvedValueOnce({ mime: 'application/x-msdownload' });
    const fd = new FormData();
    // Declares PDF, but the .exe extension is disguised as .pdf so it slips
    // past the extension blacklist — the magic-byte sniff must still catch it.
    fd.append('file', makeFile('invoice.pdf', 'application/pdf', 100));
    const r = await uploadAttachment(fd);
    expect(r).toEqual({ ok: false, code: 'TYPE_SPOOF', message: expect.any(String) });
    expect(scan).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'attachment_rejected_upload',
        data: expect.objectContaining({
          reason: 'type_spoof',
          declaredType: 'application/pdf',
          sniffedType: 'application/x-msdownload',
        }),
      }),
    });
  });

  it('ownership: ignores a client-supplied workspaceId field and scopes every query to the JWT workspace', async () => {
    rate.mockResolvedValueOnce({ success: true });
    findFirstAttachment.mockResolvedValueOnce(null);
    scan.mockResolvedValueOnce({ clean: true, verdict: 'clean', stats: {}, analysisId: 'a1' });
    const fd = new FormData();
    fd.append('file', makeFile('rapport.pdf', 'application/pdf', 100));
    // A malicious client could try to smuggle a foreign workspaceId alongside
    // the file — the action must never read it from the FormData.
    fd.append('workspaceId', 'attacker-workspace');
    const r = await uploadAttachment(fd);
    expect(r.ok).toBe(true);
    expect(findFirstAttachment).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ workspaceId: 'w' }) }),
    );
    expect(upload).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'w' }));
    for (const call of auditCreate.mock.calls) {
      expect((call[0] as { data: { workspaceId: string } }).data.workspaceId).toBe('w');
    }
  });

  it('fails closed with SCAN_FAILED when ClamAV is not configured (no CLAMAV_HOST)', async () => {
    envState.CLAMAV_HOST = undefined;
    rate.mockResolvedValueOnce({ success: true });
    findFirstAttachment.mockResolvedValueOnce(null);
    const fd = new FormData();
    fd.append('file', makeFile('rapport.pdf', 'application/pdf', 100));
    const r = await uploadAttachment(fd);
    expect(r).toEqual({ ok: false, code: 'SCAN_FAILED', message: expect.any(String) });
    expect(scan).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it('never surfaces the raw Storage/service-role error to the client on UPLOAD_FAILED', async () => {
    rate.mockResolvedValueOnce({ success: true });
    findFirstAttachment.mockResolvedValueOnce(null);
    scan.mockResolvedValueOnce({ clean: true, verdict: 'clean', stats: {}, analysisId: 'a1' });
    upload.mockResolvedValueOnce({
      ok: false,
      message: 'insert into "storage"."objects" ... service_role key abcdef123 rejected',
    });
    const fd = new FormData();
    fd.append('file', makeFile('rapport.pdf', 'application/pdf', 100));
    const r = await uploadAttachment(fd);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('UPLOAD_FAILED');
      expect(r.message).not.toMatch(/service_role|storage\.objects/i);
    }
  });
});
