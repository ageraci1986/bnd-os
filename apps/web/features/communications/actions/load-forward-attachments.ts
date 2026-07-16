'use server';
import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { getRateLimiter } from '@/lib/rate-limit';
import { prisma, type Prisma } from '@nexushub/db';
import { fetchAttachmentBinary, type FetchAttachmentResult } from './fetch-attachment';
import { attachmentDraftSchema, type AttachmentDraft } from './mail-drafts';

/**
 * loadForwardAttachments — Communications iter V1.5 (mail attachments),
 * Task 17. Auto-triggered by ComposePanel (Task 19) when the user hits
 * Forward on a received mail: reprises every non-inline attachment of the
 * source EmailMessage into the caller's in-progress MailDraft as
 * AttachmentDraft entries carrying `reprisedFromAttachmentId`.
 *
 * See docs/superpowers/specs/2026-07-16-mail-attachments-design.md §8.1 and
 * docs/superpowers/plans/2026-07-16-mail-attachments.md Task 17.
 *
 * ADAPTATIONS vs the plan's Task 17 draft (adaptation authority granted for
 * this task — see prior task precedents this follows):
 *
 * - Input is `{ emailMessageId, draftId }` (not just `replyToId`), and the
 *   action performs the draft merge + persist itself rather than returning a
 *   bare attachment list for the client to merge back in. This lets the
 *   server own the 20-attachment cap arithmetic against the CURRENT draft
 *   row (never a possibly-stale client copy) and lets it emit per-item skip
 *   reasons for a UI toast, in one round trip.
 * - Draft write reuses the direct `prisma.mailDraft.update({ data:
 *   { composeAttachments } })` pattern established by
 *   `removeAttachmentFromDraft` (Task 13) — NOT a full `saveDraft` upsert.
 *   `saveDraft` upserts the entire draft row (recipients, subject, body,
 *   kind...); routing a pure attachment-merge through it would require
 *   reloading and replaying every unrelated field for no benefit.
 *   `removeAttachmentFromDraft` already set this precedent for the same
 *   Task 13 `composeAttachments` JSONB column, for the same reason.
 * - Ownership is double-scoped on `workspaceId` + mailbox-owner (never
 *   client input) exactly like `fetch-attachment.ts`. The draft lookup
 *   mirrors `removeAttachmentFromDraft`: scoped to (workspaceId, userId) —
 *   MailDraft has a unique constraint on that pair (one draft per user) — and
 *   the caller-supplied `draftId` is checked for equality against that row
 *   rather than used as the primary lookup key, so a spoofed draftId from a
 *   different workspace/user can never be targeted.
 * - Skip reasons: `'DIRTY' | 'SCAN_FAILED' | 'FETCH_FAILED' | 'CAP_REACHED' |
 *   'RATE_LIMIT'`, returned per attachment instead of being silently dropped,
 *   so the UI can toast e.g. "3 pièces jointes ignorées (antivirus)".
 * - Rate limiting / "one reprise = one download": `fetchAttachmentBinary`
 *   already rate-limits + audits `attachment_downloaded` for the lazy-fetch
 *   path (Task 14, defense in depth). For an ALREADY-CACHED attachment this
 *   action never calls `fetchAttachmentBinary` (that would spend a needless
 *   extra rate-limit token and, worse, would silently no-op since a cache
 *   hit doesn't refresh a missing `sha256`) — instead it performs its OWN
 *   single `mail_attachment_download` check + its own `attachment_downloaded`
 *   audit for that path. Either way, exactly one rate-limit check and one
 *   audit event fire per successfully reprised attachment — never both.
 */

const inputSchema = z.object({
  emailMessageId: z.string().uuid(),
  draftId: z.string().uuid(),
});

export type LoadForwardAttachmentsInput = z.infer<typeof inputSchema>;

export type ForwardAttachmentSkipReason =
  | 'DIRTY'
  | 'SCAN_FAILED'
  | 'FETCH_FAILED'
  | 'CAP_REACHED'
  | 'RATE_LIMIT';

export interface ForwardAttachmentSkip {
  readonly filename: string;
  readonly reason: ForwardAttachmentSkipReason;
}

export type LoadForwardAttachmentsResult =
  | {
      readonly ok: true;
      readonly added: readonly AttachmentDraft[];
      readonly skipped: readonly ForwardAttachmentSkip[];
    }
  | { readonly ok: false; readonly message: string };

const MAX_DRAFT_ATTACHMENTS = 20;

/** Maps fetchAttachmentBinary's refusal codes onto our skip-reason vocabulary. */
function mapFetchFailure(
  code: Exclude<FetchAttachmentResult, { ok: true }>['code'],
): ForwardAttachmentSkipReason {
  switch (code) {
    case 'DIRTY':
      return 'DIRTY';
    case 'SCAN_FAILED':
      return 'SCAN_FAILED';
    case 'RATE_LIMIT':
      return 'RATE_LIMIT';
    case 'NOT_FOUND':
    case 'FETCH_FAILED':
      return 'FETCH_FAILED';
  }
}

export async function loadForwardAttachments(
  raw: LoadForwardAttachmentsInput,
): Promise<LoadForwardAttachmentsResult> {
  const ctx = await requireUser();
  const parsed = inputSchema.parse(raw);

  // Ownership double-check (CLAUDE.md §4.4): workspace scope AND
  // mailbox-owner scope. Mirrors fetch-attachment.ts — a workspace member
  // must never be able to reprise another member's inbox attachment, even
  // within the same workspace (mail integrations are per-user, not
  // per-workspace — PRD §10 hypothesis #8).
  const message = await prisma.emailMessage.findFirst({
    where: {
      id: parsed.emailMessageId,
      workspaceId: ctx.workspaceId,
      integration: { workspaceId: ctx.workspaceId, ownerUserId: ctx.userId },
    },
    select: {
      integrationId: true,
      emailAttachments: {
        where: { isInline: false }, // inline images stay embedded in quoted HTML
        select: {
          id: true,
          filename: true,
          contentType: true,
          sizeBytes: true,
          storagePath: true,
          sha256: true,
          scanStatus: true,
        },
      },
    },
  });
  if (!message) return { ok: false, message: 'Mail introuvable.' };

  // Draft ownership: scoped to (workspaceId, userId) from ctx — never trust
  // draftId alone. MailDraft has a unique (workspaceId, userId) constraint
  // (one draft per user), so the caller-supplied draftId is checked for
  // equality against that row rather than used as the lookup key.
  const draft = await prisma.mailDraft.findFirst({
    where: { workspaceId: ctx.workspaceId, userId: ctx.userId },
    select: { id: true, composeAttachments: true },
  });
  if (!draft || draft.id !== parsed.draftId) {
    return { ok: false, message: 'Brouillon introuvable.' };
  }

  const existingParsed = z.array(attachmentDraftSchema).safeParse(draft.composeAttachments);
  const existing = existingParsed.success ? existingParsed.data : [];

  const added: AttachmentDraft[] = [];
  const skipped: ForwardAttachmentSkip[] = [];
  let availableSlots = Math.max(0, MAX_DRAFT_ATTACHMENTS - existing.length);

  for (const att of message.emailAttachments) {
    // Dirty / scan_failed never re-attach, regardless of cap — never spend a
    // cap slot's "seat" reporting the wrong reason for a rejected file.
    if (att.scanStatus === 'dirty') {
      skipped.push({ filename: att.filename, reason: 'DIRTY' });
      continue;
    }
    if (att.scanStatus === 'scan_failed') {
      skipped.push({ filename: att.filename, reason: 'SCAN_FAILED' });
      continue;
    }

    if (availableSlots <= 0) {
      skipped.push({ filename: att.filename, reason: 'CAP_REACHED' });
      continue;
    }

    if (att.storagePath && att.scanStatus === 'clean' && att.sha256) {
      // Already cached — no need to round-trip IMAP/Graph. Still counts as a
      // download for rate-limiting + audit purposes (see header note).
      const rl = await getRateLimiter('mail_attachment_download').check(ctx.userId);
      if (!rl.success) {
        skipped.push({ filename: att.filename, reason: 'RATE_LIMIT' });
        continue;
      }
      added.push({
        id: randomUUID(),
        filename: att.filename,
        contentType: att.contentType,
        sizeBytes: att.sizeBytes,
        storagePath: att.storagePath,
        sha256: att.sha256,
        reprisedFromAttachmentId: att.id,
      });
      availableSlots -= 1;
      await prisma.auditLog.create({
        data: {
          workspaceId: ctx.workspaceId,
          actorId: ctx.userId,
          action: 'attachment_downloaded',
          data: { attachmentId: att.id, integrationId: message.integrationId },
        },
      });
      continue;
    }

    // Not cached (storagePath null) or scan still pending — hydrate via the
    // lazy-fetch action (Task 14). It performs its own rate-limit check,
    // ownership double-check, and `attachment_downloaded` audit (defense in
    // depth), and updates the EmailAttachment row in place on success.
    const fetched = await fetchAttachmentBinary({ attachmentId: att.id });
    if (!fetched.ok) {
      skipped.push({ filename: att.filename, reason: mapFetchFailure(fetched.code) });
      continue;
    }

    // Re-load the row post-fetch for the fresh storagePath + sha256 —
    // fetchAttachmentBinary only returns a signed URL, never these fields.
    const fresh = await prisma.emailAttachment.findFirst({
      where: { id: att.id },
      select: { storagePath: true, sha256: true },
    });
    if (!fresh?.storagePath || !fresh.sha256) {
      skipped.push({ filename: att.filename, reason: 'FETCH_FAILED' });
      continue;
    }
    added.push({
      id: randomUUID(),
      filename: att.filename,
      contentType: att.contentType,
      sizeBytes: att.sizeBytes,
      storagePath: fresh.storagePath,
      sha256: fresh.sha256,
      reprisedFromAttachmentId: att.id,
    });
    availableSlots -= 1;
  }

  if (added.length > 0) {
    await prisma.mailDraft.update({
      where: { id: draft.id },
      data: {
        composeAttachments: [...existing, ...added] as unknown as Prisma.InputJsonValue,
      },
    });
  }

  return { ok: true, added, skipped };
}
