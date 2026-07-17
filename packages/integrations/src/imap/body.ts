import type { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { sanitizeMailHtml, stripMailHtmlToText } from '../mail';

export interface ImapMessageBody {
  readonly bodyText: string;
  readonly bodyHtmlSanitized: string | null;
}

const REPLACEMENT_CHAR = '�';

function countReplacementChars(s: string | null | undefined): number {
  if (!s) return 0;
  let n = 0;
  for (const ch of s) if (ch === REPLACEMENT_CHAR) n++;
  return n;
}

/**
 * Rewrite every `charset=<orig>` occurrence in the header block AND any
 * multipart boundary's per-part Content-Type headers with the given
 * override. Used as a fallback when the sender declared UTF-8 but actually
 * emitted windows-1252 / latin1 bytes (very common with legacy Java/Exchange
 * senders).
 *
 * Only rewrites Content-Type-adjacent `charset=` declarations found before
 * the message body — the body itself is left untouched (a `charset=` string
 * appearing in the body could be a legitimate value, not something we should
 * alter). Multipart boundary headers within the body are still targeted
 * because they carry per-part Content-Type; we identify those by scanning
 * for Content-Type header lines anywhere in the source.
 *
 * Case-insensitive on the `charset=` prefix; quotes around the value are
 * preserved.
 */
function rewriteCharset(source: Buffer, override: string): Buffer {
  // Cheap-and-safe implementation: convert to latin1 string (round-trip safe
  // since latin1 is 1:1 with bytes 0-255), regex-replace charset= in header-
  // like lines, convert back to Buffer via latin1. This preserves all raw
  // body bytes exactly since they never match Content-Type header patterns.
  const raw = source.toString('latin1');
  // Match `Content-Type: ...; charset=<value>` including optional quotes and
  // whitespace. Group 1 = the Content-Type prefix up to charset=, group 2 =
  // opening quote (or empty), group 3 = the charset value.
  const re = /(Content-Type\s*:[^\r\n]*?charset\s*=\s*)(["']?)([A-Za-z0-9._+:-]+)\2/gi;
  const rewritten = raw.replace(
    re,
    (_m, prefix: string, quote: string) => `${prefix}${quote}${override}${quote}`,
  );
  return Buffer.from(rewritten, 'latin1');
}

async function parseWithFallback(source: Buffer): Promise<{
  html: string | null;
  text: string;
}> {
  // First pass: honor whatever the sender declared.
  const first = await simpleParser(source);
  const firstHtml = typeof first.html === 'string' && first.html.length > 0 ? first.html : null;
  const firstText = first.text ?? '';
  const firstBad = countReplacementChars(firstHtml) + countReplacementChars(firstText);
  if (firstBad === 0) return { html: firstHtml, text: firstText };

  // Fallback pass: many legacy senders (French/European corporate mail from
  // Java/Exchange stacks) declare `charset=utf-8` in the Content-Type header
  // but emit windows-1252 bytes. When mailparser produces U+FFFD chars, retry
  // with the source's charset header overridden to windows-1252 and pick
  // whichever pass produced fewer replacement chars.
  const rewritten = rewriteCharset(source, 'windows-1252');
  const second = await simpleParser(rewritten);
  const secondHtml = typeof second.html === 'string' && second.html.length > 0 ? second.html : null;
  const secondText = second.text ?? '';
  const secondBad = countReplacementChars(secondHtml) + countReplacementChars(secondText);

  if (secondBad < firstBad) return { html: secondHtml, text: secondText };
  return { html: firstHtml, text: firstText };
}

/**
 * Fetch and decode a single IMAP message body by UID. Delegates MIME parsing
 * to `mailparser` (multipart / quoted-printable / base64 / charset conversion
 * / text-vs-html alternative split), then runs the HTML output through the
 * shared sanitize allowlist. Returns already-sanitized values so consumers
 * never see raw HTML.
 *
 * When the first parse produces U+FFFD replacement chars (mislabeled charset
 * — sender declared UTF-8 but sent windows-1252 bytes), retries once with
 * the Content-Type charset overridden to windows-1252 and returns whichever
 * pass yields fewer replacement chars. See `parseWithFallback`.
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
  const { html: rawHtml, text: rawText } = await parseWithFallback(msg.source);
  const bodyHtmlSanitized = rawHtml ? sanitizeMailHtml(rawHtml) : null;
  const bodyText = rawHtml ? stripMailHtmlToText(rawHtml) : rawText;
  return { bodyText, bodyHtmlSanitized };
}
