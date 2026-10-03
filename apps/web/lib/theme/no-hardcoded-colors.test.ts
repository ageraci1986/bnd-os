import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Spec lot B §4 : aucune couleur en dur dans les composants — tout passe par
 * les tokens (`var(--color-…)`) pour suivre le thème. Exception explicite :
 * ajouter `theme-exempt: <raison>` en commentaire sur la ligne.
 */
const ROOT = path.resolve(__dirname, '../..');
const DIRS = ['app', 'features', 'components'];
const FORBIDDEN = [
  /#[0-9a-fA-F]{6}\b/,
  /#[0-9a-fA-F]{3}\b(?![0-9a-fA-F])/,
  /\bbg-white\b/,
  /\btext-black\b/,
  /\b(?:bg|text|border|ring|from|to)-(?:red|gray|green|amber|slate|zinc|neutral|rose|emerald|yellow|blue)-\d{2,3}\b/,
];

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

describe('no hard-coded colors in components', () => {
  it('uses theme tokens everywhere', () => {
    const offenders: string[] = [];
    for (const d of DIRS) {
      const abs = path.join(ROOT, d);
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
              offenders.push(`${path.relative(ROOT, file)}:${i + 1}: ${line.trim()}`);
            }
          });
      }
    }
    expect(offenders).toEqual([]);
  });
});
