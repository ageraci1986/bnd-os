import { describe, expect, it } from 'vitest';
import { renderMarkdownToSafeHtml, markdownToPlainText } from './index';

describe('renderMarkdownToSafeHtml', () => {
  it('renders bold + italic + inline code', () => {
    const out = renderMarkdownToSafeHtml('**bold** *em* `code`');
    expect(out).toContain('<strong>bold</strong>');
    expect(out).toContain('<em>em</em>');
    expect(out).toContain('<code>code</code>');
  });

  it('renders fenced code blocks', () => {
    const out = renderMarkdownToSafeHtml('```\nhello\n```');
    expect(out).toContain('<pre>');
    expect(out).toContain('<code>');
    expect(out).toContain('hello');
  });

  it('renders bullet + ordered lists', () => {
    const ul = renderMarkdownToSafeHtml('- one\n- two');
    expect(ul).toContain('<ul>');
    expect(ul).toContain('<li>one</li>');
    const ol = renderMarkdownToSafeHtml('1. one\n2. two');
    expect(ol).toContain('<ol>');
  });

  it('renders blockquote', () => {
    const out = renderMarkdownToSafeHtml('> quoted');
    expect(out).toContain('<blockquote>');
  });

  it('renders https links with target=_blank + rel=noopener noreferrer', () => {
    const out = renderMarkdownToSafeHtml('[label](https://example.com)');
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
  });

  it('preserves <u> tags for underline (toolbar-emitted)', () => {
    const out = renderMarkdownToSafeHtml('hello <u>underlined</u> world');
    expect(out).toContain('<u>underlined</u>');
  });

  it('renders mailto: links', () => {
    const out = renderMarkdownToSafeHtml('[mail me](mailto:a@b.c)');
    expect(out).toContain('href="mailto:a@b.c"');
  });

  it('strips javascript: schemes from anchors', () => {
    const out = renderMarkdownToSafeHtml('[click](javascript:alert(1))');
    expect(out).not.toContain('javascript:');
    expect(out).not.toContain('alert');
  });

  it('strips data: schemes from anchors', () => {
    const out = renderMarkdownToSafeHtml('[x](data:text/html,<script>1</script>)');
    expect(out).not.toContain('data:');
    expect(out).not.toContain('<script>');
  });

  it('strips raw <script> tags', () => {
    const out = renderMarkdownToSafeHtml('hello<script>alert(1)</script>world');
    expect(out).not.toContain('<script>');
    expect(out).not.toContain('alert');
    expect(out).toContain('hello');
    expect(out).toContain('world');
  });

  it('strips <img> tags entirely', () => {
    const out = renderMarkdownToSafeHtml('![pwn](https://x.test/x.png)');
    expect(out).not.toContain('<img');
  });

  it('strips <iframe> tags', () => {
    const out = renderMarkdownToSafeHtml('<iframe src="https://evil"></iframe>');
    expect(out).not.toContain('<iframe');
  });

  it('strips on* event-handler attributes', () => {
    const out = renderMarkdownToSafeHtml('<a href="https://x.test" onclick="alert(1)">x</a>');
    expect(out).not.toContain('onclick');
    expect(out).not.toContain('alert');
  });

  it('strips style attributes (CSS-based XSS like background:url(javascript:…))', () => {
    const out = renderMarkdownToSafeHtml('<a href="https://x.test" style="background:red">x</a>');
    expect(out).not.toContain('style=');
  });

  it('escapes lone < and > characters inside paragraph text', () => {
    const out = renderMarkdownToSafeHtml('a < b > c');
    // The paragraph wrapper is fine; what matters is that the user's
    // raw `<` and `>` are entity-escaped, not interpreted as a tag.
    expect(out).toContain('&lt;');
    expect(out).toContain('&gt;');
    // No injected element starting with `<b` (the failure mode here is
    // marked turning `< b >` into a literal <b> tag).
    expect(out).not.toMatch(/<b[\s>]/i);
  });

  it('returns empty string for empty input', () => {
    expect(renderMarkdownToSafeHtml('')).toBe('');
    expect(renderMarkdownToSafeHtml('   \n  ')).toBe('');
  });
});

describe('markdownToPlainText', () => {
  it('strips markdown syntax', () => {
    expect(markdownToPlainText('**bold** and *italic*')).toBe('bold and italic');
  });

  it('strips link syntax but keeps the label', () => {
    expect(markdownToPlainText('see [docs](https://x.test)')).toBe('see docs');
  });

  it('flattens multiline content to spaces', () => {
    const out = markdownToPlainText('line one\n\nline two\n- a\n- b');
    expect(out).toContain('line one');
    expect(out).toContain('line two');
    expect(out).toContain('a');
    expect(out).toContain('b');
    expect(out).not.toContain('\n\n');
  });

  it('truncates politely with ellipsis when limit is given', () => {
    const long = 'a'.repeat(500);
    const out = markdownToPlainText(long, 100);
    expect(out.length).toBeLessThanOrEqual(101); // 100 + ellipsis "…" = 1 char
    expect(out.endsWith('…')).toBe(true);
  });

  it('does not truncate when under limit', () => {
    const out = markdownToPlainText('short', 100);
    expect(out).toBe('short');
  });
});
