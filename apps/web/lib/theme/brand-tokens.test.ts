import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Verrou de la charte BND 2026 (spec 2026-11-13 §3) : valeurs de marque
 * exactes, rayon ≤ 3 px, zéro ombre, contraste WCAG AA des textes.
 */
const TOKENS_CSS = path.resolve(__dirname, '../../../../packages/ui/src/tokens/tokens.css');
// eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed repo path, not user input
const css = readFileSync(TOKENS_CSS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

type Rgba = readonly [number, number, number, number];
type Mode = 'light' | 'dark';

function decl(name: string): string {
  const m = new RegExp(`--${name}:\\s*([^;]+);`).exec(css);
  if (!m?.[1]) throw new Error(`token --${name} introuvable`);
  return m[1].replace(/\s+/g, ' ').trim();
}

function parseColor(value: string): Rgba {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex?.[1]) {
    const n = Number.parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const rgba = /^rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\s*\)$/.exec(value);
  if (rgba) return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), Number(rgba[4])];
  throw new Error(`couleur non reconnue : ${value}`);
}

/** Découpe `light-dark(a, b)` sur la virgule de premier niveau. */
function color(name: string, mode: Mode): Rgba {
  const value = decl(name);
  const m = /^light-dark\((.*)\)$/.exec(value);
  if (!m?.[1]) return parseColor(value);
  let depth = 0;
  let cut = -1;
  [...m[1]].forEach((ch, i) => {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    else if (ch === ',' && depth === 0 && cut < 0) cut = i;
  });
  const parts = [m[1].slice(0, cut).trim(), m[1].slice(cut + 1).trim()] as const;
  return parseColor(mode === 'light' ? parts[0] : parts[1]);
}

const over = (fg: Rgba, bg: Rgba): Rgba => [
  fg[0] * fg[3] + bg[0] * (1 - fg[3]),
  fg[1] * fg[3] + bg[1] * (1 - fg[3]),
  fg[2] * fg[3] + bg[2] * (1 - fg[3]),
  1,
];
function luminance(c: Rgba): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
}
function contrast(fg: string, bg: string, mode: Mode): number {
  const b = color(bg, mode);
  const a = luminance(over(color(fg, mode), b));
  const z = luminance(b);
  return (Math.max(a, z) + 0.05) / (Math.min(a, z) + 0.05);
}

describe('BND brand tokens', () => {
  it('uses the exact brand colours', () => {
    expect(decl('color-bg-app').toLowerCase()).toBe('light-dark(#eef0f8, #060d1f)');
    expect(decl('color-bg-sidebar').toLowerCase()).toBe('#060d1f');
    expect(decl('color-accent-primary').toLowerCase()).toBe('#ffe000');
    expect(decl('color-accent-secondary').toLowerCase()).toBe('#ff2e63');
    expect(decl('color-focus').toLowerCase()).toBe('#1a4bff');
    expect(decl('color-on-accent').toLowerCase()).toBe('#060d1f');
  });

  it('uses Inter and JetBrains Mono', () => {
    expect(decl('font-sans')).toContain('Inter');
    expect(decl('font-mono')).toContain('JetBrains Mono');
    expect(css).not.toContain('Plus Jakarta');
  });

  it('caps every radius at 3px', () => {
    const radii = [...css.matchAll(/--radius-[\w-]+:\s*([^;]+);/g)].map((m) => m[1]?.trim());
    expect(radii.length).toBeGreaterThan(8);
    for (const r of radii) expect(Number.parseFloat(r ?? '99')).toBeLessThanOrEqual(3);
  });

  it('has no shadow', () => {
    const shadows = [...css.matchAll(/--shadow-[\w-]+:\s*([^;]+);/g)].map((m) => m[1]?.trim());
    expect(shadows.length).toBeGreaterThan(6);
    for (const s of shadows) expect(s).toBe('0 0 #0000');
  });

  it.each(['light', 'dark'] as const)('keeps text at WCAG AA in %s mode', (mode) => {
    for (const bg of ['color-bg-app', 'color-bg-card', 'color-bg-card-raised']) {
      for (const fg of [
        'text-main',
        'text-soft',
        'text-muted',
        'accent-text',
        'danger',
        'info',
        'success',
        'warning',
      ]) {
        expect(
          contrast(`color-${fg}`, bg, mode),
          `${fg} sur ${bg} (${mode})`,
        ).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrast('color-text-ghost', bg, mode), `ghost sur ${bg}`).toBeGreaterThanOrEqual(3);
    }
    expect(contrast('color-on-accent', 'color-accent-primary', mode)).toBeGreaterThanOrEqual(4.5);
    expect(contrast('color-on-accent', 'color-accent-secondary', mode)).toBeGreaterThanOrEqual(4.5);
  });
});
