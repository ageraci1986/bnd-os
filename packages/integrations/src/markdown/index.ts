/**
 * Markdown → safe HTML (and → plain text) helper.
 *
 * Shared by every surface that needs user-authored prose: card comments
 * (V1), Slack mirror (V1.5), Notes (V2). Single sanitisation policy
 * means a future XSS finding is patched in one place.
 *
 * SECURITY:
 *  - Stored body is raw markdown — sanitisation happens at render time
 *    so an updated whitelist applies retroactively to old rows.
 *  - Whitelist is intentionally narrow: no <img>, no <iframe>, no event
 *    handlers, no styles, no data:/javascript: URIs.
 *
 * Why sanitize-html (not DOMPurify): we render server-side inside Next 15's
 * RSC pipeline. DOMPurify needs a DOM (jsdom) which breaks Next's webpack
 * bundling (jsdom's `lib/jsdom/browser/default-stylesheet.css` is loaded
 * via dynamic fs and webpack does not copy it). sanitize-html is a pure
 * Node parser-based sanitiser — no DOM, no fs reads, works in any runtime.
 */
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

const ALLOWED_TAGS = [
  'p',
  'br',
  'strong',
  'em',
  'code',
  'pre',
  'blockquote',
  'ul',
  'ol',
  'li',
  'a',
];

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

  return sanitizeHtml(dirty, {
    allowedTags: ALLOWED_TAGS,
    // `href` lives on `a` only; `target` + `rel` are forced by transformTags.
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
    },
    allowedSchemes: ['https', 'mailto'],
    allowedSchemesAppliedToAttributes: ['href'],
    // Drop content of these tags entirely (not just the tags).
    disallowedTagsMode: 'discard',
    transformTags: {
      a: (_tagName, attribs) => ({
        tagName: 'a',
        attribs: {
          ...attribs,
          target: '_blank',
          rel: 'noopener noreferrer',
        },
      }),
    },
  });
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
