import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CLIENT_COLOR_TOKENS } from '@nexushub/domain';

/**
 * Tailwind v4 n'émet une variable déclarée dans `@theme` que si elle est
 * référencée statiquement quelque part. `clientColorCss` / `clientColorForeground`
 * construisent `var(--color-<token>)` / `var(--color-<token>-fg)` au runtime :
 * ces variables doivent donc vivre hors de `@theme` (ou y être maintenues en
 * vie par une référence statique hors `@theme`).
 */
const TOKENS_CSS = path.resolve(__dirname, '../../../../packages/ui/src/tokens/tokens.css');
// eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed repo path, not user input
const css = readFileSync(TOKENS_CSS, 'utf8');

/** Sépare le contenu des blocs `@theme { … }` du reste de la feuille
 *  (commentaires retirés : ils mentionnent « @theme » en prose). */
function splitTheme(source: string): { theme: string; rest: string } {
  const src = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const opener = /@theme\b[^{;]*\{/g;
  let theme = '';
  let rest = '';
  let i = 0;
  for (let m = opener.exec(src); m; m = opener.exec(src)) {
    rest += src.slice(i, m.index);
    let depth = 1;
    let j = m.index + m[0].length;
    const bodyStart = j;
    while (j < src.length && depth > 0) {
      if (src[j] === '{') depth += 1;
      else if (src[j] === '}') depth -= 1;
      j += 1;
    }
    theme += src.slice(bodyStart, j - 1);
    i = j;
    opener.lastIndex = j;
  }
  rest += src.slice(i);
  return { theme, rest };
}

const { theme, rest } = splitTheme(css);

describe('client color tokens survive Tailwind v4 tree-shaking', () => {
  it('found an @theme block (sanity)', () => {
    expect(theme).toContain('--color-bg-app:');
  });

  it.each(CLIENT_COLOR_TOKENS)('--color-%s-fg is defined outside @theme', (t) => {
    expect(rest).toContain(`--color-${t}-fg:`);
    expect(theme).not.toContain(`--color-${t}-fg:`);
  });

  it.each(CLIENT_COLOR_TOKENS)('--color-%s is kept alive by a static reference', (t) => {
    const definedOutside = rest.includes(`--color-${t}:`);
    const referencedOutside = rest.includes(`var(--color-${t})`);
    expect(definedOutside || referencedOutside).toBe(true);
  });
});
