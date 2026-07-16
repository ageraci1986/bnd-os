'use server';
import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { getRateLimiter } from '@/lib/rate-limit';
import { getServerEnv } from '@/lib/env';
import { prisma, type Prisma } from '@nexushub/db';
import { scanFileWithClamAV } from '@nexushub/integrations/antivirus';
import { fetchImapAttachmentBinary, openImapSession } from '@nexushub/integrations/imap';
import { fetchGraphAttachmentBinary } from '@nexushub/integrations/graph';
import { getValidImapCredentials } from '@/features/integrations/lib/get-valid-imap-credentials';
import { getValidAccessToken } from '@/features/integrations/lib/get-valid-access-token';
import { uploadMailAttachment, getMailAttachmentSignedUrl } from '@/lib/mail-attachment-storage';
import { fileTypeFromBuffer } from 'file-type';

/**
 * fetchAttachmentBinary — lazy fetch of a received-mail attachment's binary
 * on user download demand (Communications iter V1.5, mail attachments).
 * Security-critical (CLAUDE.md §4.5.4): pulls attacker-controlled bytes from
 * an external mail server (IMAP/Graph) on demand, scans them, and only then
 * persists to Storage / hands back a signed URL. See
 * docs/superpowers/specs/2026-07-16-mail-attachments-design.md §6.2 and
 * docs/superpowers/plans/2026-07-16-mail-attachments.md Task 14.
 *
 * NOTE on scanner: same ClamAV pivot as Task 12's uploadAttachment — the
 * design spec and the plan's Task 14 draft target VirusTotal
 * (`scanFileWithVirusTotal(binary, apiKey)`); Task 5 shipped a self-hosted
 * ClamAV daemon instead (ToS issue with VirusTotal for this use case) — see
 * packages/integrations/src/antivirus/clamav.ts. Config is read via
 * `getServerEnv()` (CLAMAV_HOST/CLAMAV_PORT), never raw `process.env`.
 *
 * NOTE on ownership: double-checked per CLAUDE.md §4.4 — `workspaceId` scopes
 * the row to the caller's workspace, AND `emailMessage.integration.ownerUserId`
 * must equal the caller's userId. Mail integrations (IMAP/Graph) are bound to
 * a single user's mailbox (PRD §10 hypothesis #8: Exchange/IMAP are
 * delegated, each user connects their own box) — a workspace member must
 * never be able to pull another member's inbox attachment even within the
 * same workspace. Mirrors the pattern in fetch-mail-body.ts.
 *
 * NOTE on error messages: Storage/service-role errors are NEVER bubbled to
 * the client verbatim (CLAUDE.md §4.7, same convention as uploadAttachment) —
 * generic messages are returned instead. IMAP/Graph connection errors ARE
 * surfaced (same convention as fetch-mail-body.ts) since those adapters throw
 * connection-shaped errors, never credentials.
 */

const inputSchema = z.object({ attachmentId: z.string().uuid() });

const SIGNED_URL_TTL_MS = 300_000;

export type FetchAttachmentResult =
  | {
      readonly ok: true;
      readonly signedUrl: string;
      readonly expiresAt: number;
      readonly filename: string;
    }
  | {
      readonly ok: false;
      readonly code: 'NOT_FOUND' | 'DIRTY' | 'SCAN_FAILED' | 'FETCH_FAILED' | 'RATE_LIMIT';
      readonly message: string;
    };

interface AuthCtx {
  readonly userId: string;
  readonly workspaceId: string;
}

interface AttachmentForAudit {
  readonly id: string;
  readonly emailMessage: { readonly integration: { readonly id: string } };
}

/** Audit `attachment_downloaded` — PII-safe (no filename), fired on every success path. */
async function auditDownloaded(ctx: AuthCtx, att: AttachmentForAudit): Promise<void> {
  await prisma.auditLog.create({
    data: {
      workspaceId: ctx.workspaceId,
      actorId: ctx.userId,
      action: 'attachment_downloaded',
      data: { attachmentId: att.id, integrationId: att.emailMessage.integration.id },
    },
  });
}

export async function fetchAttachmentBinary(
  raw: z.infer<typeof inputSchema>,
): Promise<FetchAttachmentResult> {
  const ctx = await requireUser();
  const parsed = inputSchema.parse(raw);

  // 1. Rate limit — keyed on the JWT-derived userId, never client input.
  const rl = getRateLimiter('mail_attachment_download');
  const rlRes = await rl.check(ctx.userId);
  if (!rlRes.success) {
    return {
      ok: false,
      code: 'RATE_LIMIT',
      message: 'Trop de téléchargements. Réessaie plus tard.',
    };
  }

  // 2. Load with DOUBLE ownership check: workspace scope AND mailbox-owner
  // scope. A workspace member must not be able to fetch another member's
  // inbox attachment — mail integrations are per-user, not per-workspace.
  const att = await prisma.emailAttachment.findFirst({
    where: {
      id: parsed.attachmentId,
      workspaceId: ctx.workspaceId,
      emailMessage: {
        integration: {
          workspaceId: ctx.workspaceId,
          ownerUserId: ctx.userId,
        },
      },
    },
    select: {
      id: true,
      filename: true,
      contentType: true,
      sizeBytes: true,
      sourceExternalId: true,
      storagePath: true,
      scanStatus: true,
      emailMessage: {
        select: {
          externalId: true,
          integration: { select: { id: true, kind: true } },
        },
      },
    },
  });
  if (!att) return { ok: false, code: 'NOT_FOUND', message: 'Pièce jointe introuvable.' };

  // 3. Cached + clean → immediate signed URL, no re-fetch / re-scan.
  if (att.storagePath && att.scanStatus === 'clean') {
    const s = await getMailAttachmentSignedUrl(att.storagePath);
    if (!s.ok) {
      return { ok: false, code: 'FETCH_FAILED', message: 'Échec de signature. Réessaie.' };
    }
    await auditDownloaded(ctx, att);
    return {
      ok: true,
      signedUrl: s.signedUrl,
      expiresAt: Date.now() + SIGNED_URL_TTL_MS,
      filename: att.filename,
    };
  }

  // 4. Cached dirty / scan_failed → refuse, fail-closed. Never re-fetch a
  // binary that already failed the scan.
  if (att.scanStatus === 'dirty' || att.scanStatus === 'scan_failed') {
    return {
      ok: false,
      code: 'DIRTY',
      message: 'Cette pièce jointe a été rejetée par le scan antivirus.',
    };
  }

  // 5. Lazy fetch from source.
  let binary: Buffer | null = null;
  try {
    if (att.emailMessage.integration.kind === 'graph') {
      const token = await getValidAccessToken(att.emailMessage.integration.id);
      binary = await fetchGraphAttachmentBinary(
        token,
        att.emailMessage.externalId,
        att.sourceExternalId,
      );
    } else {
      const { imap: creds } = await getValidImapCredentials({
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
        integrationId: att.emailMessage.integration.id,
      });
      const uid = Number(att.emailMessage.externalId);
      const session = await openImapSession(creds);
      try {
        await session.mailboxOpen('INBOX');
        binary = await fetchImapAttachmentBinary(session, uid, att.sourceExternalId);
      } finally {
        try {
          await session.logout();
        } catch {
          /* swallow */
        }
      }
    }
  } catch (err) {
    return {
      ok: false,
      code: 'FETCH_FAILED',
      message: err instanceof Error ? err.message : 'Récupération échouée.',
    };
  }

  if (!binary) {
    return { ok: false, code: 'FETCH_FAILED', message: 'Binaire indisponible côté serveur.' };
  }

  // 6. Size mismatch check — mail-spoof detection against declared metadata.
  if (binary.byteLength !== att.sizeBytes) {
    await prisma.auditLog.create({
      data: {
        workspaceId: ctx.workspaceId,
        actorId: ctx.userId,
        action: 'attachment_rejected_upload',
        data: { reason: 'size_mismatch', declared: att.sizeBytes, actual: binary.byteLength },
      },
    });
    return {
      ok: false,
      code: 'FETCH_FAILED',
      message: 'Taille du fichier ne correspond pas à la déclaration.',
    };
  }

  const sha256 = createHash('sha256').update(binary).digest('hex');

  // 7. Dedup — same binary already clean elsewhere in the workspace? Skip
  // ClamAV and clone the existing Storage object reference.
  const dedup = await prisma.emailAttachment.findFirst({
    where: {
      workspaceId: ctx.workspaceId,
      sha256,
      scanStatus: 'clean',
      storagePath: { not: null },
    },
    select: { storagePath: true, scanReport: true },
  });
  if (dedup && dedup.storagePath) {
    await prisma.emailAttachment.update({
      where: { id: att.id },
      data: {
        storagePath: dedup.storagePath,
        scanStatus: 'clean',
        scanReport: dedup.scanReport as unknown as Prisma.InputJsonValue,
        sha256,
      },
    });
    const s = await getMailAttachmentSignedUrl(dedup.storagePath);
    if (!s.ok) {
      return { ok: false, code: 'FETCH_FAILED', message: 'Échec de signature. Réessaie.' };
    }
    await auditDownloaded(ctx, att);
    return {
      ok: true,
      signedUrl: s.signedUrl,
      expiresAt: Date.now() + SIGNED_URL_TTL_MS,
      filename: att.filename,
    };
  }

  // 8. Magic-byte sniff — reject on active mismatch with declared content-type.
  const sniffed = await fileTypeFromBuffer(binary);
  if (sniffed && sniffed.mime !== att.contentType) {
    await prisma.emailAttachment.update({
      where: { id: att.id },
      data: {
        scanStatus: 'dirty',
        scanReport: {
          reason: 'type_spoof',
          declaredType: att.contentType,
          sniffedType: sniffed.mime,
        },
      },
    });
    await prisma.auditLog.create({
      data: {
        workspaceId: ctx.workspaceId,
        actorId: ctx.userId,
        action: 'attachment_rejected_upload',
        data: { reason: 'type_spoof', declaredType: att.contentType, sniffedType: sniffed.mime },
      },
    });
    return { ok: false, code: 'DIRTY', message: 'Type de fichier suspect (sniff mismatch).' };
  }

  // 9. ClamAV scan (sync). Fail closed if the daemon isn't configured — never
  // silently skip the scan.
  const env = getServerEnv();
  if (!env.CLAMAV_HOST) {
    return { ok: false, code: 'SCAN_FAILED', message: 'Antivirus non configuré.' };
  }
  const scan = await scanFileWithClamAV(binary, { host: env.CLAMAV_HOST, port: env.CLAMAV_PORT });
  // scan_failed (daemon unreachable / scan threw) is treated as dirty —
  // never upload on an inconclusive scan.
  if (scan.verdict !== 'clean') {
    await prisma.emailAttachment.update({
      where: { id: att.id },
      data: {
        scanStatus: scan.verdict === 'dirty' ? 'dirty' : 'scan_failed',
        scanReport: {
          analysisId: scan.analysisId,
          stats: scan.stats,
          detectingEngines: scan.detectingEngines ?? [],
        },
        sha256,
      },
    });
    await prisma.auditLog.create({
      data: {
        workspaceId: ctx.workspaceId,
        actorId: ctx.userId,
        action: 'attachment_scanned_dirty',
        data: {
          filename: att.filename, // investigation-only exception — spec §9
          contentType: att.contentType,
          sha256,
          detectingEngines: scan.detectingEngines ?? [],
        },
      },
    });
    return {
      ok: false,
      code: 'DIRTY',
      message: 'Cette pièce jointe a été rejetée par le scan antivirus.',
    };
  }

  // 10. Upload to Storage — only reached after a clean scan.
  const uploadResult = await uploadMailAttachment({
    workspaceId: ctx.workspaceId,
    attachmentId: att.id,
    contentType: att.contentType,
    binary,
  });
  if (!uploadResult.ok) {
    // SECURITY: never bubble the raw Storage/service-role error string to
    // the client (CLAUDE.md §4.7) — it can contain infra/bucket internals.
    return { ok: false, code: 'FETCH_FAILED', message: "Échec de l'upload. Réessaie." };
  }

  await prisma.emailAttachment.update({
    where: { id: att.id },
    data: {
      storagePath: uploadResult.storagePath,
      scanStatus: 'clean',
      scanReport: { analysisId: scan.analysisId, stats: scan.stats },
      sha256,
    },
  });

  await auditDownloaded(ctx, att);

  const s = await getMailAttachmentSignedUrl(uploadResult.storagePath);
  if (!s.ok) {
    return { ok: false, code: 'FETCH_FAILED', message: 'Échec de signature. Réessaie.' };
  }
  return {
    ok: true,
    signedUrl: s.signedUrl,
    expiresAt: Date.now() + SIGNED_URL_TTL_MS,
    filename: att.filename,
  };
}
