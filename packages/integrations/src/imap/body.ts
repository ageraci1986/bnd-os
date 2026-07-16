import type { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { sanitizeMailHtml, stripMailHtmlToText } from '../mail';

export interface ImapMessageBody {
  readonly bodyText: string;
  readonly bodyHtmlSanitized: string | null;
}

/**
 * Fetch and decode a single IMAP message body by UID. Delegates MIME parsing
 * to `mailparser` (multipart / quoted-printable / base64 / charset conversion
 * / text-vs-html alternative split), then runs the HTML output through the
 * shared sanitize allowlist. Returns already-sanitized values so consumers
 * never see raw HTML.
 *
 * Caller owns the ImapFlow session lifecycle (open/logout).
 *
 * Returns null when the server has no source for that UID (message deleted
 * server-side between sync and open, unreadable envelope, etc.).
 */
export async function fetchImapMessageBody(
  session: ImapFlow,
  uid: number,
): Promise<ImapMessageBody | null> {
  const msg = await session.fetchOne(String(uid), { source: true }, { uid: true });
  if (!msg || !Buffer.isBuffer(msg.source)) return null;
  const parsed = await simpleParser(msg.source);
  const rawHtml = typeof parsed.html === 'string' && parsed.html.length > 0 ? parsed.html : null;
  const rawText = parsed.text ?? '';
  const bodyHtmlSanitized = rawHtml ? sanitizeMailHtml(rawHtml) : null;
  const bodyText = rawHtml ? stripMailHtmlToText(rawHtml) : rawText;
  return { bodyText, bodyHtmlSanitized };
}
