import sanitizeHtml from 'sanitize-html';

export interface ParsedGraphMessage {
  readonly externalId: string;
  readonly subject: string;
  readonly fromEmail: string;
  readonly fromName: string | null;
  readonly toRecipients: readonly string[];
  readonly ccRecipients: readonly string[];
  readonly receivedAt: Date;
  readonly isRead: boolean;
  readonly conversationId: string | null;
  readonly bodyText: string;
  readonly bodyHtmlSanitized: string | null;
}

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
}

const SANITIZE_OPTS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p',
    'br',
    'strong',
    'em',
    'u',
    'a',
    'ul',
    'ol',
    'li',
    'blockquote',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'code',
    'pre',
    'span',
    'div',
    'img',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height'],
    span: ['style'],
    div: ['style'],
  },
  allowedSchemes: ['http', 'https', 'mailto', 'cid'],
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' }),
  },
};

function stripToText(html: string): string {
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, ' ').trim();
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
      bodyHtmlSanitized = sanitizeHtml(body.content, SANITIZE_OPTS);
      bodyText = stripToText(body.content);
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
  };
}
