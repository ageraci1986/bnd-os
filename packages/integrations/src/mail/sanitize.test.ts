import { describe, it, expect } from 'vitest';
import { sanitizeMailHtml, stripMailHtmlToText } from './sanitize';

describe('sanitizeMailHtml', () => {
  it('keeps allowed inline tags and enforces safe link attrs', () => {
    const out = sanitizeMailHtml('<p><a href="https://ex.com">hi</a></p>');
    expect(out).toContain('href="https://ex.com"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain('target="_blank"');
  });

  it('strips <script> and event handlers', () => {
    const out = sanitizeMailHtml('<p>ok</p><script>alert(1)</script><img src=x onerror=alert(1)>');
    expect(out).not.toContain('<script>');
    expect(out).not.toContain('onerror');
  });

  it('accepts cid: scheme on img src (inline attachments)', () => {
    const out = sanitizeMailHtml('<img src="cid:abc@x" alt="a">');
    expect(out).toContain('src="cid:abc@x"');
  });

  it('rejects javascript: URIs', () => {
    const out = sanitizeMailHtml('<a href="javascript:alert(1)">x</a>');
    expect(out).not.toContain('javascript:');
  });
});

describe('stripMailHtmlToText', () => {
  it('collapses whitespace and drops tags', () => {
    expect(stripMailHtmlToText('<p>hello\n  <b>world</b></p>')).toBe('hello world');
  });
});
