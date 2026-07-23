'use server';
import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { getRateLimiter } from '@/lib/rate-limit';
import { getServerEnv } from '@/lib/env';
import { prisma } from '@nexushub/db';
import { scanFileWithClamAV } from '@nexushub/integrations/antivirus';
import { uploadMailAttachment } from '@/lib/mail-attachment-storage';
import { fileTypeFromBuffer } from 'file-type';

/**
 * uploadAttachment — compose-time attachment upload (Communications iter
 * V1.5, mail attachments). Security-critical: this is one of two actions
 * in the iteration that accept arbitrary binary content from the client
 * (the other is the inbound sync path, which is a different trust
 * boundary). See CLAUDE.md §4.5.4 and
 * docs/superpowers/specs/2026-07-16-mail-attachments-design.md §7.2/§9.
 *
 * NOTE on scanner: the plan (Task 12) originally targeted VirusTotal. Task 5
 * pivoted to a self-hosted ClamAV daemon (ToS issue with VirusTotal for this
 * use case) — see packages/integrations/src/antivirus/clamav.ts. Config is
 * read via `getServerEnv()` (CLAMAV_HOST/CLAMAV_PORT), never raw
 * `process.env`, per the project convention documented in .env.example.
 *
 * NOTE on persistence: this action does NOT create an `EmailAttachment` row.
 * That model requires a non-null `emailMessageId` (the FK) + `sourceExternalId`,
 * neither of which exist yet at compose time — the attachment isn't attached
 * to a real EmailMessage until the draft is sent. The dedup lookup below
 * queries *previously persisted* attachments (from received/sent mail) to
 * skip re-scanning content this workspace has already seen and cleared.
 * DB persistence of the row happens at send-time (later task).
 */

const MAX_SIZE_BYTES = 25 * 1024 * 1024;

/**
 * IANA-registered dual-registration MIME aliases. When the browser declares
 * one form and `file-type` sniffs the other, the guard treats them as
 * equivalent instead of rejecting the upload as a spoof. Each set groups
 * MIMEs that describe the same wire format.
 *
 * RTF is the trigger case: browsers (Chromium, WebKit) send `text/rtf` on
 * some paths while `file-type` returns `application/rtf` from the magic
 * bytes (`{\rtf`). Both are officially registered; refusing either is a
 * false positive that broke real user uploads.
 */
const MIME_ALIASES: readonly ReadonlySet<string>[] = [
  new Set(['application/rtf', 'text/rtf']),
  new Set(['application/xml', 'text/xml']),
  new Set(['application/javascript', 'text/javascript', 'application/x-javascript']),
  new Set(['application/yaml', 'text/yaml', 'application/x-yaml']),
  new Set(['image/vnd.microsoft.icon', 'image/x-icon']),
  new Set(['application/x-tar', 'application/tar']),
  new Set(['audio/mpeg', 'audio/mp3']),
];

function isMimeCompatible(a: string, b: string): boolean {
  if (a === b) return true;
  const na = a.toLowerCase();
  const nb = b.toLowerCase();
  if (na === nb) return true;
  for (const group of MIME_ALIASES) {
    if (group.has(na) && group.has(nb)) return true;
  }
  return false;
}

// Extension blacklist — cheap defense evaluated before any scan is spent.
// Base list from the design spec §9; `sh` and `dll` added per the ClamAV
// pivot's security requirements (shell scripts and Windows DLLs are common
// attack vectors not covered by the original VirusTotal-era list).
const BLACKLIST_EXTENSIONS = new Set([
  'exe',
  'msi',
  'bat',
  'cmd',
  'com',
  'scr',
  'js',
  'jar',
  'vbs',
  'ps1',
  'app',
  'dmg',
  'sh',
  'dll',
]);

export type UploadAttachmentResult =
  | {
      readonly ok: true;
      readonly id: string;
      readonly filename: string;
      readonly contentType: string;
      readonly sizeBytes: number;
      readonly sha256: string;
      readonly storagePath: string;
    }
  | {
      readonly ok: false;
      readonly code:
        | 'RATE_LIMIT'
        | 'TOO_LARGE'
        | 'BLACKLISTED_EXT'
        | 'TYPE_SPOOF'
        | 'DIRTY'
        | 'SCAN_FAILED'
        | 'UPLOAD_FAILED'
        | 'INVALID_INPUT';
      readonly message: string;
    };

function sanitizeFilename(raw: string): string {
  return (
    raw
      .normalize('NFC')
      // Strip control chars + null bytes + path separators (path traversal /
      // filename injection defense, CLAUDE.md §4.5.4).
      // eslint-disable-next-line no-control-regex -- intentional: that IS the point of this regex.
      .replace(/[\x00-\x1f/\\]/g, '')
      .trim()
      .slice(0, 255)
  );
}

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot === -1) return '';
  return filename.slice(dot + 1).toLowerCase();
}

/**
 * Defense-in-depth Zod validation of the *derived* filename/content-type
 * fields (post-sanitize). FormData/File itself isn't Zod-validatable, but
 * the extracted strings are — this catches anything sanitizeFilename()
 * leaves empty and rejects malformed content-type strings outright.
 */
const attachmentFieldsSchema = z.object({
  filename: z
    .string()
    .min(1)
    .max(255)
    // Rejects filenames containing control chars / null bytes / path separators.
    // eslint-disable-next-line no-control-regex -- intentional: that IS the point of this regex.
    .regex(/^[^\x00-\x1f/\\]+$/, 'Nom de fichier invalide.'),
  contentType: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[\w.+-]+\/[\w.+-]+$/, 'Type de contenu invalide.'),
});

export async function uploadAttachment(formData: FormData): Promise<UploadAttachmentResult> {
  const ctx = await requireUser();

  // 1. Rate limit — keyed on the JWT-derived userId, never client input.
  const rl = getRateLimiter('mail_attachment_upload');
  const rlRes = await rl.check(ctx.userId);
  if (!rlRes.success) {
    return { ok: false, code: 'RATE_LIMIT', message: "Trop d'uploads. Réessaie plus tard." };
  }

  // 2. Parse FormData
  const file = formData.get('file');
  if (!(file instanceof File)) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Fichier manquant.' };
  }

  const sanitizedFilename = sanitizeFilename(file.name || 'attachment.bin');
  const declaredContentType = file.type || 'application/octet-stream';
  const fieldsParsed = attachmentFieldsSchema.safeParse({
    filename: sanitizedFilename,
    contentType: declaredContentType,
  });
  if (!fieldsParsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Fichier invalide.' };
  }
  const { filename, contentType: declaredType } = fieldsParsed.data;

  // 3. Size cap — before any scan/storage work.
  if (file.size > MAX_SIZE_BYTES) {
    return { ok: false, code: 'TOO_LARGE', message: 'Fichier > 25 MB.' };
  }

  // 4. Extension blacklist (cheap, before scan — avoid burning ClamAV cycles
  // on obviously malicious extensions).
  if (BLACKLIST_EXTENSIONS.has(extensionOf(filename))) {
    await prisma.auditLog.create({
      data: {
        workspaceId: ctx.workspaceId,
        actorId: ctx.userId,
        action: 'attachment_rejected_upload',
        // Filename intentionally NOT logged here — matches the audit field
        // list in docs/superpowers/specs/2026-07-16-mail-attachments-design.md
        // §9 ({contentType, sizeBytes, reason}).
        data: { reason: 'ext_blacklist', contentType: declaredType, sizeBytes: file.size },
      },
    });
    return { ok: false, code: 'BLACKLISTED_EXT', message: 'Type de fichier bloqué.' };
  }

  const binary = Buffer.from(await file.arrayBuffer());
  const sha256 = createHash('sha256').update(binary).digest('hex');

  // 5. Dedup pre-check (workspace-scoped, clean-only). ctx.workspaceId is the
  // only source of the workspace scope — never derived from client input.
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
    const id = randomUUID();
    await prisma.auditLog.create({
      data: {
        workspaceId: ctx.workspaceId,
        actorId: ctx.userId,
        action: 'attachment_uploaded',
        // Filename NEVER logged in attachment_uploaded (spec §9).
        data: { contentType: declaredType, sizeBytes: file.size, sha256, deduped: true },
      },
    });
    return {
      ok: true,
      id,
      filename,
      contentType: declaredType,
      sizeBytes: file.size,
      sha256,
      storagePath: dedup.storagePath,
    };
  }

  // 6. Magic-byte content-type sniff — reject on active mismatch. Some
  // formats have no reliable magic bytes (plain text); only reject when the
  // sniffer confidently disagrees with the declared type. Known IANA-registered
  // aliases (RTF, XML, JS, YAML, ICO...) are treated as compatible — rejecting
  // them would block legitimate uploads whose browser-declared MIME just
  // happens to be the sibling registration.
  const sniffed = await fileTypeFromBuffer(binary);
  if (sniffed && !isMimeCompatible(sniffed.mime, declaredType)) {
    await prisma.auditLog.create({
      data: {
        workspaceId: ctx.workspaceId,
        actorId: ctx.userId,
        action: 'attachment_rejected_upload',
        data: {
          reason: 'type_spoof',
          declaredType,
          sniffedType: sniffed.mime,
          sizeBytes: file.size,
        },
      },
    });
    return { ok: false, code: 'TYPE_SPOOF', message: 'Type de fichier suspect (sniff mismatch).' };
  }

  // 7. ClamAV scan (sync). Fail closed if the daemon isn't configured —
  // never silently skip the scan.
  const env = getServerEnv();
  if (!env.CLAMAV_HOST) {
    return { ok: false, code: 'SCAN_FAILED', message: 'Antivirus non configuré.' };
  }
  const scan = await scanFileWithClamAV(binary, { host: env.CLAMAV_HOST, port: env.CLAMAV_PORT });
  // scan_failed (daemon unreachable / scan threw) is treated as dirty by
  // downstream consumers — never upload on an inconclusive scan.
  if (scan.verdict !== 'clean') {
    await prisma.auditLog.create({
      data: {
        workspaceId: ctx.workspaceId,
        actorId: ctx.userId,
        action: 'attachment_scanned_dirty',
        data: {
          filename, // investigation-only exception — spec §9 explicitly logs filename here
          contentType: declaredType,
          sha256,
          detectingEngines: scan.detectingEngines ?? [],
        },
      },
    });
    return {
      ok: false,
      code: scan.verdict === 'dirty' ? 'DIRTY' : 'SCAN_FAILED',
      message: "Fichier rejeté par l'antivirus.",
    };
  }

  // 8. Upload to Storage — only reached after a clean scan.
  const id = randomUUID();
  const uploadResult = await uploadMailAttachment({
    workspaceId: ctx.workspaceId,
    attachmentId: id,
    contentType: declaredType,
    binary,
  });
  if (!uploadResult.ok) {
    // SECURITY: never bubble the raw Storage/service-role error string to
    // the client (CLAUDE.md §4.7) — it can contain infra/bucket internals.
    return { ok: false, code: 'UPLOAD_FAILED', message: "Échec de l'upload. Réessaie." };
  }

  await prisma.auditLog.create({
    data: {
      workspaceId: ctx.workspaceId,
      actorId: ctx.userId,
      action: 'attachment_uploaded',
      data: { contentType: declaredType, sizeBytes: file.size, sha256 },
    },
  });

  return {
    ok: true,
    id,
    filename,
    contentType: declaredType,
    sizeBytes: file.size,
    sha256,
    storagePath: uploadResult.storagePath,
  };
}
