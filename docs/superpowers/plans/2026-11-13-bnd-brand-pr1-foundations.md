# Identité BND, PR 1 : fondations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Basculer les tokens de design (couleurs, polices, rayons, ombres, dégradés, focus) sur la charte BND 2026 sans toucher à la structure des écrans.

**Architecture:** Les noms de tokens de `packages/ui/src/tokens/tokens.css` sont conservés et leurs valeurs remplacées ; `components.css` et les utilitaires Tailwind suivent. Un test lit `tokens.css` et verrouille les valeurs de marque, les rayons, les ombres et le contraste AA. Les PR 2 à 4 (composants et shell, écrans, finitions) ont chacune leur plan, écrit après la fusion de celle-ci.

**Tech Stack:** Tailwind CSS v4 (`@theme`, `light-dark()`), next/font/google (Inter, JetBrains Mono), Vitest.

**Spec:** `docs/superpowers/specs/2026-11-13-bnd-brand-identity-design.md` · **Maquettes:** `mockups/bnd/index.html`

---

## Fichiers

- Create: `apps/web/lib/theme/brand-tokens.test.ts` (verrou des tokens de marque)
- Modify: `packages/ui/src/tokens/tokens.css` (valeurs, nouveaux tokens, échelles Tailwind)
- Modify: `apps/web/app/layout.tsx` (polices, `themeColor`)
- Modify: `apps/web/styles/globals.css` (fond du `body`, focus)
- Modify: `packages/ui/src/tokens/components.css` (barre latérale en `color-scheme: dark`, texte posé sur accent)
- Modify: les `.tsx` qui posent `text-white` sur un fond d'accent (liste produite à la tâche 5)
- Modify: `CLAUDE.md`, `progress.md` (journal)

### Task 1: test de verrouillage des tokens (rouge)

**Files:** Create `apps/web/lib/theme/brand-tokens.test.ts`

- [ ] **Step 1: écrire le test**

```ts
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
```

- [ ] **Step 2: vérifier l'échec**

Run: `pnpm --filter web exec vitest run lib/theme/brand-tokens.test.ts`
Expected: FAIL (`token --color-focus introuvable`, valeurs violettes).

### Task 2: valeurs des tokens (vert)

**Files:** Modify `packages/ui/src/tokens/tokens.css`

- [ ] **Step 1: remplacer dans `@theme` les blocs Canvas, Text, Borders, Brand, Semantic, Typography, Radius par :**

```css
/* — Canvas (charte BND 2026 : Ice / Cobalt) — */
--color-bg-app: light-dark(#eef0f8, #060d1f);
--color-bg-sidebar: #060d1f;
--color-bg-card: light-dark(#f8f9fd, #0a1330);
--color-bg-card-raised: light-dark(#f8f9fd, #161e3a);
--color-bg-card-alt: light-dark(rgba(6, 13, 31, 0.07), rgba(238, 240, 248, 0.035));
--color-bg-hover: light-dark(rgba(6, 13, 31, 0.045), rgba(238, 240, 248, 0.05));
--color-bg-muted: light-dark(rgba(6, 13, 31, 0.07), rgba(238, 240, 248, 0.035));

/* — Text — */
--color-text-main: light-dark(#060d1f, #eef0f8);
--color-text-soft: light-dark(rgba(6, 13, 31, 0.82), rgba(238, 240, 248, 0.82));
--color-text-muted: light-dark(rgba(6, 13, 31, 0.66), rgba(238, 240, 248, 0.64));
--color-text-ghost: light-dark(rgba(6, 13, 31, 0.5), rgba(238, 240, 248, 0.42));
--color-sidebar-fg: #eef0f8;

/* — Borders : filets, jamais d'ombre — */
--color-border-light: light-dark(rgba(6, 13, 31, 0.13), rgba(238, 240, 248, 0.1));
--color-border-soft: light-dark(rgba(6, 13, 31, 0.08), rgba(238, 240, 248, 0.06));
--color-border-strong: light-dark(rgba(6, 13, 31, 0.22), rgba(238, 240, 248, 0.22));

/* — Brand — */
--color-accent-primary: #ffe000;
--color-accent-secondary: #ff2e63;
--color-brand-blue: #1a4bff;
--color-focus: #1a4bff;
/* Texte posé sur un aplat jaune ou plasma */
--color-on-accent: #060d1f;
/* Texte d'accent (liens, sur-titres) : bleu sur Ice, jaune sur Cobalt */
--color-accent-text: light-dark(#1a4bff, #ffe000);

/* — Semantic : la charte n'a ni vert ni orange — */
--color-success: light-dark(#060d1f, #eef0f8);
--color-success-bg: light-dark(rgba(6, 13, 31, 0.07), rgba(238, 240, 248, 0.08));
--color-warning: light-dark(#060d1f, #ffe000);
--color-warning-bg: light-dark(#ffe000, rgba(255, 224, 0, 0.12));
--color-danger: light-dark(#d4144a, #ff2e63);
--color-danger-bg: light-dark(rgba(255, 46, 99, 0.12), rgba(255, 46, 99, 0.14));
--color-info: light-dark(#1a4bff, #7c9bff);
--color-info-bg: light-dark(rgba(26, 75, 255, 0.1), rgba(26, 75, 255, 0.22));
```

(le bloc « Client palette » reste inchangé), puis :

```css
/* — Typography — */
--font-sans: 'Inter', system-ui, sans-serif;
--font-mono: 'JetBrains Mono', ui-monospace, monospace;

/* — Radius : limite de la charte, 2 px partout (échelle Tailwind comprise) — */
--radius-xs: 2px;
--radius-sm: 2px;
--radius-md: 2px;
--radius-lg: 2px;
--radius-xl: 2px;
--radius-2xl: 2px;
--radius-3xl: 2px;
--radius-4xl: 2px;
--radius-pill: 2px;

/* — Shadows : aucune (valeur neutre, valide dans la pile box-shadow de Tailwind) — */
--shadow-2xs: 0 0 #0000;
--shadow-xs: 0 0 #0000;
--shadow-sm: 0 0 #0000;
--shadow-md: 0 0 #0000;
--shadow-lg: 0 0 #0000;
--shadow-xl: 0 0 #0000;
--shadow-2xl: 0 0 #0000;
```

- [ ] **Step 2: dans le bloc `:root` des alias, remplacer dégradés, ombres et verre par :**

```css
--accent-gradient: linear-gradient(#ffe000, #ffe000);
--accent-gradient-soft: linear-gradient(
  light-dark(rgba(6, 13, 31, 0.07), rgba(238, 240, 248, 0.06)),
  light-dark(rgba(6, 13, 31, 0.07), rgba(238, 240, 248, 0.06))
);
--aurora: linear-gradient(90deg, #1a4bff 0 25%, #6537ff 25% 50%, #ff2e63 50% 75%, #ffe000 75% 100%);
--shadow-card: 0 0 #0000;
--shadow-hover: 0 0 #0000;
--shadow-lg: 0 0 #0000;
--glass-bg: var(--color-bg-app);
```

et ajouter les alias `--bg-card-raised`, `--border-strong`, `--on-accent`, `--focus` pointant vers les tokens `--color-*` correspondants. Si `--shadow-lg` est alors déclaré deux fois dans `:root`, ne garder que celle de `@theme`.

- [ ] **Step 3: relancer le test**

Run: `pnpm --filter web exec vitest run lib/theme/brand-tokens.test.ts lib/theme/dynamic-tokens.test.ts`
Expected: PASS. Si un contraste échoue, ajuster l'opacité du token concerné (jamais la valeur d'un aplat de marque) et reporter la valeur dans le spec §3.2.

- [ ] **Step 4: commit** `feat(ui): tokens de la charte BND 2026`

### Task 3: polices

**Files:** Modify `apps/web/app/layout.tsx`

- [ ] **Step 1: remplacer l'import et la déclaration de police par :**

```tsx
import { Inter, JetBrains_Mono } from 'next/font/google';

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800', '900'],
  variable: '--font-sans',
  display: 'swap',
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-mono',
  display: 'swap',
});
```

`<html className={`${inter.variable} ${jetbrainsMono.variable}`} …>` ; `themeColor` : `#EEF0F8` (clair) et `#060D1F` (sombre), en gardant les commentaires `theme-exempt`.

- [ ] **Step 2:** `pnpm --filter web typecheck` → 0 erreur.
- [ ] **Step 3: commit** `feat(web): polices Inter et JetBrains Mono`

### Task 4: fond, focus, barre latérale

**Files:** Modify `apps/web/styles/globals.css`, `packages/ui/src/tokens/components.css`

- [ ] **Step 1:** dans `globals.css`, supprimer le bloc `body { background-image: … }` et remplacer la couleur du focus par `var(--color-focus)`.
- [ ] **Step 2:** dans `components.css`, ajouter à la règle `.sidebar` : `color-scheme: dark;` avec le commentaire « Barre latérale toujours Cobalt : light-dark() y résout les valeurs sombres, quel que soit le thème. »
- [ ] **Step 3: commit** `feat(ui): fond uni, focus bleu, barre latérale Cobalt`

### Task 5: texte posé sur accent

L'accent passe du violet au jaune : tout texte blanc posé dessus devient illisible.

- [ ] **Step 1: recenser**

```bash
grep -rn "text-white" apps/web/app apps/web/components apps/web/features packages/ui/src --include='*.tsx' | grep -v '\.test\.\|stories'
grep -n "color: #fff\|color: white\|color: #ffffff" packages/ui/src/tokens/components.css
```

- [ ] **Step 2:** pour chaque occurrence dont le fond est `accent-primary`, `accent-secondary`, `accent-gradient`, `warning` ou `danger` (classe ou `style`), remplacer `text-white` par `text-[color:var(--color-on-accent)]` et `color: #fff` par `color: var(--on-accent)`. Laisser tel quel le blanc posé sur `brand-blue`, `info`, une couleur client (géré par `clientColorForeground`) ou un voile noir.
- [ ] **Step 3:** `pnpm --filter web test` et `pnpm --filter @nexushub/ui test` → PASS (mettre à jour les assertions de classe qui lisaient `text-white`).
- [ ] **Step 4: commit** `fix(ui): texte Cobalt sur les aplats jaune et plasma`

### Task 6: vérification visuelle et docs

- [ ] **Step 1:** lancer l'app (`pnpm --filter web dev`), capturer avec Playwright login, overview, kanban, calendrier dans les deux thèmes ; relire chaque capture : aucun texte illisible, aucune ombre, aucun coin arrondi au-delà de 2 px hors `rounded-full` (traité en PR 2).
- [ ] **Step 2:** `CLAUDE.md` §2 (Inter + JetBrains Mono, tokens depuis `mockups/bnd/`) et ligne de journal ; `progress.md`.
- [ ] **Step 3:** `pnpm ci:local` vert, push, PR « feat(ui): fondations identité BND 2026 ».
