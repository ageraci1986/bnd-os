'use server';
import 'server-only';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { requireUser } from '@/lib/auth';
import { checkMailSendRate } from '@/lib/rate-limit';
import { prisma } from '@nexushub/db';
import { sanitizeMailHtml, stripMailHtmlToText } from '@nexushub/integrations/mail';
import { sendViaGraph } from '@nexushub/integrations/graph';
import { getValidAccessToken } from '@/features/integrations/lib/get-valid-access-token';
import { sendViaImapSmtp } from './send-mail-imap';

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
  })
  .refine((v) => v.toRecipients.length + v.ccRecipients.length + v.bccRecipients.length <= 20, {
    message: 'Trop de destinataires (max 20 au total)',
    path: ['toRecipients'],
  });

export type SendMailInput = z.infer<typeof inputSchema>;

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

export async function sendMail(raw: SendMailInput): Promise<SendMailResult> {
  const ctx = await requireUser();

  // 1. Input validation
  let parsed: SendMailInput;
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
        },
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Send failed';
    const code = /SMTP_NOT_CONFIGURED/.test(message) ? 'SMTP_NOT_CONFIGURED' : 'SEND_FAILED';
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
      },
    },
  });

  return { ok: true, emailMessageId: outboxRow.id };
}
