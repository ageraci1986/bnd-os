import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Garde-fou CSS (jsdom ne calcule pas la mise en page) : la grille calendrier
 * doit borner ses colonnes à `minmax(0, 1fr)`. Avec `1fr`, les titres longs
 * (nowrap) élargissaient la grille et `overflow: hidden` masquait vendredi →
 * dimanche (régression signalée le 2026-11-12).
 */
describe('.cal-grid CSS', () => {
  it('uses minmax(0, 1fr) columns so long titles never push days out of view', () => {
    // Chemin fixe dérivé de __dirname (pas d'entrée utilisateur).
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const css = readFileSync(
      path.resolve(__dirname, '../../../../../packages/ui/src/tokens/components.css'),
      'utf8',
    );
    const rule = /\.cal-grid\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/grid-template-columns:\s*repeat\(7,\s*minmax\(0,\s*1fr\)\)/);
  });
});
