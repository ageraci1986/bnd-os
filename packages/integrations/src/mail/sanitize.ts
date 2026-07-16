import sanitizeHtml from 'sanitize-html';

/**
 * Shared sanitize-html allowlist for inbound mail bodies (Graph + IMAP).
 * Any change here must be reviewed for XSS impact — this pipeline gates
 * every raw email HTML rendered by the Communications UI.
 *
 * Real-world email HTML relies on RFC 1866 tables for layout (Outlook, most
 * ESPs) plus inline `style` attributes. Stripping those makes campaign mails
 * unreadable. We allow the layout primitives + a curated set of style
 * properties that can't exfiltrate data (no `url()`, no `expression()`,
 * no `@import`, no positioning tricks).
 */
const layoutTags = [
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'td',
  'th',
  'col',
  'colgroup',
  'caption',
  'hr',
  'section',
  'article',
  'header',
  'footer',
  'nav',
  'main',
  'aside',
  'small',
  'sub',
  'sup',
  'b',
  'i',
  'font',
];

// Legacy presentational attrs still used by every ESP-generated email.
const commonAttrs = [
  'style',
  'class',
  'id',
  'align',
  'valign',
  'width',
  'height',
  'bgcolor',
  'color',
  'border',
  'cellpadding',
  'cellspacing',
  'colspan',
  'rowspan',
  'dir',
  'lang',
];

const OPTS: sanitizeHtml.IOptions = {
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
    ...layoutTags,
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel', ...commonAttrs],
    img: ['src', 'alt', 'title', 'srcset', 'sizes', ...commonAttrs],
    // Every other allowed tag gets the common presentational attrs.
    '*': commonAttrs,
  },
  allowedSchemes: ['http', 'https', 'mailto', 'cid', 'data'],
  allowedSchemesByTag: {
    // `data:` on <img> only — inline base64 images from email HTML are safe
    // to render; we still forbid `data:` in href/src of everything else to
    // block `data:text/html,<script>...`.
    img: ['http', 'https', 'cid', 'data'],
    a: ['http', 'https', 'mailto'],
  },
  // Curated CSS whitelist — no url(), no expression(), no positioning tricks.
  // Patterns are intentionally simple (single quantifier, anchored) to
  // avoid backtracking traps and to keep the security/detect-unsafe-regex
  // lint quiet without inline suppressions.
  allowedStyles: {
    '*': {
      color: [/^#[0-9a-f]{3,8}$/i, /^rgb[a]?\([^)]+\)$/i, /^[a-z]+$/i],
      'background-color': [
        /^#[0-9a-f]{3,8}$/i,
        /^rgb[a]?\([^)]+\)$/i,
        /^[a-z]+$/i,
        /^transparent$/i,
      ],
      // `background` is a shorthand — refuse url() but allow color/keyword.
      background: [/^#[0-9a-f]{3,8}$/i, /^rgb[a]?\([^)]+\)$/i, /^[a-z]+$/i, /^transparent$/i],
      'font-size': [/^[\d.]+(px|em|rem|pt|%)$/],
      'font-family': [/^[\w\s,"'-]+$/],
      'font-weight': [/^(normal|bold|bolder|lighter)$/, /^\d{3}$/],
      'font-style': [/^(normal|italic|oblique)$/],
      'text-align': [/^(left|right|center|justify)$/],
      'text-decoration': [/^(none|underline|line-through)$/],
      'line-height': [/^normal$/, /^[\d.]+$/, /^[\d.]+(px|em|rem|%)$/],
      'letter-spacing': [/^normal$/, /^-?[\d.]+(px|em|rem)$/],
      padding: [/^[\d\s.pxem%-]+$/],
      'padding-top': [/^[\d.pxem%-]+$/],
      'padding-right': [/^[\d.pxem%-]+$/],
      'padding-bottom': [/^[\d.pxem%-]+$/],
      'padding-left': [/^[\d.pxem%-]+$/],
      margin: [/^[\d\s.pxem%auto-]+$/],
      'margin-top': [/^[\d.pxem%auto-]+$/],
      'margin-right': [/^[\d.pxem%auto-]+$/],
      'margin-bottom': [/^[\d.pxem%auto-]+$/],
      'margin-left': [/^[\d.pxem%auto-]+$/],
      width: [/^[\d.]+(px|em|rem|%)$/, /^auto$/],
      height: [/^[\d.]+(px|em|rem|%)$/, /^auto$/],
      'max-width': [/^[\d.]+(px|em|rem|%)$/, /^none$/],
      'min-width': [/^[\d.]+(px|em|rem|%)$/],
      border: [/^[\w\s#(),.-]+$/],
      'border-radius': [/^[\d\s.pxem%-]+$/],
      'border-color': [/^#[0-9a-f]{3,8}$/i, /^rgb[a]?\([^)]+\)$/i, /^[a-z]+$/i],
      'border-style': [/^(none|solid|dashed|dotted|double)$/],
      'border-width': [/^[\d\s.pxem-]+$/],
      display: [/^(block|inline|inline-block|table|table-row|table-cell|none)$/],
      'vertical-align': [/^(top|middle|bottom|baseline|super|sub)$/, /^[\d.]+(px|%)$/],
    },
  },
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' }),
  },
};

export function sanitizeMailHtml(html: string): string {
  return sanitizeHtml(html, OPTS);
}

export function stripMailHtmlToText(html: string): string {
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, ' ').trim();
}
