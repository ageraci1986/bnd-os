'use server';
import 'server-only';

// Stub — full implementation lands in Task 14.
interface SendImapPayload {
  readonly subject: string;
  readonly to: readonly string[];
  readonly cc: readonly string[];
  readonly bcc: readonly string[];
  readonly bodyHtml: string;
  readonly bodyText: string;
  readonly replyToLocalId?: string;
}

interface Args {
  readonly integrationId: string;
  readonly workspaceId: string;
  readonly userId: string;
  readonly fromEmail: string;
  readonly payload: SendImapPayload;
}

export async function sendViaImapSmtp(_args: Args): Promise<void> {
  throw new Error('SMTP_NOT_CONFIGURED: send-mail-imap stub — implement in Task 14');
}
