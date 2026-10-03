import { describe, expect, it } from 'vitest';
import { clientColorCss } from './client-color';

describe('clientColorCss', () => {
  it('maps a known palette token to its CSS variable', () => {
    expect(clientColorCss('c-acme')).toBe('var(--color-c-acme)');
    expect(clientColorCss('c-slate')).toBe('var(--color-c-slate)');
  });

  it('passes a valid lowercase hex color through as-is', () => {
    expect(clientColorCss('#1a2b3c')).toBe('#1a2b3c');
  });

  it('passes a valid uppercase hex color through as-is (case-insensitive)', () => {
    expect(clientColorCss('#FF0000')).toBe('#FF0000');
  });

  it('falls back to c-acme for an injection attempt disguised as a token', () => {
    expect(clientColorCss('c-x);background:url(//evil)')).toBe('var(--color-c-acme)');
  });

  it('falls back to c-acme for an injection attempt via a CSS color name', () => {
    expect(clientColorCss('red;x:y')).toBe('var(--color-c-acme)');
  });

  it('falls back to c-acme for garbage input', () => {
    expect(clientColorCss('')).toBe('var(--color-c-acme)');
    expect(clientColorCss('url(evil)')).toBe('var(--color-c-acme)');
  });
});
