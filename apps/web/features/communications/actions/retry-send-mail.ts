'use server';
import 'server-only';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { prisma } from '@nexushub/db';
import { sendMail, type SendMailResult } from './send-mail';

const inputSchema = z.object({ emailMessageId: z.string().uuid() });

export type RetrySendMailResult =
  | { readonly ok: false; readonly code: 'NOT_FOUND'; readonly message: string }
  | SendMailResult;

/**
 * Re-run a failed outbox send with its persisted recipients/subject/body.
 *
 * Known limitation: BCC is not persisted on `EmailMessage` (only to/cc), so a
 * retried send loses any original BCC recipients.
 */
export async function retrySendMail(
  raw: z.infer<typeof inputSchema>,
): Promise<RetrySendMailResult> {
  const ctx = await requireUser();
  const parsed = inputSchema.parse(raw);
  const row = await prisma.emailMessage.findFirst({
    where: {
      id: parsed.emailMessageId,
      workspaceId: ctx.workspaceId,
      sentByUserId: ctx.userId,
      sendStatus: 'failed',
    },
    select: {
      id: true,
      integrationId: true,
      subject: true,
      bodyHtmlSanitized: true,
      toRecipients: true,
      ccRecipients: true,
    },
  });
  if (!row) return { ok: false, code: 'NOT_FOUND', message: 'Message introuvable ou déjà envoyé.' };
  return sendMail({
    fromIntegrationId: row.integrationId,
    mode: 'new_mail',
    toRecipients: row.toRecipients,
    ccRecipients: row.ccRecipients,
    bccRecipients: [],
    subject: row.subject,
    bodyHtml: row.bodyHtmlSanitized ?? '',
  });
}
