import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import ClamScan from 'clamscan';

export interface AntivirusScanResult {
  readonly clean: boolean;
  readonly verdict: 'clean' | 'dirty' | 'scan_failed';
  readonly stats: {
    readonly malicious: number;
    readonly suspicious: number;
    readonly harmless: number;
    readonly undetected: number;
  };
  readonly detectingEngines?: readonly string[];
  readonly analysisId: string;
}

export interface ClamAVConfig {
  readonly host: string;
  readonly port: number;
  /** TCP connect timeout in ms. Default 15s. */
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const EMPTY_STATS = { malicious: 0, suspicious: 0, harmless: 0, undetected: 0 } as const;

/**
 * Stream-scan a buffer through a remote ClamAV daemon (clamd) via TCP INSTREAM.
 * The Docker image `clamav/clamav` deployed on Fly.io exposes port 3310 for
 * INSTREAM. See docs/runbooks/mail-attachments.md for the infra deploy procedure.
 *
 * Contract:
 *  - clean:  isInfected=false  -> { clean:true,  verdict:'clean' }
 *  - dirty:  isInfected=true   -> { clean:false, verdict:'dirty', detectingEngines:['ClamAV: <name>'] }
 *  - failed: connection/scan throw -> { clean:false, verdict:'scan_failed' } (treated as dirty by callers)
 *
 * Never log the binary content. `analysisId` is a synthesized hash-prefix
 * only (no payload data) and is safe to log.
 */
export async function scanFileWithClamAV(
  binary: Buffer,
  config: ClamAVConfig,
): Promise<AntivirusScanResult> {
  const sha = createHash('sha256').update(binary).digest('hex').slice(0, 16);
  const analysisId = `clamav-${sha}-${Date.now()}`;

  try {
    const scanner = await new ClamScan().init({
      clamdscan: {
        host: config.host,
        port: config.port,
        timeout: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        localFallback: false, // never shell out to a local clamdscan binary
      },
      preference: 'clamdscan', // TCP only, not the clamscan CLI
      removeInfected: false, // rejection is handled at the DB/UI level
    });

    const stream = Readable.from([binary]);
    const result = await scanner.scanStream(stream);

    if (!result.isInfected) {
      return { clean: true, verdict: 'clean', stats: EMPTY_STATS, analysisId };
    }

    const viruses = result.viruses ?? [];
    return {
      clean: false,
      verdict: 'dirty',
      stats: { ...EMPTY_STATS, malicious: 1 },
      detectingEngines: viruses.map((name) => `ClamAV: ${name}`),
      analysisId,
    };
  } catch {
    return { clean: false, verdict: 'scan_failed', stats: EMPTY_STATS, analysisId };
  }
}
