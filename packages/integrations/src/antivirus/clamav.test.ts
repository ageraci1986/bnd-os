import { describe, expect, it, vi } from 'vitest';
import { scanFileWithClamAV } from './clamav';

vi.mock('clamscan', () => {
  return {
    default: class {
      init(_: unknown) {
        return this;
      }
      scanStream(_stream: unknown): Promise<{ isInfected: boolean; viruses: readonly string[] }> {
        return Promise.resolve({ isInfected: false, viruses: [] });
      }
    },
  };
});

describe('scanFileWithClamAV', () => {
  it('returns clean when the stream scan is not infected', async () => {
    const r = await scanFileWithClamAV(Buffer.from('hello'), { host: 'clamav', port: 3310 });
    expect(r.clean).toBe(true);
    expect(r.verdict).toBe('clean');
    expect(r.stats.malicious).toBe(0);
  });

  it('returns dirty when the stream scan is infected + reports virus name', async () => {
    const cs = await import('clamscan');
    (cs.default as unknown as { prototype: Record<string, unknown> }).prototype.scanStream =
      async () => ({
        isInfected: true,
        viruses: ['Eicar-Test-Signature'],
      });
    const r = await scanFileWithClamAV(Buffer.from('EICAR'), { host: 'clamav', port: 3310 });
    expect(r.clean).toBe(false);
    expect(r.verdict).toBe('dirty');
    expect(r.stats.malicious).toBe(1);
    expect(r.detectingEngines).toEqual(['ClamAV: Eicar-Test-Signature']);
  });

  it('returns scan_failed when init or scanStream throws (server unreachable)', async () => {
    const cs = await import('clamscan');
    (cs.default as unknown as { prototype: Record<string, unknown> }).prototype.init = async () => {
      throw new Error('ECONNREFUSED');
    };
    const r = await scanFileWithClamAV(Buffer.from('x'), { host: 'localhost', port: 3310 });
    expect(r.clean).toBe(false);
    expect(r.verdict).toBe('scan_failed');
  });
});
