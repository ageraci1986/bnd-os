import type { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import iconv from 'iconv-lite';
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
  // Round-trip through latin1 (1:1 with bytes 0-255) so body bytes are
  // preserved exactly. Two rewrites, applied in order:
  //
  //   1. REPLACE — every Content-Type: header that already declares a charset
  //      gets its charset value replaced with `override`.
  //
  //   2. APPEND — every Content-Type: text/* header that has NO charset param
  //      gets `; charset=<override>` appended. This is critical for legacy
  //      Exchange forwards: they often emit `Content-Type: text/html` (no
  //      charset) with a raw 8bit body in iso-8859-1 / windows-1252, and
  //      mailparser defaults absent charsets to us-ascii — every non-ASCII
  //      byte becomes U+FFFD.
  //
  // Regex allows RFC 5322 line-folded headers (CRLF followed by whitespace).
  const raw = source.toString('latin1');

  const replaceRe =
    // eslint-disable-next-line security/detect-unsafe-regex -- bounded pattern; source is our own IMAP fetch
    /(Content-Type\s*:(?:[^\r\n]|\r?\n[ \t])*?charset\s*=\s*)(["']?)([A-Za-z0-9._+:-]+)\2/gi;
  const step1 = raw.replace(
    replaceRe,
    (_m, prefix: string, quote: string) => `${prefix}${quote}${override}${quote}`,
  );

  // Match `Content-Type: text/<subtype>` up to end-of-header (including
  // folded continuations). Skip if `charset=` appears anywhere in the header
  // (already handled by step 1). Append `; charset=<override>` at the end
  // of the header value.
  const appendRe =
    // eslint-disable-next-line security/detect-unsafe-regex -- bounded pattern; source is our own IMAP fetch
    /(Content-Type\s*:\s*text\/[A-Za-z0-9._+-]+(?:(?:[^\r\n]|\r?\n[ \t])*?)?)(?=\r?\n(?![ \t]))/gi;
  const step2 = step1.replace(appendRe, (m: string) => {
    if (/charset\s*=/i.test(m)) return m;
    return `${m}; charset=${override}`;
  });

  return Buffer.from(step2, 'latin1');
}

/**
 * Convert the entire source Buffer from windows-1252 to UTF-8. Non-ASCII
 * bytes get transcoded; ASCII bytes (all of the MIME structure — boundaries,
 * headers, base64 payloads) round-trip unchanged. Then rewrite every
 * Content-Type charset= header to `utf-8` so mailparser's iconv-lite step
 * doesn't try to re-decode already-clean UTF-8 as windows-1252 again.
 *
 * This is the strongest fallback: it works even when the sender's headers
 * are inconsistent (Content-Type says utf-8 but bytes are 1252) or when
 * charset=utf-8 is declared on parts whose bodies are actually windows-1252
 * base64-encoded (mailparser decodes base64 → 1252 bytes → applies utf-8
 * → mojibake; whereas after this transform, the base64 body itself decodes
 * to UTF-8 bytes matching the (also-rewritten) utf-8 declaration).
 */
function coerceToUtf8(source: Buffer): Buffer {
  const asString = iconv.decode(source, 'windows-1252');
  const asUtf8 = Buffer.from(asString, 'utf-8');
  return rewriteCharset(asUtf8, 'utf-8');
}

async function parseWithFallback(source: Buffer): Promise<{
  html: string | null;
  text: string;
}> {
  const attempts: { html: string | null; text: string; bad: number; label: string }[] = [];

  async function run(input: Buffer, label: string) {
    const p = await simpleParser(input);
    const html = typeof p.html === 'string' && p.html.length > 0 ? p.html : null;
    const text = p.text ?? '';
    const bad = countReplacementChars(html) + countReplacementChars(text);
    attempts.push({ html, text, bad, label });
    return bad;
  }

  // Pass 1 — honor the sender's declaration verbatim. Common happy path.
  const bad1 = await run(source, 'utf8-declared');
  if (bad1 === 0)
    return {
      html: (attempts[0] as { html: string | null; text: string }).html,
      text: (attempts[0] as { html: string | null; text: string }).text,
    };

  // Pass 2 — rewrite every Content-Type charset= to windows-1252. Works when
  // the mail body parts are 8bit or quoted-printable — mailparser then hands
  // the raw bytes to iconv-lite as windows-1252, which is what the bytes
  // actually are.
  const rewritten = rewriteCharset(source, 'windows-1252');
  const bad2 = await run(rewritten, 'windows-1252-header');
  if (bad2 === 0)
    return {
      html: (attempts[1] as { html: string | null; text: string }).html,
      text: (attempts[1] as { html: string | null; text: string }).text,
    };

  // Pass 3 — brute force: transcode the whole source Buffer from
  // windows-1252 to UTF-8 (identity for ASCII, correct for 0x80-0xFF), and
  // rewrite the headers to say utf-8 to match. Fixes cases pass 2 can't:
  // parts that are base64-encoded with windows-1252 payloads that mailparser
  // would otherwise re-decode as windows-1252-of-windows-1252 (garbled).
  const coerced = coerceToUtf8(source);
  await run(coerced, 'windows-1252-transcoded');

  attempts.sort((a, b) => a.bad - b.bad);
  const best = attempts[0] as { html: string | null; text: string };
  return { html: best.html, text: best.text };
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
