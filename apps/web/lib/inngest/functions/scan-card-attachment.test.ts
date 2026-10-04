import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  runScanCardAttachment,
  scanCardAttachment,
  type ScanDeps,
  type ScanRow,
} from './scan-card-attachment';

const ID = '77777777-7777-7777-7777-777777777777';
const WS = '11111111-1111-1111-1111-111111111111';
const PDF_BYTES = Buffer.from('%PDF-1.7 fake pdf body');

function row(overrides: Partial<ScanRow> = {}): ScanRow {
  return {
    id: ID,
    workspaceId: WS,
    filename: 'brief.pdf',
    storagePath: `${WS}/card/${ID}`,
    contentType: 'application/pdf',
    sizeBytes: PDF_BYTES.length,
    scanStatus: 'pending',
    ...overrides,
  };
}

function deps(overrides: Partial<ScanDeps> = {}): ScanDeps {
  return {
    loadAttachment: vi.fn(async () => row()),
    stat: vi.fn(async () => ({
      ok: true as const,
      size: PDF_BYTES.length,
      contentType: 'application/pdf',
    })),
    download: vi.fn(async () => ({ ok: true as const, binary: PDF_BYTES })),
    sniff: vi.fn(async () => 'application/pdf'),
    scan: vi.fn(async () => ({ verdict: 'clean' as const })),
    markClean: vi.fn(async () => undefined),
    reject: vi.fn(async () => undefined),
    ...overrides,
  };
}

const SHA = createHash('sha256').update(PDF_BYTES).digest('hex');

describe('runScanCardAttachment', () => {
  it('skips an unknown attachment', async () => {
    const d = deps({ loadAttachment: vi.fn(async () => null) });
    expect(await runScanCardAttachment(d, ID)).toBe('skipped');
    expect(d.download).not.toHaveBeenCalled();
  });

  it('skips a malformed id without touching the DB', async () => {
    const d = deps();
    expect(await runScanCardAttachment(d, 'not-a-uuid')).toBe('skipped');
    expect(d.loadAttachment).not.toHaveBeenCalled();
  });

  it('skips an attachment that is no longer pending (idempotent re-delivery)', async () => {
    const d = deps({ loadAttachment: vi.fn(async () => row({ scanStatus: 'clean' })) });
    expect(await runScanCardAttachment(d, ID)).toBe('skipped');
    expect(d.download).not.toHaveBeenCalled();
    expect(d.markClean).not.toHaveBeenCalled();
  });

  it('marks a clean file clean with its sha256', async () => {
    const d = deps();
    expect(await runScanCardAttachment(d, ID)).toBe('clean');
    expect(d.markClean).toHaveBeenCalledTimes(1);
    const [target, sha, report] = vi.mocked(d.markClean).mock.calls[0]!;
    expect(target).toEqual({ id: ID, workspaceId: WS });
    expect(sha).toMatch(/^[0-9a-f]{64}$/);
    expect(sha).toBe(SHA);
    expect(report).toEqual({ engine: 'clamav' });
    expect(d.reject).not.toHaveBeenCalled();
  });

  it('rejects a virus as dirty with the detecting engines', async () => {
    const d = deps({
      scan: vi.fn(async () => ({
        verdict: 'dirty' as const,
        detectingEngines: ['Eicar-Test-Signature'],
      })),
    });
    expect(await runScanCardAttachment(d, ID)).toBe('dirty');
    expect(d.reject).toHaveBeenCalledWith({
      row: row(),
      status: 'dirty',
      reason: 'virus',
      sha256: SHA,
      engines: ['Eicar-Test-Signature'],
    });
    expect(d.markClean).not.toHaveBeenCalled();
  });

  it('rejects a type spoof (pdf declared, executable sniffed) before scanning', async () => {
    const d = deps({ sniff: vi.fn(async () => 'application/x-msdownload') });
    expect(await runScanCardAttachment(d, ID)).toBe('dirty');
    expect(d.reject).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'dirty', reason: 'type_spoof' }),
    );
    expect(d.scan).not.toHaveBeenCalled();
  });

  it('rejects when the stored size differs from the declared size', async () => {
    const d = deps({ loadAttachment: vi.fn(async () => row({ sizeBytes: 10 })) });
    expect(await runScanCardAttachment(d, ID)).toBe('dirty');
    expect(d.reject).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'dirty', reason: 'size_mismatch', sha256: null }),
    );
    expect(d.sniff).not.toHaveBeenCalled();
  });

  it('rejects an object larger than the 50 MB cap even if it matches the declared size', async () => {
    const big = Buffer.alloc(50 * 1024 * 1024 + 1);
    const d = deps({
      loadAttachment: vi.fn(async () => row({ sizeBytes: big.length })),
      stat: vi.fn(async () => ({
        ok: true as const,
        size: big.length,
        contentType: 'application/pdf',
      })),
    });
    expect(await runScanCardAttachment(d, ID)).toBe('dirty');
    expect(d.reject).toHaveBeenCalledWith(expect.objectContaining({ reason: 'size_mismatch' }));
    // Rejeté sur métadonnées : jamais 50 Mo+ téléchargés en mémoire.
    expect(d.download).not.toHaveBeenCalled();
  });

  it('still rejects when the downloaded bytes disagree with consistent metadata', async () => {
    const d = deps({
      download: vi.fn(async () => ({ ok: true as const, binary: Buffer.from('%PDF-short') })),
    });
    expect(await runScanCardAttachment(d, ID)).toBe('dirty');
    expect(d.reject).toHaveBeenCalledWith(expect.objectContaining({ reason: 'size_mismatch' }));
  });

  it('checks object metadata BEFORE downloading: stored size mismatch → dirty', async () => {
    const d = deps({
      stat: vi.fn(async () => ({ ok: true as const, size: 999, contentType: 'application/pdf' })),
    });
    expect(await runScanCardAttachment(d, ID)).toBe('dirty');
    expect(d.stat).toHaveBeenCalledWith(row().storagePath);
    expect(d.reject).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'dirty', reason: 'size_mismatch', sha256: null }),
    );
    expect(d.download).not.toHaveBeenCalled();
  });

  it('rejects a stored MIME different from the declared type (type_mismatch)', async () => {
    const d = deps({
      stat: vi.fn(async () => ({
        ok: true as const,
        size: PDF_BYTES.length,
        contentType: 'text/html',
      })),
    });
    expect(await runScanCardAttachment(d, ID)).toBe('dirty');
    expect(d.reject).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'dirty', reason: 'type_mismatch', sha256: null }),
    );
    expect(d.download).not.toHaveBeenCalled();
  });

  it('normalizes the stored MIME (case, parameters) before comparing', async () => {
    const d = deps({
      stat: vi.fn(async () => ({
        ok: true as const,
        size: PDF_BYTES.length,
        contentType: 'Application/PDF; charset=binary',
      })),
    });
    expect(await runScanCardAttachment(d, ID)).toBe('clean');
  });

  it.each([
    { size: undefined, contentType: 'application/pdf' },
    { size: PDF_BYTES.length, contentType: undefined },
  ])('treats missing object metadata as scan_failed (%o)', async (meta) => {
    const d = deps({ stat: vi.fn(async () => ({ ok: true as const, ...meta })) });
    expect(await runScanCardAttachment(d, ID)).toBe('scan_failed');
    expect(d.reject).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'scan_failed', reason: 'missing_metadata' }),
    );
    expect(d.download).not.toHaveBeenCalled();
  });

  it('marks scan_failed (missing_object) when the metadata lookup fails', async () => {
    const d = deps({ stat: vi.fn(async () => ({ ok: false as const, message: 'not found' })) });
    expect(await runScanCardAttachment(d, ID)).toBe('scan_failed');
    expect(d.reject).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'scan_failed', reason: 'missing_object' }),
    );
    expect(d.download).not.toHaveBeenCalled();
  });

  it('marks scan_failed when the object is missing from Storage', async () => {
    const d = deps({ download: vi.fn(async () => ({ ok: false as const, message: 'nope' })) });
    expect(await runScanCardAttachment(d, ID)).toBe('scan_failed');
    expect(d.reject).toHaveBeenCalledWith({
      row: row(),
      status: 'scan_failed',
      reason: 'missing_object',
      sha256: null,
      engines: [],
    });
  });

  it('marks scan_failed when the scanner is unavailable', async () => {
    const d = deps({ scan: vi.fn(async () => ({ verdict: 'scan_failed' as const })) });
    expect(await runScanCardAttachment(d, ID)).toBe('scan_failed');
    expect(d.reject).toHaveBeenCalledWith({
      row: row(),
      status: 'scan_failed',
      reason: 'scanner_error',
      sha256: SHA,
      engines: [],
    });
  });
});

describe('scanCardAttachment (Inngest wiring — pinned)', () => {
  it('is triggered by card-attachment/uploaded with bounded retries and concurrency', () => {
    expect(scanCardAttachment.id()).toBe('scan-card-attachment');
    expect(scanCardAttachment.opts.triggers).toEqual([{ event: 'card-attachment/uploaded' }]);
    expect(scanCardAttachment.opts.retries).toBe(2);
    expect(scanCardAttachment.opts.concurrency).toEqual({ limit: 5 });
  });
});
