'use server';
import 'server-only';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { prisma, type Prisma } from '@nexushub/db';
import { deleteMailAttachment } from '@/lib/mail-attachment-storage';
import { attachmentDraftSchema } from '../lib/attachment-draft-schema';

/**
 * removeAttachmentFromDraft — Communications iter V1.5 (mail attachments),
 * Task 13. Companion to `saveDraft`'s `composeAttachments` field
 * (mail-drafts.ts): removes one entry from the caller's draft JSONB array.
 *
 * Does NOT delete from Storage for entries reprised from a Forward
 * (`reprisedFromAttachmentId` set) — the source EmailAttachment row still
 * references that Storage object. Fresh compose-time uploads get a
 * best-effort Storage delete (failures swallowed by
 * deleteMailAttachment — see docs/superpowers/specs/2026-07-16-mail-attachments-design.md
 * §7.3).
 *
 * Does NOT delete the EmailAttachment row itself (there isn't one yet at
 * compose time — see the header note in upload-attachment.ts) nor schedule
 * cleanup of orphaned Storage objects from abandoned drafts; that's a
 * scheduled-job concern, out of scope for V1.5 (tracked as a V2 followup).
 */

const inputSchema = z.object({ attachmentDraftId: z.string().uuid() });

export type RemoveAttachmentFromDraftInput = z.infer<typeof inputSchema>;

export async function removeAttachmentFromDraft(
  raw: RemoveAttachmentFromDraftInput,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const ctx = await requireUser();
  const parsed = inputSchema.parse(raw);

  // Ownership: scoped to workspaceId AND userId from the JWT-derived ctx —
  // never trust a draftId from the client (CLAUDE.md §4.4). MailDraft has a
  // unique (workspaceId, userId) constraint (one draft per user), so this
  // also implicitly asserts the draft belongs to the caller.
  const draft = await prisma.mailDraft.findFirst({
    where: { workspaceId: ctx.workspaceId, userId: ctx.userId },
    select: { id: true, composeAttachments: true },
  });
  if (!draft) return { ok: false, message: 'Aucun brouillon.' };

  const listParsed = z.array(attachmentDraftSchema).safeParse(draft.composeAttachments);
  const list = listParsed.success ? listParsed.data : [];

  const target = list.find((a) => a.id === parsed.attachmentDraftId);
  if (!target) return { ok: false, message: 'Pièce jointe introuvable dans le brouillon.' };

  const remaining = list.filter((a) => a.id !== parsed.attachmentDraftId);
  await prisma.mailDraft.update({
    where: { id: draft.id },
    data: {
      composeAttachments: remaining as unknown as Prisma.InputJsonValue,
    },
  });

  // Best-effort Storage delete — only for fresh uploads (not Forward reprises).
  if (!target.reprisedFromAttachmentId) {
    await deleteMailAttachment(target.storagePath);
  }
  return { ok: true };
}
