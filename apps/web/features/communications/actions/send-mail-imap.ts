'use server';
import 'server-only';
import { prisma } from '@nexushub/db';
import { openImapSession } from '@nexushub/integrations/imap';
import { openSmtpTransport, sendViaSmtp, appendToSentFolder } from '@nexushub/integrations/smtp';
import { getValidImapCredentials } from '@/features/integrations/lib/get-valid-imap-credentials';

export interface SendImapPayload {
  readonly subject: string;
  readonly to: readonly string[];
  readonly cc: readonly string[];
  readonly bcc: readonly string[];
  readonly bodyHtml: string;
  readonly bodyText: string;
  /** Local EmailMessage id — used to resolve the RFC 5322 In-Reply-To header. */
  readonly replyToLocalId?: string;
}

interface Args {
  readonly integrationId: string;
  readonly workspaceId: string;
  readonly userId: string;
  readonly fromEmail: string;
  readonly payload: SendImapPayload;
}

/**
 * Send a mail via SMTP + APPEND to the mailbox's Sent folder.
 * Throws with `SMTP_NOT_CONFIGURED` (prefix) when the mailbox has no SMTP
 * config in its encrypted blob — caller (sendMail) maps this to the
 * user-facing error code.
 */
export async function sendViaImapSmtp(args: Args): Promise<void> {
  const creds = await getValidImapCredentials({
    workspaceId: args.workspaceId,
    userId: args.userId,
    integrationId: args.integrationId,
  });
  if (!creds.smtp) {
    throw new Error('SMTP_NOT_CONFIGURED');
  }

  // Threading: pull the original Message-ID stored as `conversationId`.
  let inReplyTo: string | undefined;
  if (args.payload.replyToLocalId) {
    const orig = await prisma.emailMessage.findUnique({
      where: { id: args.payload.replyToLocalId },
      select: { conversationId: true },
    });
    if (orig?.conversationId) inReplyTo = orig.conversationId;
  }

  const transport = await openSmtpTransport(creds.smtp);
  let rawMessageIdForAppend: string | null = null;
  try {
    const r = await sendViaSmtp(transport, {
      from: args.fromEmail,
      to: args.payload.to,
      cc: args.payload.cc,
      bcc: args.payload.bcc,
      subject: args.payload.subject,
      html: args.payload.bodyHtml,
      text: args.payload.bodyText,
      ...(inReplyTo ? { inReplyTo, references: [inReplyTo] } : {}),
    });
    rawMessageIdForAppend = r.messageId ?? null;
  } finally {
    try {
      transport.close();
    } catch {
      /* swallow */
    }
  }

  // Best-effort APPEND to Sent folder — a failure here does NOT roll back
  // the send. V1: assemble a minimal RFC 822 envelope; V1.5 follow-up will
  // upgrade to nodemailer's raw source for full parity.
  if (!rawMessageIdForAppend) return;

  const session = await openImapSession(creds.imap);
  try {
    const rawSummary = Buffer.from(
      [
        `From: ${args.fromEmail}`,
        `To: ${args.payload.to.join(', ')}`,
        args.payload.cc.length > 0 ? `Cc: ${args.payload.cc.join(', ')}` : '',
        `Subject: ${args.payload.subject}`,
        `Message-ID: ${rawMessageIdForAppend}`,
        `Content-Type: text/html; charset=UTF-8`,
        '',
        args.payload.bodyHtml,
      ]
        .filter(Boolean)
        .join('\r\n'),
      'utf8',
    );
    await appendToSentFolder(session, rawSummary);
  } finally {
    try {
      await session.logout();
    } catch {
      /* swallow */
    }
  }
}
