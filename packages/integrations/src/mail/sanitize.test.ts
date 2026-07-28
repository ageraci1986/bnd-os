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

  it('strips class and id attributes (anti-overlay: blocks Tailwind utility classes like fixed/inset-0 from escaping the mail container)', () => {
    const out = sanitizeMailHtml(
      '<div class="fixed inset-0 z-50 bg-white" id="x"><p class="foo" id="bar">hi</p></div>',
    );
    expect(out).not.toContain('class=');
    expect(out).not.toContain('id=');
    expect(out).not.toContain('fixed');
    expect(out).not.toContain('inset-0');
  });

  it('keeps allowed inline styles even after class/id are stripped', () => {
    const out = sanitizeMailHtml('<p style="color: red; font-size: 14px;">hi</p>');
    expect(out).toContain('color:red');
    expect(out).toContain('font-size:14px');
  });

  it('preserves layout structure (tables, images) while dropping class/id', () => {
    const out = sanitizeMailHtml(
      '<table id="t1" class="layout"><tr><td class="cell"><img src="cid:1" alt="a" class="pic"></td></tr></table>',
    );
    expect(out).toContain('<table');
    expect(out).toContain('<tr');
    expect(out).toContain('<td');
    expect(out).toContain('src="cid:1"');
    expect(out).not.toContain('class=');
    expect(out).not.toContain('id=');
  });
});

describe('stripMailHtmlToText', () => {
  it('collapses whitespace and drops tags', () => {
    expect(stripMailHtmlToText('<p>hello\n  <b>world</b></p>')).toBe('hello world');
  });
});
