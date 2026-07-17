'use server';
import 'server-only';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { requireUser } from '@/lib/auth';
import { checkMailSendRate } from '@/lib/rate-limit';
import { prisma, type Prisma } from '@nexushub/db';
import { sanitizeMailHtml, stripMailHtmlToText } from '@nexushub/integrations/mail';
import {
  sendViaGraph,
  GraphPayloadTooLargeError,
  GraphReplyAttachmentsUnsupportedError,
} from '@nexushub/integrations/graph';
import { getValidAccessToken } from '@/features/integrations/lib/get-valid-access-token';
import { downloadMailAttachment } from '@/lib/mail-attachment-storage';
import { sendViaImapSmtp } from './send-mail-imap';
import { attachmentDraftSchema, type AttachmentDraft } from './mail-drafts';

const inputSchema = z
  .object({
    fromIntegrationId: z.string().uuid(),
    mode: z.enum(['reply', 'reply_all', 'forward', 'new_mail']),
    replyToId: z.string().uuid().optional(),
    replyToExternalId: z.string().optional(),
    toRecipients: z.array(z.string().email()).min(1).max(20),
    ccRecipients: z.array(z.string().email()).max(20).default([]),
    bccRecipients: z.array(z.string().email()).max(20).default([]),
    subject: z.string().min(1).max(998),
    bodyHtml: z.string().min(1).max(500_000),
    // Attachments already uploaded + scanned clean at compose time (Task 12)
    // or reprised from a Forward source (Task 17) — see mail-drafts.ts.
    composeAttachments: z.array(attachmentDraftSchema).max(20).default([]),
  })
  .refine((v) => v.toRecipients.length + v.ccRecipients.length + v.bccRecipients.length <= 20, {
    message: 'Trop de destinataires (max 20 au total)',
    path: ['toRecipients'],
  });

// z.input (not z.infer) so fields carrying `.default()` — including
// `composeAttachments` — stay optional for callers, matching the convention
// established in mail-drafts.ts's SaveDraftInput. Existing call sites
// (compose-panel.tsx, retry-send-mail.ts) predate attachments and must keep
// compiling without passing composeAttachments explicitly.
export type SendMailInput = z.input<typeof inputSchema>;

export type SendMailResult =
  | { readonly ok: true; readonly emailMessageId: string }
  | {
      readonly ok: false;
      readonly code:
        | 'RATE_LIMIT'
        | 'TOO_MANY_RECIPIENTS'
        | 'INVALID_INPUT'
        | 'MAILBOX_NOT_FOUND'
        | 'SMTP_NOT_CONFIGURED'
        | 'ATTACHMENTS_NOT_READY'
        | 'SEND_FAILED_TOO_LARGE'
        | 'SEND_FAILED_UNSUPPORTED'
        | 'SEND_FAILED';
      readonly message?: string;
      readonly window?: 'hour' | 'day';
      readonly retryAfterMs?: number;
      readonly emailMessageId?: string;
    };

/**
 * Recipient-domain extraction — audit logs must never contain the full
 * addresses (PII per CLAUDE.md §4.7). We keep the domain portion only.
 */
function domainsOf(addrs: readonly string[]): readonly string[] {
  return Array.from(
    new Set(
      addrs.map((a) => a.split('@')[1]?.toLowerCase()).filter((s): s is string => Boolean(s)),
    ),
  );
}

/**
 * Sentinel error message thrown by `loadAttachmentBinaries` on a Storage
 * download failure — mapped to a generic, user-safe SEND_FAILED message in
 * the catch block below. The raw Storage/service-role error text is NEVER
 * bubbled to the client (CLAUDE.md §4.7).
 */
const ATTACHMENT_DOWNLOAD_FAILED = 'ATTACHMENT_DOWNLOAD_FAILED';

async function loadAttachmentBinaries(
  list: readonly AttachmentDraft[],
): Promise<{ filename: string; contentType: string; content: Buffer }[]> {
  const out: { filename: string; contentType: string; content: Buffer }[] = [];
  for (const a of list) {
    const dl = await downloadMailAttachment(a.storagePath);
    if (!dl.ok) throw new Error(ATTACHMENT_DOWNLOAD_FAILED);
    out.push({ filename: a.filename, contentType: a.contentType, content: dl.binary });
  }
  return out;
}

/**
 * Defensive re-verification of `composeAttachments` before send (CLAUDE.md
 * §4.5.4) — the UI should already prevent a send with non-clean attachments,
 * but the client is untrusted: `saveDraft` persists `composeAttachments`
 * JSONB verbatim (shape-checked by Zod only), so a compromised client could
 * submit a payload pointing at a foreign-workspace or not-yet-clean Storage
 * object.
 *
 * Two checks:
 *  1. `storagePath` must be scoped under this workspace's Storage prefix —
 *     refuses a crafted entry pointing at another workspace's object.
 *  2. Reprised (Forward) entries — the only compose-time entries backed by a
 *     real `EmailAttachment` row (via `reprisedFromAttachmentId`) — are
 *     re-checked against the CURRENT `scanStatus` in DB, since it can drift
 *     between reprise-time and send-time.
 *
 * NOTE: `AttachmentDraft` (mail-drafts.ts) does not carry a `scanStatus`
 * field. Fresh compose-time uploads (`uploadAttachment`, Task 12) only ever
 * produce an entry after a clean ClamAV scan and never persist a standalone
 * `EmailAttachment` row for it (see upload-attachment.ts header note) — so
 * there is no DB-side scanStatus to re-check for those; their "clean"
 * guarantee is structural (upload-time only).
 */
async function verifyAttachmentsReady(
  list: readonly AttachmentDraft[],
  workspaceId: string,
): Promise<boolean> {
  for (const a of list) {
    if (!a.storagePath.startsWith(`${workspaceId}/`)) return false;
    if (a.reprisedFromAttachmentId) {
      const source = await prisma.emailAttachment.findFirst({
        where: { id: a.reprisedFromAttachmentId, workspaceId, scanStatus: 'clean' },
        select: { id: true },
      });
      if (!source) return false;
    }
  }
  return true;
}

export async function sendMail(raw: SendMailInput): Promise<SendMailResult> {
  const ctx = await requireUser();

  // 1. Input validation
  let parsed: z.infer<typeof inputSchema>;
  try {
    parsed = inputSchema.parse(raw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('Trop de destinataires')) {
      return { ok: false, code: 'TOO_MANY_RECIPIENTS', message: 'Max 20 destinataires au total.' };
    }
    return { ok: false, code: 'INVALID_INPUT', message: msg };
  }

  // 2. Rate limit
  const rate = await checkMailSendRate(ctx.userId);
  if (!rate.success) {
    return {
      ok: false,
      code: 'RATE_LIMIT',
      window: rate.window ?? 'hour',
      retryAfterMs: Math.max(0, rate.reset - Date.now()),
    };
  }

  // 3. Load source integration (ownership check)
  const integration = await prisma.integration.findFirst({
    where: {
      id: parsed.fromIntegrationId,
      workspaceId: ctx.workspaceId,
      ownerUserId: ctx.userId,
      kind: { in: ['graph', 'imap'] },
      status: 'active',
    },
    select: {
      id: true,
      kind: true,
      externalAccountId: true,
      signatureHtml: true,
    },
  });
  if (!integration) return { ok: false, code: 'MAILBOX_NOT_FOUND' };

  // 3b. Attachments readiness — defensive, fail before any outbox write.
  if (parsed.composeAttachments.length > 0) {
    const ready = await verifyAttachmentsReady(parsed.composeAttachments, ctx.workspaceId);
    if (!ready) {
      return {
        ok: false,
        code: 'ATTACHMENTS_NOT_READY',
        message: "Une ou plusieurs pièces jointes ne sont pas prêtes à l'envoi.",
      };
    }
  }

  // 4. Sanitize body (double barrier — client already sanitizes)
  const bodyHtmlSanitized = sanitizeMailHtml(parsed.bodyHtml);
  const bodyText = stripMailHtmlToText(bodyHtmlSanitized);

  // 5. Outbox insert — From lock: fromEmail is the integration's own address.
  const outboxRow = await prisma.emailMessage.create({
    data: {
      workspaceId: ctx.workspaceId,
      integrationId: integration.id,
      externalId: `nx-outbox-${randomUUID()}`,
      folder: 'sent',
      subject: parsed.subject,
      fromEmail: integration.externalAccountId ?? '',
      fromName: null,
      toRecipients: [...parsed.toRecipients],
      ccRecipients: [...parsed.ccRecipients],
      bodyText,
      bodyHtmlSanitized,
      receivedAt: new Date(),
      isRead: true,
      sendStatus: 'queued',
      sentByUserId: ctx.userId,
      conversationId: null,
    },
    select: { id: true },
  });

  // 6. Flip to sending
  await prisma.emailMessage.update({
    where: { id: outboxRow.id },
    data: { sendStatus: 'sending' },
  });

  // 7. Dispatch by kind
  try {
    const attachments =
      parsed.composeAttachments.length > 0
        ? await loadAttachmentBinaries(parsed.composeAttachments)
        : [];

    if (integration.kind === 'graph') {
      const token = await getValidAccessToken(integration.id);
      const graphThreadingFields =
        parsed.replyToExternalId && parsed.mode !== 'new_mail'
          ? { inReplyToMessageId: parsed.replyToExternalId, mode: parsed.mode }
          : {};
      await sendViaGraph(token, {
        subject: parsed.subject,
        toRecipients: parsed.toRecipients,
        ccRecipients: parsed.ccRecipients,
        bccRecipients: parsed.bccRecipients,
        bodyHtmlSanitized,
        ...graphThreadingFields,
        ...(attachments.length > 0 ? { attachments } : {}),
      });
    } else {
      await sendViaImapSmtp({
        integrationId: integration.id,
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
        fromEmail: integration.externalAccountId ?? '',
        payload: {
          subject: parsed.subject,
          to: parsed.toRecipients,
          cc: parsed.ccRecipients,
          bcc: parsed.bccRecipients,
          bodyHtml: bodyHtmlSanitized,
          bodyText,
          ...(parsed.replyToId ? { replyToLocalId: parsed.replyToId } : {}),
          ...(attachments.length > 0 ? { attachments } : {}),
        },
      });
    }
  } catch (err) {
    let code: Extract<SendMailResult, { ok: false }>['code'];
    let message: string;
    if (err instanceof GraphPayloadTooLargeError) {
      code = 'SEND_FAILED_TOO_LARGE';
      message = 'Pièce(s) jointe(s) trop volumineuse(s) pour Exchange (max 3 Mo au total).';
    } else if (err instanceof GraphReplyAttachmentsUnsupportedError) {
      code = 'SEND_FAILED_UNSUPPORTED';
      message =
        'Les pièces jointes ne sont pas prises en charge en réponse/transfert via Exchange dans cette version — utilise le mode « Nouveau message ».';
    } else {
      const raw = err instanceof Error ? err.message : 'Send failed';
      if (raw === ATTACHMENT_DOWNLOAD_FAILED) {
        code = 'SEND_FAILED';
        message = "Échec de récupération d'une pièce jointe. Réessaie.";
      } else if (/SMTP_NOT_CONFIGURED/.test(raw)) {
        code = 'SMTP_NOT_CONFIGURED';
        message = raw;
      } else {
        code = 'SEND_FAILED';
        message = raw;
      }
    }
    await prisma.emailMessage.update({
      where: { id: outboxRow.id },
      data: { sendStatus: 'failed', sendError: message },
    });
    await prisma.auditLog.create({
      data: {
        workspaceId: ctx.workspaceId,
        actorId: ctx.userId,
        action: 'mail_send_failed',
        data: { integrationId: integration.id, code, toDomains: domainsOf(parsed.toRecipients) },
      },
    });
    return { ok: false, code, message, emailMessageId: outboxRow.id };
  }

  // 8. Success
  await prisma.emailMessage.update({
    where: { id: outboxRow.id },
    data: { sendStatus: 'sent' },
  });

  // 8b. Persist EmailAttachment rows for the sent message. The Storage
  // object is CLONED (same storagePath referenced by two DB rows, never
  // duplicated in Storage) — both for fresh compose uploads and for
  // reprised (Forward) entries, which additionally keep a JSONB breadcrumb
  // (`scanReport.reprisedFrom`) back to the source EmailAttachment id.
  // `EmailAttachment` has no first-class `reprisedFromAttachmentId` column
  // (V1.5 scope — see docs/superpowers/plans/2026-07-16-mail-attachments.md
  // Task 16 §"Actually the reprise handling…").
  if (parsed.composeAttachments.length > 0) {
    for (const a of parsed.composeAttachments) {
      await prisma.emailAttachment.create({
        data: {
          id: a.id,
          workspaceId: ctx.workspaceId,
          emailMessageId: outboxRow.id,
          filename: a.filename,
          contentType: a.contentType,
          sizeBytes: a.sizeBytes,
          sourceExternalId: a.id,
          contentId: null,
          isInline: false,
          storagePath: a.storagePath,
          scanStatus: 'clean',
          scanReport: {
            deduped: Boolean(a.reprisedFromAttachmentId),
            ...(a.reprisedFromAttachmentId ? { reprisedFrom: a.reprisedFromAttachmentId } : {}),
          } as unknown as Prisma.InputJsonValue,
          sha256: a.sha256,
        },
      });
    }
    await prisma.emailMessage.update({
      where: { id: outboxRow.id },
      data: { hasAttachments: true },
    });
  }

  await prisma.mailDraft.deleteMany({
    where: { workspaceId: ctx.workspaceId, userId: ctx.userId },
  });
  await prisma.auditLog.create({
    data: {
      workspaceId: ctx.workspaceId,
      actorId: ctx.userId,
      action: 'mail_sent',
      data: {
        integrationId: integration.id,
        toDomains: domainsOf(parsed.toRecipients),
        subjectLen: parsed.subject.length,
        attachmentCount: parsed.composeAttachments.length,
      },
    },
  });

  return { ok: true, emailMessageId: outboxRow.id };
}
