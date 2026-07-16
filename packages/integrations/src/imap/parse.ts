import { sanitizeMailHtml, stripMailHtmlToText, type ParsedMailMessage } from '../mail';

export interface ImapAddress {
  readonly address?: string;
  readonly name?: string;
}

export interface ImapEnvelope {
  readonly date: Date | null;
  readonly subject: string | null;
  readonly from: readonly ImapAddress[];
  readonly to: readonly ImapAddress[];
  readonly cc: readonly ImapAddress[];
  readonly inReplyTo: string | null;
  readonly messageId: string | null;
}

export interface RawImapMessage {
  readonly uid: number;
  readonly envelope: ImapEnvelope;
  readonly flags: ReadonlySet<string>;
  readonly bodyText: string | null;
  readonly bodyHtml: string | null;
  readonly internalDate?: Date;
  readonly headers?: Record<string, string>;
}

function normalize(list: readonly ImapAddress[]): string[] {
  return list.map((a) => a.address?.toLowerCase()).filter((s): s is string => Boolean(s));
}

export function parseImapMessage(raw: RawImapMessage): ParsedMailMessage {
  const from = raw.envelope.from[0];
  const html = raw.bodyHtml;
  const bodyHtmlSanitized = html ? sanitizeMailHtml(html) : null;
  const bodyText = html ? stripMailHtmlToText(html) : (raw.bodyText ?? '');
  const receivedAt = raw.envelope.date ?? raw.internalDate ?? new Date(0);
  return {
    externalId: String(raw.uid),
    subject: raw.envelope.subject ?? '',
    fromEmail: from?.address?.toLowerCase() ?? '',
    fromName: from?.name?.trim() ? from.name.trim() : null,
    toRecipients: normalize(raw.envelope.to),
    ccRecipients: normalize(raw.envelope.cc),
    receivedAt,
    isRead: raw.flags.has('\\Seen'),
    conversationId: raw.envelope.messageId ?? raw.envelope.inReplyTo ?? null,
    bodyText,
    bodyHtmlSanitized,
  };
}
