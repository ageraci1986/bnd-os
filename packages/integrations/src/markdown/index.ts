/**
 * Markdown → safe HTML (and → plain text) helper.
 *
 * Shared by every surface that needs user-authored prose: card comments
 * (V1), Slack mirror (V1.5), Notes (V2). Single sanitisation policy
 * means a future XSS finding is patched in one place.
 *
 * SECURITY:
 *  - Stored body is raw markdown — sanitisation happens at render time
 *    so an updated DOMPurify whitelist applies retroactively to old rows.
 *  - Whitelist is intentionally narrow: no <img>, no <iframe>, no event
 *    handlers, no styles, no data:/javascript: URIs.
 */
import { marked } from 'marked';
import DOMPurify from 'isomorphic-dompurify';

const ALLOWED_TAGS = ['br', 'strong', 'em', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'a'];

const ALLOWED_ATTR = ['href', 'target', 'rel'];

marked.use({
  gfm: true,
  breaks: true,
});

/**
 * Convert raw markdown to a sanitised HTML string suitable for
 * `dangerouslySetInnerHTML`. Returns "" for empty input.
 */
export function renderMarkdownToSafeHtml(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return '';

  const dirty = marked.parse(trimmed, { async: false }) as string;

  const clean = DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: /^(?:https:|mailto:)/i,
    ADD_ATTR: ['target', 'rel'],
    FORBID_TAGS: ['style', 'script', 'iframe', 'img'],
    FORBID_ATTR: ['style', 'onerror', 'onclick', 'onload', 'onmouseover'],
  });

  // Force every anchor to open in a new tab with safe rel — DOMPurify
  // strips javascript: hrefs but does not add target/rel for us.
  return clean.replace(
    /<a\s+([^>]*?)href="([^"]+)"([^>]*)>/gi,
    (_match, pre: string, href: string, post: string) => {
      const cleanedPre = pre.replace(/\s(target|rel)="[^"]*"/gi, '');
      const cleanedPost = post.replace(/\s(target|rel)="[^"]*"/gi, '');
      return `<a ${cleanedPre.trim()} href="${href}" target="_blank" rel="noopener noreferrer" ${cleanedPost.trim()}>`.replace(
        /\s+>/,
        '>',
      );
    },
  );
}

/**
 * Convert markdown to a plain-text string, optionally truncated.
 */
export function markdownToPlainText(raw: string, maxLength?: number): string {
  let text = raw
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^>\s?/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (typeof maxLength === 'number' && text.length > maxLength) {
    text = `${text.slice(0, maxLength)}…`;
  }
  return text;
}
