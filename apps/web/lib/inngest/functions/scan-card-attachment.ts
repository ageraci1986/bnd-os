import 'server-only';
import { createHash } from 'node:crypto';
import { fileTypeFromBuffer } from 'file-type';
import { z } from 'zod';
import { prisma } from '@nexushub/db';
import { CARD_ATTACHMENT_MAX_BYTES, isSniffCompatible } from '@nexushub/domain';
import { scanFileWithClamAV } from '@nexushub/integrations/antivirus';
import { downloadCardAttachment, removeCardAttachment } from '@/lib/card-attachment-storage';
import { getServerEnv } from '@/lib/env';
import { inngestClient } from '../client';

/**
 * Scan asynchrone d'une pièce jointe de carte (lot C, spec §3.4).
 *
 * Déclenché par `card-attachment/uploaded` (émis par `finalizeCardAttachment`
 * après l'upload direct navigateur → Storage). Contrôles, dans l'ordre :
 * objet présent → taille réelle = taille déclarée et ≤ 50 Mo → magic bytes
 * compatibles avec le type déclaré → ClamAV. Tant que la ligne n'est pas
 * `clean`, aucune URL de lecture n'est délivrée (`getCardAttachmentUrl`).
 * Tout rejet SUPPRIME l'objet Storage et trace `card_attachment_rejected`.
 *
 * Fail-closed : ClamAV non configuré / injoignable → `scan_failed` (jamais
 * `clean` par défaut).
 *
 * PATTERN (comme `blocked-cards-scan.ts`) : `runScanCardAttachment` est un
 * cœur pur testé avec des fakes ; l'export Inngest n'est qu'un fil.
 *
 * PINNED (voir `scan-card-attachment-imports.test.ts`) : aucun import de
 * `@nexushub/agent` ni provider/registry.
 */

export type ScanStatus = 'pending' | 'clean' | 'dirty' | 'scan_failed';

export interface ScanRow {
  readonly id: string;
  readonly workspaceId: string;
  /** Uniquement pour l'audit `virus` (exception d'investigation, comme les mails). */
  readonly filename: string;
  readonly storagePath: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly scanStatus: ScanStatus;
}

export type RejectReason =
  | 'missing_object'
  | 'size_mismatch'
  | 'type_spoof'
  | 'virus'
  | 'scanner_error';

export interface RejectInput {
  readonly row: ScanRow;
  readonly status: 'dirty' | 'scan_failed';
  readonly reason: RejectReason;
  readonly sha256: string | null;
  readonly engines: readonly string[];
}

export interface ScanDeps {
  readonly loadAttachment: (id: string) => Promise<ScanRow | null>;
  readonly download: (
    path: string,
  ) => Promise<{ ok: true; binary: Buffer } | { ok: false; message: string }>;
  /** `fileTypeFromBuffer(b)?.mime` en prod ; `undefined` si non détectable. */
  readonly sniff: (binary: Buffer) => Promise<string | undefined>;
  readonly scan: (binary: Buffer) => Promise<{
    verdict: 'clean' | 'dirty' | 'scan_failed';
    detectingEngines?: readonly string[];
  }>;
  readonly markClean: (
    target: { readonly id: string; readonly workspaceId: string },
    sha256: string,
    report: Record<string, string>,
  ) => Promise<void>;
  readonly reject: (input: RejectInput) => Promise<void>;
}

export type ScanOutcome = 'skipped' | 'clean' | 'dirty' | 'scan_failed';

const IdSchema = z.string().uuid();

export async function runScanCardAttachment(
  deps: ScanDeps,
  attachmentId: string,
): Promise<ScanOutcome> {
  if (!IdSchema.safeParse(attachmentId).success) return 'skipped';
  const row = await deps.loadAttachment(attachmentId);
  // Absent (supprimé entre-temps) ou déjà traité (événement re-livré) → no-op.
  if (!row || row.scanStatus !== 'pending') return 'skipped';

  const downloaded = await deps.download(row.storagePath);
  if (!downloaded.ok) {
    await deps.reject({
      row,
      status: 'scan_failed',
      reason: 'missing_object',
      sha256: null,
      engines: [],
    });
    return 'scan_failed';
  }
  const { binary } = downloaded;

  if (binary.length !== row.sizeBytes || binary.length > CARD_ATTACHMENT_MAX_BYTES) {
    await deps.reject({ row, status: 'dirty', reason: 'size_mismatch', sha256: null, engines: [] });
    return 'dirty';
  }

  if (!isSniffCompatible(row.contentType, await deps.sniff(binary))) {
    await deps.reject({ row, status: 'dirty', reason: 'type_spoof', sha256: null, engines: [] });
    return 'dirty';
  }

  const sha256 = createHash('sha256').update(binary).digest('hex');
  const result = await deps.scan(binary);
  if (result.verdict === 'clean') {
    await deps.markClean({ id: row.id, workspaceId: row.workspaceId }, sha256, {
      engine: 'clamav',
    });
    return 'clean';
  }
  if (result.verdict === 'dirty') {
    await deps.reject({
      row,
      status: 'dirty',
      reason: 'virus',
      sha256,
      engines: result.detectingEngines ?? [],
    });
    return 'dirty';
  }
  await deps.reject({ row, status: 'scan_failed', reason: 'scanner_error', sha256, engines: [] });
  return 'scan_failed';
}

// ---------- Implémentations prod ----------------------------------------

/**
 * Système (pas de session) : l'id vient de notre propre événement signé
 * Inngest, validé UUID par le cœur. Les écritures ci-dessous re-scopent par
 * `workspaceId` de la ligne chargée.
 */
async function loadAttachment(id: string): Promise<ScanRow | null> {
  return prisma.cardAttachment.findFirst({
    where: { id },
    select: {
      id: true,
      workspaceId: true,
      filename: true,
      storagePath: true,
      contentType: true,
      sizeBytes: true,
      scanStatus: true,
    },
  });
}

async function sniff(binary: Buffer): Promise<string | undefined> {
  return (await fileTypeFromBuffer(binary))?.mime;
}

async function scan(binary: Buffer): Promise<{
  verdict: 'clean' | 'dirty' | 'scan_failed';
  detectingEngines?: readonly string[];
}> {
  const env = getServerEnv();
  // Fail-closed : jamais de `clean` sans scan effectif.
  if (!env.CLAMAV_HOST) return { verdict: 'scan_failed' };
  try {
    const res = await scanFileWithClamAV(binary, { host: env.CLAMAV_HOST, port: env.CLAMAV_PORT });
    return res.detectingEngines
      ? { verdict: res.verdict, detectingEngines: res.detectingEngines }
      : { verdict: res.verdict };
  } catch {
    return { verdict: 'scan_failed' };
  }
}

async function markClean(
  target: { readonly id: string; readonly workspaceId: string },
  sha256: string,
  report: Record<string, string>,
): Promise<void> {
  // Condition `pending` : une suppression/rejet concurrent n'est pas écrasé.
  await prisma.cardAttachment.updateMany({
    where: { id: target.id, workspaceId: target.workspaceId, scanStatus: 'pending' },
    data: { scanStatus: 'clean', sha256, scanReport: report },
  });
}

async function reject({ row, status, reason, sha256, engines }: RejectInput): Promise<void> {
  await removeCardAttachment(row.storagePath);
  await prisma.cardAttachment.updateMany({
    where: { id: row.id, workspaceId: row.workspaceId },
    data: { scanStatus: status, sha256, scanReport: { reason } },
  });
  await prisma.auditLog.create({
    data: {
      action: 'card_attachment_rejected',
      workspaceId: row.workspaceId,
      subjectType: 'card_attachment',
      subjectId: row.id,
      data: {
        reason,
        contentType: row.contentType,
        sizeBytes: row.sizeBytes,
        sha256,
        detectingEngines: [...engines],
        // Exception d'investigation documentée (spec §3.4, identique aux
        // mails `attachment_scanned_dirty`) : nom de fichier UNIQUEMENT pour
        // un virus détecté. Jamais pour les autres raisons.
        ...(reason === 'virus' ? { filename: row.filename } : {}),
      },
    },
  });
}

const prodDeps: ScanDeps = {
  loadAttachment,
  download: downloadCardAttachment,
  sniff,
  scan,
  markClean,
  reject,
};

export const scanCardAttachment = inngestClient.createFunction(
  {
    id: 'scan-card-attachment',
    retries: 2,
    concurrency: { limit: 5 },
    triggers: [{ event: 'card-attachment/uploaded' }],
  },
  async ({ event, step }) => {
    const attachmentId = String((event.data as { attachmentId?: unknown }).attachmentId ?? '');
    const outcome = await step.run('scan', () => runScanCardAttachment(prodDeps, attachmentId));
    // Issue seulement — jamais de nom de fichier ni d'identité (§4.7).
    console.warn('[inngest] scan-card-attachment', { outcome });
    return { outcome };
  },
);
