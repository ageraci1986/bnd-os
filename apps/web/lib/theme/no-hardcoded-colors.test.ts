import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Spec lot B §4 : aucune couleur en dur dans les composants — tout passe par
 * les tokens (`var(--color-…)`) pour suivre le thème. Exception explicite :
 * ajouter `theme-exempt: <raison>` en commentaire sur la ligne.
 */
const ROOT = path.resolve(__dirname, '../..');
const REPO = path.resolve(ROOT, '../..');
const DIRS = [
  path.join(ROOT, 'app'),
  path.join(ROOT, 'features'),
  path.join(ROOT, 'components'),
  path.join(REPO, 'packages/ui/src'),
];
const PALETTE =
  'red|gray|green|amber|slate|zinc|neutral|stone|rose|pink|fuchsia|purple|violet|indigo|blue|sky|cyan|teal|emerald|lime|yellow|orange';
const PREFIXES =
  'bg|text|border|ring|from|via|to|fill|stroke|outline|placeholder|divide|shadow|accent|caret|decoration';
const FORBIDDEN = [
  // Hex CSS (#rgb, #rgba, #rrggbb, #rrggbbaa). Le lookbehind écarte les
  // entités HTML (`&#123;`) et les identifiants ; les références de type
  // « PR #123 » sont rares dans les .tsx — exempter au besoin.
  /(?<![\w&])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/,
  // `bg-white` / `text-black` supposent un fond clair. `text-white` et les
  // voiles `bg-black/40` restent permis : posés sur une couleur de marque ou
  // un overlay, ils sont corrects dans les deux thèmes.
  /\bbg-white\b/,
  /\btext-black\b/,
  new RegExp(`\\b(?:${PREFIXES})-(?:${PALETTE})-\\d{2,3}\\b`),
  // `dark:` suit l'OS / data-theme=dark mais pas system + OS sombre :
  // utiliser les tokens light-dark() à la place.
  /(?<![\w-])dark:/,
];
const display = (file: string) => path.relative(REPO, file);

function walk(dir: string, out: string[] = []): string[] {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed test dirs, not user input
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path built from fixed test dirs
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.tsx') && !/\.(test|stories)\.tsx$/.test(p)) out.push(p);
  }
  return out;
}

describe('no hard-coded colors in components (apps/web + packages/ui)', () => {
  it('detects the forbidden patterns (self-check)', () => {
    const hit = (line: string) => FORBIDDEN.some((re) => re.test(line));
    for (const bad of [
      "color: '#fff'",
      "color: '#ffff'",
      "color: '#ffffff'",
      "color: '#ffffff80'",
      'text-[#C084FC]',
      'dark:text-white',
      'bg-purple-500',
      'fill-sky-400',
      'placeholder-stone-300',
      'divide-teal-200',
      'bg-white',
    ]) {
      expect(hit(bad), bad).toBe(true);
    }
    for (const ok of [
      'text-[color:var(--color-accent-text)]',
      'href="#section"',
      '&#123;',
      'text-white',
      'bg-black/40',
      'max-w-dark:none',
    ]) {
      expect(hit(ok), ok).toBe(false);
    }
  });

  it('uses theme tokens everywhere', () => {
    const offenders: string[] = [];
    for (const abs of DIRS) {
      try {
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed test dirs, not user input
        statSync(abs);
      } catch {
        continue;
      }
      for (const file of walk(abs)) {
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- file comes from walk() over fixed test dirs
        readFileSync(file, 'utf8')
          .split('\n')
          .forEach((line, i) => {
            if (line.includes('theme-exempt')) return;
            if (FORBIDDEN.some((re) => re.test(line))) {
              offenders.push(`${display(file)}:${i + 1}: ${line.trim()}`);
            }
          });
      }
    }
    expect(offenders).toEqual([]);
  });
});
