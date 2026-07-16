import { sanitizeMailHtml, stripMailHtmlToText, type ParsedMailMessage } from '../mail';

export type ParsedGraphMessage = ParsedMailMessage;

interface GraphAddress {
  emailAddress?: { name?: string; address?: string };
}

interface GraphMessage {
  id: string;
  subject?: string;
  from?: GraphAddress;
  toRecipients?: GraphAddress[];
  ccRecipients?: GraphAddress[];
  receivedDateTime: string;
  isRead?: boolean;
  conversationId?: string;
  bodyPreview?: string;
  body?: { contentType: string; content: string };
  hasAttachments?: boolean;
}

function extractRecipients(arr: GraphAddress[] | undefined): string[] {
  if (!arr) return [];
  return arr
    .map((a) => a.emailAddress?.address?.toLowerCase())
    .filter((s): s is string => Boolean(s));
}

export function parseGraphMessage(raw: GraphMessage): ParsedGraphMessage {
  const fromEmail = raw.from?.emailAddress?.address?.toLowerCase() ?? '';
  const fromName = raw.from?.emailAddress?.name ?? null;
  const body = raw.body;
  let bodyText = '';
  let bodyHtmlSanitized: string | null = null;
  if (body && typeof body.content === 'string') {
    if (body.contentType === 'html') {
      bodyHtmlSanitized = sanitizeMailHtml(body.content);
      bodyText = stripMailHtmlToText(body.content);
    } else {
      bodyText = body.content;
    }
  }
  return {
    externalId: raw.id,
    subject: raw.subject ?? '',
    fromEmail,
    fromName: fromName && fromName.length > 0 ? fromName : null,
    toRecipients: extractRecipients(raw.toRecipients),
    ccRecipients: extractRecipients(raw.ccRecipients),
    receivedAt: new Date(raw.receivedDateTime),
    isRead: raw.isRead === true,
    conversationId: raw.conversationId ?? null,
    bodyText,
    bodyHtmlSanitized,
    ...(raw.hasAttachments !== undefined ? { hasAttachments: raw.hasAttachments } : {}),
  };
}
