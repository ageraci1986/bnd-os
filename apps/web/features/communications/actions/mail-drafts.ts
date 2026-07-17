'use server';
import 'server-only';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { prisma, type Prisma } from '@nexushub/db';
import { deleteMailAttachment } from '@/lib/mail-attachment-storage';
import { attachmentDraftSchema, type AttachmentDraft } from '../lib/attachment-draft-schema';

const kindSchema = z.enum(['reply', 'reply_all', 'forward', 'new_mail']);

const saveSchema = z.object({
  fromIntegrationId: z.string().uuid(),
  kind: kindSchema,
  replyToId: z.string().uuid().optional(),
  toRecipients: z.array(z.string().email()).default([]),
  ccRecipients: z.array(z.string().email()).default([]),
  bccRecipients: z.array(z.string().email()).default([]),
  subject: z.string().default(''),
  bodyHtml: z.string().max(500_000).default(''),
  composeAttachments: z.array(attachmentDraftSchema).max(20).default([]),
});

// z.input (not z.infer) so fields carrying `.default()` — including the new
// `composeAttachments` — stay optional for callers, matching runtime
// behavior (saveSchema.parse fills them in). Using the output type here
// would force every existing call site (e.g. compose-panel.tsx) to pass
// `composeAttachments: []` explicitly for no behavioral gain.
export type SaveDraftInput = z.input<typeof saveSchema>;

export async function saveDraft(
  raw: SaveDraftInput,
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const ctx = await requireUser();
  const parsed = saveSchema.parse(raw);
  try {
    const row = await prisma.mailDraft.upsert({
      where: { workspaceId_userId: { workspaceId: ctx.workspaceId, userId: ctx.userId } },
      create: {
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
        fromIntegrationId: parsed.fromIntegrationId,
        kind: parsed.kind,
        ...(parsed.replyToId ? { replyToId: parsed.replyToId } : {}),
        toRecipients: [...parsed.toRecipients],
        ccRecipients: [...parsed.ccRecipients],
        bccRecipients: [...parsed.bccRecipients],
        subject: parsed.subject,
        bodyHtml: parsed.bodyHtml,
        composeAttachments: parsed.composeAttachments as unknown as Prisma.InputJsonValue,
      },
      update: {
        fromIntegrationId: parsed.fromIntegrationId,
        kind: parsed.kind,
        replyToId: parsed.replyToId ?? null,
        toRecipients: [...parsed.toRecipients],
        ccRecipients: [...parsed.ccRecipients],
        bccRecipients: [...parsed.bccRecipients],
        subject: parsed.subject,
        bodyHtml: parsed.bodyHtml,
        composeAttachments: parsed.composeAttachments as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    return { ok: true, id: row.id };
  } catch {
    return { ok: false, message: 'Impossible d’enregistrer le brouillon.' };
  }
}

export interface DraftDto {
  readonly id: string;
  readonly fromIntegrationId: string;
  readonly kind: z.infer<typeof kindSchema>;
  readonly replyToId: string | null;
  readonly toRecipients: readonly string[];
  readonly ccRecipients: readonly string[];
  readonly bccRecipients: readonly string[];
  readonly subject: string;
  readonly bodyHtml: string;
  readonly composeAttachments: readonly AttachmentDraft[];
  readonly updatedAt: string;
}

export async function loadDraft(): Promise<{ ok: true; draft: DraftDto | null }> {
  const ctx = await requireUser();
  const row = await prisma.mailDraft.findFirst({
    where: { workspaceId: ctx.workspaceId, userId: ctx.userId },
    select: {
      id: true,
      fromIntegrationId: true,
      kind: true,
      replyToId: true,
      toRecipients: true,
      ccRecipients: true,
      bccRecipients: true,
      subject: true,
      bodyHtml: true,
      composeAttachments: true,
      updatedAt: true,
    },
  });
  if (!row) return { ok: true, draft: null };
  // Defensive re-validation of the persisted JSONB — it was Zod-validated on
  // write, but re-parsing on read guards against stale rows written before
  // this field existed (defaults to `[]`, which is valid) or manual DB edits.
  const attachmentsParsed = z.array(attachmentDraftSchema).safeParse(row.composeAttachments);
  return {
    ok: true,
    draft: {
      id: row.id,
      fromIntegrationId: row.fromIntegrationId,
      kind: row.kind,
      replyToId: row.replyToId,
      toRecipients: row.toRecipients,
      ccRecipients: row.ccRecipients,
      bccRecipients: row.bccRecipients,
      subject: row.subject,
      bodyHtml: row.bodyHtml,
      composeAttachments: attachmentsParsed.success ? attachmentsParsed.data : [],
      updatedAt: row.updatedAt.toISOString(),
    },
  };
}

export async function deleteDraft(): Promise<{ ok: true }> {
  const ctx = await requireUser();
  // Best-effort Storage cleanup for fresh compose-time uploads before the row
  // goes away — reprised (Forward) entries are skipped since the source
  // EmailAttachment row still references that Storage object (mirrors
  // remove-attachment-from-draft.ts).
  const draft = await prisma.mailDraft.findFirst({
    where: { workspaceId: ctx.workspaceId, userId: ctx.userId },
    select: { composeAttachments: true },
  });
  if (draft) {
    const listParsed = z.array(attachmentDraftSchema).safeParse(draft.composeAttachments);
    const list = listParsed.success ? listParsed.data : [];
    await Promise.all(
      list
        .filter((a) => !a.reprisedFromAttachmentId)
        .map((a) => deleteMailAttachment(a.storagePath)),
    );
  }
  await prisma.mailDraft.deleteMany({
    where: { workspaceId: ctx.workspaceId, userId: ctx.userId },
  });
  return { ok: true };
}
