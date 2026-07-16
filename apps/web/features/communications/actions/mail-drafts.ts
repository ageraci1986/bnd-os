'use server';
import 'server-only';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { prisma } from '@nexushub/db';

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
});

export type SaveDraftInput = z.infer<typeof saveSchema>;

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
      updatedAt: true,
    },
  });
  if (!row) return { ok: true, draft: null };
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
      updatedAt: row.updatedAt.toISOString(),
    },
  };
}

export async function deleteDraft(): Promise<{ ok: true }> {
  const ctx = await requireUser();
  await prisma.mailDraft.deleteMany({
    where: { workspaceId: ctx.workspaceId, userId: ctx.userId },
  });
  return { ok: true };
}
