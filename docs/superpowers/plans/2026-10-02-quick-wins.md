# Lot A — Quick wins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Renommage inline des projets, widget + bascule « Mes cartes », palette clients 12 tokens + couleur libre, cartes terminées barrées dans le calendrier.

**Architecture:** Règles pures dans `packages/domain` (dernière colonne par projet, couleurs clients + contraste), consommées par les Server Components / Server Actions de `apps/web`. Aucun changement de schéma DB. L'id utilisateur du filtre « Mes cartes » vient toujours de la session.

**Tech Stack:** Next.js 15 (App Router, Server Actions), React 19, Prisma 6, Vitest + Testing Library, Tailwind v4 + `components.css`.

**Spec :** `docs/superpowers/specs/2026-10-02-quick-wins-design.md`

**Conventions repo :**
- Lancer les tests web : `pnpm --filter @nexushub/web exec vitest run <chemin>` ; domain : `pnpm --filter @nexushub/domain exec vitest run <chemin>`.
- Avant commit : `pnpm --filter <pkg> typecheck`.
- Commits Conventional, terminés par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Textes UI : FR en dur, comme les fichiers voisins.

---

## File Structure

| Fichier | Rôle |
| --- | --- |
| `packages/domain/src/kanban/index.ts` (mod) | + `lastUserColumnIds` |
| `packages/domain/src/clients/index.ts` (mod) | 12 tokens, labels, `isValidClientColor`, `clientColorCss`, `clientColorForeground` |
| `packages/ui/src/tokens/tokens.css` (mod) | 7 nouvelles couleurs (clair + sombre) |
| `packages/ui/src/tokens/components.css` (mod) | `.cal-item` sans classes par client, `.cal-item.done` |
| `packages/ui/src/atoms/ClientDot.tsx` (mod) | type union étendu |
| `apps/web/features/clients/lib/schemas.ts` (mod) | Zod couleur token \| hex |
| `apps/web/features/clients/components/client-form.tsx` (mod) | 12 pastilles + « + » couleur libre |
| `apps/web/features/clients/components/client-mono.tsx` (mod) | rendu via helpers domain |
| 8 fichiers consommateurs `var(--${colorToken})` (mod) | `clientColorCss()` |
| `apps/web/features/projects/lib/card-filter.ts` (mod) | param `mine`, clauses avec userId |
| `apps/web/features/projects/components/my-cards-toggle.tsx` (new) | bascule `?mine=1` |
| `apps/web/features/projects/components/project-filters-bar.tsx` (mod) | rend la bascule, reset |
| `apps/web/features/projects/components/calendar-view.tsx` / `calendar-item.tsx` (mod) | `isDone`, `extraParams` nav mois |
| `apps/web/app/(app)/projects/calendar/page.tsx` (mod) | `mine`, `isDone`, bascule |
| `apps/web/app/(app)/projects/[id]/{page,list/page,calendar/page}.tsx` (mod) | userId au filtre, `isDone`, éditeur de titre |
| `apps/web/features/overview/lib/my-cards.ts` (new) | `getMyCardsMetrics` |
| `apps/web/app/(app)/overview/page.tsx` (mod) | widget « Mes cartes » |
| `apps/web/features/projects/actions/rename-project.ts` (new) | Server Action |
| `apps/web/features/projects/components/project-title-editor.tsx` (new) | édition inline |
| `apps/web/app/(app)/projects/page.tsx` (mod) | carte en « stretched link » + éditeur |

---

### Task 1: Domain — `lastUserColumnIds`

**Files:**
- Modify: `packages/domain/src/kanban/index.ts` (après `isLastUserColumn`, ~L48)
- Test: `packages/domain/src/kanban/kanban.test.ts`

- [ ] **Step 1: Write the failing test** — ajouter en fin de `kanban.test.ts` (ajouter `lastUserColumnIds` à l'import existant depuis `./index`) :

```ts
describe('lastUserColumnIds', () => {
  const col = (id: string, projectId: string, position: number, isBlockedSystem = false) => ({
    id,
    projectId,
    position,
    isBlockedSystem,
    name: id,
  });

  it('returns the highest-position non-blocked column of each project', () => {
    const ids = lastUserColumnIds([
      col('a1', 'p1', 1),
      col('a3', 'p1', 3),
      col('a2', 'p1', 2),
      col('ab', 'p1', 99, true),
      col('b1', 'p2', 10),
      col('b0', 'p2', 5),
    ]);
    expect([...ids].sort()).toEqual(['a3', 'b1']);
  });

  it('ignores projects that only have the blocked column', () => {
    expect(lastUserColumnIds([col('x', 'p1', 1, true)])).toEqual([]);
  });

  it('returns an empty list for no columns', () => {
    expect(lastUserColumnIds([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @nexushub/domain exec vitest run src/kanban/kanban.test.ts`
Expected: FAIL — `lastUserColumnIds is not a function` / not exported.

- [ ] **Step 3: Implement** — dans `packages/domain/src/kanban/index.ts`, juste après `isLastUserColumn` :

```ts
export interface ProjectColumnRef extends Column {
  readonly projectId: string;
}

/**
 * Id de la dernière colonne utilisateur (hors « Bloqué ») de chaque projet
 * présent dans `columns`. Sert à exclure / marquer les cartes « terminées »
 * sans charger les projets un par un (Overview, calendrier global).
 */
export function lastUserColumnIds(columns: readonly ProjectColumnRef[]): string[] {
  const best = new Map<string, ProjectColumnRef>();
  for (const c of columns) {
    if (c.isBlockedSystem) continue;
    const current = best.get(c.projectId);
    if (!current || c.position > current.position) best.set(c.projectId, c);
  }
  return [...best.values()].map((c) => c.id);
}
```

- [ ] **Step 4: Run test to verify it passes** — même commande, Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/kanban
git commit -m "feat(domain): lastUserColumnIds helper per project"
```

---

### Task 2: Domain — palette clients + contraste

**Files:**
- Modify: `packages/domain/src/clients/index.ts` (section « Color tokens », L9-16)
- Test: `packages/domain/src/clients/clients.test.ts` (bloc `describe('CLIENT_COLOR_TOKENS')`, L18-29)

- [ ] **Step 1: Write the failing tests** — remplacer le bloc `describe('CLIENT_COLOR_TOKENS', …)` par ce qui suit, et ajouter `CLIENT_COLOR_LABELS_FR, isValidClientColor, clientColorCss, clientColorForeground` à l'import :

```ts
describe('CLIENT_COLOR_TOKENS', () => {
  it('exposes the 12 design tokens used across the UI', () => {
    expect(CLIENT_COLOR_TOKENS).toEqual([
      'c-acme',
      'c-tech',
      'c-nova',
      'c-lumen',
      'c-orbit',
      'c-red',
      'c-orange',
      'c-lime',
      'c-teal',
      'c-cyan',
      'c-indigo',
      'c-slate',
    ]);
  });

  it('has a French label for every token', () => {
    for (const t of CLIENT_COLOR_TOKENS) expect(CLIENT_COLOR_LABELS_FR[t]).toBeTruthy();
  });

  it('isValidColorToken accepts known tokens and rejects others', () => {
    expect(isValidColorToken('c-acme')).toBe(true);
    expect(isValidColorToken('c-slate')).toBe(true);
    expect(isValidColorToken('c-bogus')).toBe(false);
    expect(isValidColorToken('')).toBe(false);
  });
});

describe('isValidClientColor', () => {
  it('accepts tokens and lowercase #rrggbb', () => {
    expect(isValidClientColor('c-teal')).toBe(true);
    expect(isValidClientColor('#1a2b3c')).toBe(true);
  });
  it('rejects shorthand, uppercase, names and garbage', () => {
    expect(isValidClientColor('#abc')).toBe(false);
    expect(isValidClientColor('#ABCDEF')).toBe(false);
    expect(isValidClientColor('red')).toBe(false);
    expect(isValidClientColor('var(--x)')).toBe(false);
    expect(isValidClientColor(42)).toBe(false);
  });
});

describe('clientColorCss', () => {
  it('maps a token to its CSS variable', () => {
    expect(clientColorCss('c-nova')).toBe('var(--color-c-nova)');
  });
  it('passes a valid hex through', () => {
    expect(clientColorCss('#123456')).toBe('#123456');
  });
  it('falls back to c-acme for unknown values', () => {
    expect(clientColorCss('url(evil)')).toBe('var(--color-c-acme)');
  });
});

describe('clientColorForeground', () => {
  it('uses black text on light colors', () => {
    expect(clientColorForeground('#ffff00')).toBe('#000000');
    expect(clientColorForeground('c-lime')).toBe('#000000');
  });
  it('uses white text on dark colors', () => {
    expect(clientColorForeground('#101010')).toBe('#ffffff');
    expect(clientColorForeground('c-indigo')).toBe('#ffffff');
  });
  it('defaults to white for unknown values', () => {
    expect(clientColorForeground('nope')).toBe('#ffffff');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @nexushub/domain exec vitest run src/clients/clients.test.ts`
Expected: FAIL (12 tokens attendus, nouveaux exports absents).

- [ ] **Step 3: Implement** — remplacer la section « Color tokens » de `packages/domain/src/clients/index.ts` par :

```ts
// ---------- Color tokens ----------------------------------------------------

/**
 * Palette workspace. Valeurs CSS dans `packages/ui/src/tokens/tokens.css`
 * (`--color-<token>`, clair + `[data-theme='dark']`). Un client peut aussi
 * porter une couleur libre `#rrggbb` (même colonne `colorToken`).
 */
export const CLIENT_COLOR_TOKENS = [
  'c-acme',
  'c-tech',
  'c-nova',
  'c-lumen',
  'c-orbit',
  'c-red',
  'c-orange',
  'c-lime',
  'c-teal',
  'c-cyan',
  'c-indigo',
  'c-slate',
] as const;
export type ClientColorToken = (typeof CLIENT_COLOR_TOKENS)[number];

export const CLIENT_COLOR_LABELS_FR: Readonly<Record<ClientColorToken, string>> = {
  'c-acme': 'Rose',
  'c-tech': 'Bleu',
  'c-nova': 'Vert',
  'c-lumen': 'Ambre',
  'c-orbit': 'Violet',
  'c-red': 'Rouge',
  'c-orange': 'Orange',
  'c-lime': 'Lime',
  'c-teal': 'Sarcelle',
  'c-cyan': 'Cyan',
  'c-indigo': 'Indigo',
  'c-slate': 'Ardoise',
};

/** Valeurs claires de `tokens.css` — utilisées uniquement pour le calcul de contraste. */
const CLIENT_TOKEN_HEX: Readonly<Record<ClientColorToken, string>> = {
  'c-acme': '#ff2a6d',
  'c-tech': '#2563eb',
  'c-nova': '#059669',
  'c-lumen': '#f59e0b',
  'c-orbit': '#8b2be2',
  'c-red': '#dc2626',
  'c-orange': '#ea580c',
  'c-lime': '#65a30d',
  'c-teal': '#0d9488',
  'c-cyan': '#0891b2',
  'c-indigo': '#4f46e5',
  'c-slate': '#475569',
};

const CLIENT_HEX_RE = /^#[0-9a-f]{6}$/;

export function isValidColorToken(value: unknown): value is ClientColorToken {
  return typeof value === 'string' && (CLIENT_COLOR_TOKENS as readonly string[]).includes(value);
}

/** Token de la palette OU couleur libre `#rrggbb` (minuscules). */
export function isValidClientColor(value: unknown): value is string {
  return isValidColorToken(value) || (typeof value === 'string' && CLIENT_HEX_RE.test(value));
}

/** Valeur CSS sûre à injecter dans un `style` (jamais la chaîne brute si invalide). */
export function clientColorCss(value: string): string {
  if (isValidColorToken(value)) return `var(--color-${value})`;
  if (CLIENT_HEX_RE.test(value)) return value;
  return 'var(--color-c-acme)';
}

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = channel((n >> 16) & 255);
  const g = channel((n >> 8) & 255);
  const b = channel(n & 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Noir ou blanc, celui qui offre le meilleur contraste WCAG sur la couleur du client. */
export function clientColorForeground(value: string): '#000000' | '#ffffff' {
  const hex = isValidColorToken(value)
    ? CLIENT_TOKEN_HEX[value]
    : CLIENT_HEX_RE.test(value)
      ? value
      : null;
  if (hex === null) return '#ffffff';
  const l = relativeLuminance(hex);
  const contrastWhite = 1.05 / (l + 0.05);
  const contrastBlack = (l + 0.05) / 0.05;
  return contrastBlack > contrastWhite ? '#000000' : '#ffffff';
}
```

- [ ] **Step 4: Run tests** — même commande + `pnpm --filter @nexushub/domain test` (coverage 100 % domain). Expected: PASS. Si `c-lime` sort en blanc, vérifier la formule (L(#65a30d) ≈ 0.29 → noir).

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/clients
git commit -m "feat(domain): 12-token client palette, custom hex colors, contrast helper"
```

---

### Task 3: CSS — nouvelles couleurs + calendrier

**Files:**
- Modify: `packages/ui/src/tokens/tokens.css` (L41-45, L94-98, L150-154)
- Modify: `packages/ui/src/tokens/components.css` (L1857-1881)
- Modify: `packages/ui/src/atoms/ClientDot.tsx` (L3)

- [ ] **Step 1: tokens.css clair** — après `--color-c-orbit: #8b2be2;` (L45) :

```css
  --color-c-red: #dc2626;
  --color-c-orange: #ea580c;
  --color-c-lime: #65a30d;
  --color-c-teal: #0d9488;
  --color-c-cyan: #0891b2;
  --color-c-indigo: #4f46e5;
  --color-c-slate: #475569;
```

- [ ] **Step 2: tokens.css alias** — après `--c-orbit: var(--color-c-orbit);` :

```css
  --c-red: var(--color-c-red);
  --c-orange: var(--color-c-orange);
  --c-lime: var(--color-c-lime);
  --c-teal: var(--color-c-teal);
  --c-cyan: var(--color-c-cyan);
  --c-indigo: var(--color-c-indigo);
  --c-slate: var(--color-c-slate);
```

- [ ] **Step 3: tokens.css sombre** — dans le bloc `[data-theme='dark']`, après `--color-c-orbit: #c084fc;` :

```css
  --color-c-red: #f87171;
  --color-c-orange: #fb923c;
  --color-c-lime: #a3e635;
  --color-c-teal: #2dd4bf;
  --color-c-cyan: #22d3ee;
  --color-c-indigo: #818cf8;
  --color-c-slate: #94a3b8;
```

- [ ] **Step 4: components.css** — remplacer les 5 règles `.cal-item.i-acme` … `.cal-item.i-orbit` (L1857-1876) par rien (la couleur passe en style inline, Task 7), et ajouter après `.cal-item.blocked { … }` :

```css
.cal-item.done {
  text-decoration: line-through;
  opacity: 0.55;
}
```

- [ ] **Step 5: ClientDot type** — `packages/ui/src/atoms/ClientDot.tsx` L3 :

```ts
export type ClientColorToken =
  | 'c-acme'
  | 'c-tech'
  | 'c-nova'
  | 'c-lumen'
  | 'c-orbit'
  | 'c-red'
  | 'c-orange'
  | 'c-lime'
  | 'c-teal'
  | 'c-cyan'
  | 'c-indigo'
  | 'c-slate';
```

- [ ] **Step 6: Verify** — `grep -rn "i-acme\|i-orbit" apps/web/features apps/web/app packages/ui/src` → seul `calendar-item.tsx` doit encore matcher (corrigé Task 7). `pnpm --filter @nexushub/ui typecheck` → PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/ui
git commit -m "feat(ui): 7 new client color tokens (light+dark), calendar done style"
```

---

### Task 4: Clients — validation, formulaire, rendu

**Files:**
- Modify: `apps/web/features/clients/lib/schemas.ts` (L9-19)
- Test: `apps/web/features/clients/lib/schemas.test.ts`
- Modify: `apps/web/features/clients/components/client-form.tsx`
- Modify: `apps/web/features/clients/components/client-mono.tsx`
- Modify (consommateurs `var(--${…colorToken})`) : `apps/web/app/(app)/projects/page.tsx:112`, `apps/web/app/(app)/projects/[id]/page.tsx:283`, `apps/web/app/(app)/projects/[id]/list/page.tsx:196`, `apps/web/app/(app)/projects/[id]/calendar/page.tsx:164`, `apps/web/app/(app)/my-projects/page.tsx:66`, `apps/web/features/communications/components/mail-list.tsx:130,135`, `apps/web/features/communications/components/mail-reader.tsx:93,98`, `apps/web/features/projects/components/calendar-view.tsx` (`LegendItem`)

- [ ] **Step 1: Failing test** — ajouter dans `schemas.test.ts` (à côté de `'rejects an unknown colorToken'`, en réutilisant le même objet d'entrée que ce test et en ne changeant que `colorToken`) :

```ts
  it('accepts a custom hex color and lowercases it', () => {
    const res = CreateClientSchema.safeParse({ ...validCreateInput, colorToken: '#1A2B3C' });
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.colorToken).toBe('#1a2b3c');
  });

  it('accepts one of the new palette tokens', () => {
    expect(CreateClientSchema.safeParse({ ...validCreateInput, colorToken: 'c-teal' }).success).toBe(true);
  });

  it('rejects a CSS injection attempt as color', () => {
    expect(
      CreateClientSchema.safeParse({ ...validCreateInput, colorToken: 'red;background:url(x)' }).success,
    ).toBe(false);
  });
```

(`validCreateInput` : si le fichier n'a pas de constante partagée, en créer une en tête à partir de l'objet du premier test : `{ name: 'Acme', colorToken: 'c-acme', initials: '', domains: '', notes: '' }` — copier les clés exactes du premier test.)

- [ ] **Step 2: Run** — `pnpm --filter @nexushub/web exec vitest run features/clients/lib/schemas.test.ts` → FAIL (hex refusé).

- [ ] **Step 3: Implement schema** — dans `schemas.ts`, remplacer `CLIENT_COLOR_TOKENS,` par `isValidClientColor,` dans l'import, puis :

```ts
const ClientColorSchema = z
  .string()
  .trim()
  .toLowerCase()
  .refine(isValidClientColor, { message: 'Couleur invalide' });
```

- [ ] **Step 4: Run** — même commande → PASS. `grep -n CLIENT_COLOR_TOKENS apps/web/features/clients/lib/schemas.ts` → aucun résultat restant (sinon remettre l'import).

- [ ] **Step 5: client-form** — supprimer la constante locale `COLOR_TOKENS` (L11-17). Ajouter aux imports :

```ts
import { useRef } from 'react';
import {
  CLIENT_COLOR_LABELS_FR,
  CLIENT_COLOR_TOKENS,
  clientColorCss,
  clientColorForeground,
  isValidColorToken,
} from '@nexushub/domain';
```

(fusionner `useRef` dans l'import React existant.) Remplacer le bloc `<div className="mt-1 flex gap-2"> … </div>` des pastilles dans `Fields` par :

```tsx
        <div className="mt-1 flex flex-wrap gap-2">
          {CLIENT_COLOR_TOKENS.map((token) => (
            <ColorSwatch
              key={token}
              value={token}
              label={CLIENT_COLOR_LABELS_FR[token]}
              selected={color === token}
              onSelect={() => setColor(token)}
            />
          ))}
          <CustomColorButton value={color} onChange={setColor} />
        </div>
```

et ajouter, sous `Fields` :

```tsx
function ColorSwatch({
  value,
  label,
  selected,
  onSelect,
}: {
  value: string;
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={label}
      aria-pressed={selected}
      title={label}
      className="grid h-9 w-9 place-items-center rounded-full transition"
      style={{
        background: clientColorCss(value),
        outline: selected ? '2px solid var(--color-text-main)' : '2px solid transparent',
        outlineOffset: 2,
      }}
    >
      {selected ? (
        <span aria-hidden="true" style={{ color: clientColorForeground(value) }}>
          ✓
        </span>
      ) : null}
    </button>
  );
}

/** « + » : ouvre le sélecteur natif ; une couleur libre devient la sélection. */
function CustomColorButton({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const isCustom = !isValidColorToken(value);
  const open = () => {
    const el = inputRef.current;
    if (!el) return;
    if (typeof el.showPicker === 'function') el.showPicker();
    else el.click();
  };
  return (
    <>
      <button
        type="button"
        onClick={open}
        aria-label="Couleur personnalisée"
        aria-pressed={isCustom}
        title="Couleur personnalisée"
        className="grid h-9 w-9 place-items-center rounded-full border border-dashed border-[color:var(--color-border-light)] text-[color:var(--color-text-soft)] transition"
        style={
          isCustom
            ? {
                background: clientColorCss(value),
                color: clientColorForeground(value),
                borderStyle: 'solid',
                outline: '2px solid var(--color-text-main)',
                outlineOffset: 2,
              }
            : undefined
        }
      >
        <span aria-hidden="true">{isCustom ? '✓' : '+'}</span>
      </button>
      <input
        ref={inputRef}
        type="color"
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
        value={isCustom ? value : '#888888'}
        onChange={(e) => onChange(e.target.value.toLowerCase())}
      />
    </>
  );
}
```

- [ ] **Step 6: client-mono** — remplacer `FALLBACK_GRADIENT`, `GRADIENTS` et le calcul de `background` par :

```tsx
import { clientColorCss, clientColorForeground } from '@nexushub/domain';
// …
  const base = clientColorCss(colorToken);
  const background = `linear-gradient(135deg, ${base}, color-mix(in srgb, ${base} 65%, white))`;
```

et remplacer la classe `text-white` par `style={{ …, color: clientColorForeground(colorToken) }}` (ajouter `color` dans l'objet `style` existant, retirer `text-white` de `className`).

- [ ] **Step 7: Consommateurs** — dans chaque fichier listé ci-dessus, importer `clientColorCss` depuis `@nexushub/domain` et remplacer :
  - `` `var(--${X.colorToken})` `` → `clientColorCss(X.colorToken)` (en gardant la même propriété `background`/`color`) ;
  - dans `calendar-view.tsx` `LegendItem` : `style={{ background: clientColorCss(token) }}`.

Vérifier : `grep -rn 'var(--\${' apps/web/app apps/web/features` → aucun résultat lié à `colorToken`.

- [ ] **Step 8: Verify** — `pnpm --filter @nexushub/web typecheck` puis `pnpm --filter @nexushub/web exec vitest run features/clients` → PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/web
git commit -m "feat(clients): 12-color palette + custom color picker, unified client color rendering"
```

---

### Task 5: Filtre `mine` (card-filter)

**Files:**
- Modify: `apps/web/features/projects/lib/card-filter.ts`
- Create: `apps/web/features/projects/lib/card-filter.test.ts`

- [ ] **Step 1: Failing test** — créer `card-filter.test.ts` :

```ts
import { describe, expect, it, vi } from 'vitest';

vi.mock('@nexushub/db', () => ({}));

import {
  EMPTY_PROJECT_CARD_FILTER,
  activeFilterCount,
  buildCardFilterClauses,
  parseProjectCardFilter,
  writeProjectCardFilter,
} from './card-filter';

const ME = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';

describe('mine param', () => {
  it('parses mine=1 and ignores other values', () => {
    expect(parseProjectCardFilter({ mine: '1' }).mine).toBe(true);
    expect(parseProjectCardFilter({ mine: 'true' }).mine).toBe(false);
    expect(parseProjectCardFilter({}).mine).toBe(false);
  });

  it('writes and clears mine while preserving unrelated params', () => {
    const on = writeProjectCardFilter(new URLSearchParams('client=acme'), {
      ...EMPTY_PROJECT_CARD_FILTER,
      mine: true,
    });
    expect(on.get('mine')).toBe('1');
    expect(on.get('client')).toBe('acme');
    const off = writeProjectCardFilter(on, EMPTY_PROJECT_CARD_FILTER);
    expect(off.has('mine')).toBe(false);
  });

  it('is not counted in the Filtres badge (the toggle shows its own state)', () => {
    expect(activeFilterCount({ ...EMPTY_PROJECT_CARD_FILTER, mine: true })).toBe(0);
  });
});

describe('buildCardFilterClauses with mine', () => {
  it('scopes to the session user, never a URL value', () => {
    const where = buildCardFilterClauses({ ...EMPTY_PROJECT_CARD_FILTER, mine: true }, ME);
    expect(where).toEqual({ assignees: { some: { userId: ME } } });
  });

  it('ANDs mine with an explicit assignee filter', () => {
    const where = buildCardFilterClauses(
      { ...EMPTY_PROJECT_CARD_FILTER, mine: true, assigneeIds: [OTHER] },
      ME,
    );
    expect(where).toEqual({
      AND: [
        { assignees: { some: { userId: { in: [OTHER] } } } },
        { assignees: { some: { userId: ME } } },
      ],
    });
  });

  it('adds nothing when mine is off', () => {
    expect(buildCardFilterClauses(EMPTY_PROJECT_CARD_FILTER, ME)).toEqual({});
  });
});
```

- [ ] **Step 2: Run** — `pnpm --filter @nexushub/web exec vitest run features/projects/lib/card-filter.test.ts` → FAIL.

- [ ] **Step 3: Implement** dans `card-filter.ts` :
  - Doc d'en-tête : ajouter la ligne ` *   mine — '1' → seulement les cartes assignées à l'utilisateur de la session`.
  - `ProjectCardFilter` : ajouter `readonly mine: boolean;` ; `EMPTY_PROJECT_CARD_FILTER` : `mine: false,`.
  - `parseProjectCardFilter` : ajouter `mine: readKey(sp, 'mine') === '1',`.
  - `writeProjectCardFilter` : ajouter `setOrDelete('mine', filter.mine ? '1' : '');`.
  - `activeFilterCount` : inchangé (mine volontairement exclu).
  - `buildCardFilterClauses` : nouvelle signature et bloc assignés :

```ts
/**
 * `viewerUserId` provient TOUJOURS de la session (`requireUser`) — c'est lui
 * qui matérialise `mine`, jamais une valeur lue dans l'URL.
 */
export function buildCardFilterClauses(
  filter: ProjectCardFilter,
  viewerUserId: string,
): Prisma.CardWhereInput {
```

remplacer le bloc `if (filter.assigneeIds.length > 0) { … }` par :

```ts
  const assigneeClauses: Prisma.CardWhereInput[] = [];
  if (filter.assigneeIds.length > 0) {
    assigneeClauses.push({ assignees: { some: { userId: { in: [...filter.assigneeIds] } } } });
  }
  if (filter.mine) assigneeClauses.push({ assignees: { some: { userId: viewerUserId } } });
  if (assigneeClauses.length === 1) Object.assign(where, assigneeClauses[0]);
  else if (assigneeClauses.length > 1) where.AND = assigneeClauses;
```

  - `BuildCardWhereOptions` : ajouter `readonly viewerUserId: string;` et dans `buildCardWhere` appeler `buildCardFilterClauses(filter, opts.viewerUserId)`.

- [ ] **Step 4: Callers** — dans `apps/web/app/(app)/projects/[id]/page.tsx:60` et `[id]/list/page.tsx:37` : `buildCardFilterClauses(filter, ctx.userId)`. Le calendrier projet est traité Task 7.

- [ ] **Step 5: Run** — test → PASS ; `pnpm --filter @nexushub/web typecheck` → seule erreur restante attendue : `[id]/calendar/page.tsx` (Task 7). Si `buildCardWhere` a d'autres appelants, leur passer `viewerUserId: ctx.userId`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/features/projects/lib apps/web/app/\(app\)/projects/\[id\]/page.tsx apps/web/app/\(app\)/projects/\[id\]/list/page.tsx
git commit -m "feat(projects): mine card filter scoped to the session user"
```

---

### Task 6: Bascule `MyCardsToggle`

**Files:**
- Create: `apps/web/features/projects/components/my-cards-toggle.tsx`
- Create: `apps/web/features/projects/components/my-cards-toggle.test.tsx`
- Modify: `apps/web/features/projects/components/project-filters-bar.tsx` (L57-65 `clear`, L153 avant le `<div ref={popRef}`)

- [ ] **Step 1: Failing test**

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const replace = vi.fn();
let search = 'client=acme';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => '/projects/calendar',
  useSearchParams: () => new URLSearchParams(search),
}));

import { MyCardsToggle } from './my-cards-toggle';

beforeEach(() => replace.mockReset());

describe('<MyCardsToggle />', () => {
  it('turns mine on and keeps other params', () => {
    search = 'client=acme';
    render(<MyCardsToggle />);
    const btn = screen.getByRole('button', { name: /mes cartes/i });
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(btn);
    expect(replace).toHaveBeenCalledWith('/projects/calendar?client=acme&mine=1', { scroll: false });
  });

  it('turns mine off', () => {
    search = 'mine=1';
    render(<MyCardsToggle />);
    const btn = screen.getByRole('button', { name: /mes cartes/i });
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(btn);
    expect(replace).toHaveBeenCalledWith('/projects/calendar', { scroll: false });
  });
});
```

- [ ] **Step 2: Run** — `pnpm --filter @nexushub/web exec vitest run features/projects/components/my-cards-toggle.test.tsx` → FAIL (module absent).

- [ ] **Step 3: Implement**

```tsx
'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/**
 * Bascule « Mes cartes » → `?mine=1`. Le serveur traduit `mine` en
 * `assignees.some({ userId: <session> })` ; l'URL ne porte jamais d'id.
 * Partagée par la barre de filtres projet et le calendrier global.
 */
export function MyCardsToggle() {
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const searchParams = useSearchParams();
  const on = searchParams?.get('mine') === '1';

  const toggle = () => {
    const next = new URLSearchParams(searchParams?.toString() ?? '');
    if (on) next.delete('mine');
    else next.set('mine', '1');
    const qs = next.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false });
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={on}
      className={['nx-filter-trigger', on && 'has-active'].filter(Boolean).join(' ')}
    >
      <span aria-hidden="true">👤</span>
      Mes cartes
    </button>
  );
}
```

- [ ] **Step 4: Run** — PASS.

- [ ] **Step 5: Filters bar** — dans `project-filters-bar.tsx` : importer `MyCardsToggle` depuis `./my-cards-toggle` ; dans `clear()` ajouter `mine: false,` ; rendre `<MyCardsToggle />` juste avant `<div ref={popRef} className="relative">`. Dans `ActivePillsBar`, afficher « Tout effacer » aussi quand seul `mine` est actif : changer la condition d'affichage de la barre `{count > 0 ? (` en `{count > 0 || filter.mine ? (`.

- [ ] **Step 6: Verify** — `pnpm --filter @nexushub/web exec vitest run features/projects/components` → PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/features/projects/components
git commit -m "feat(projects): Mes cartes toggle in the project filters bar"
```

---

### Task 7: Calendriers — `isDone`, `mine`, navigation

**Files:**
- Modify: `apps/web/features/projects/components/calendar-view.tsx`
- Modify: `apps/web/features/projects/components/calendar-item.tsx`
- Modify: `apps/web/features/projects/components/calendar-view.test.tsx`
- Modify: `apps/web/app/(app)/projects/[id]/calendar/page.tsx`
- Modify: `apps/web/app/(app)/projects/calendar/page.tsx`

- [ ] **Step 1: Failing tests** — dans `calendar-view.test.tsx`, ajouter `isDone: false,` dans la factory `card()`, passer `extraParams` optionnel à `renderMonth`, et ajouter :

```tsx
describe('<CalendarView /> — done cards & params', () => {
  it('strikes through a card that sits in the last column', () => {
    renderMonth([{ ...card(1), isDone: true }]);
    const link = screen.getByRole('link', { name: /Carte 1/ });
    expect(link.className).toMatch(/\bdone\b/);
    expect(link).toHaveTextContent('(terminée)');
  });

  it('keeps extra params (mine) on month navigation', () => {
    render(
      <CalendarView
        year={2026}
        month1={10}
        cards={[]}
        basePath="/projects/calendar"
        clientSlug="acme"
        legend={[]}
        extraParams={{ mine: '1' }}
      />,
    );
    expect(screen.getByRole('link', { name: 'Mois suivant' })).toHaveAttribute(
      'href',
      '/projects/calendar?month=2026-11&client=acme&mine=1',
    );
  });
});
```

- [ ] **Step 2: Run** — `pnpm --filter @nexushub/web exec vitest run features/projects/components/calendar-view.test.tsx` → FAIL.

- [ ] **Step 3: calendar-view.tsx** —
  - `CalendarCardItem` : ajouter `/** Carte dans la dernière colonne utilisateur de son projet. */ readonly isDone: boolean;`
  - `CalendarViewProps` : ajouter `/** Params conservés sur la navigation mois (ex. filtres, mine). */ readonly extraParams?: Readonly<Record<string, string>>;`
  - `buildHref` : nouveau paramètre `extraParams: Readonly<Record<string, string>> = {}` en dernier, et après `client` : `for (const [k, v] of Object.entries(extraParams)) if (k !== 'month' && k !== 'client') params.set(k, v);`
  - Destructurer `extraParams` dans `CalendarView` et le passer aux 3 appels `buildHref` (prev, next, today).

- [ ] **Step 4: calendar-item.tsx** — remplacer le corps par :

```tsx
import Link from 'next/link';
import { clientColorCss } from '@nexushub/domain';
import { buildHrefWithClient } from '@/features/shell/lib/client-filter-url';
import type { CalendarCardItem } from './calendar-view';

/**
 * One card pill in a calendar day. Hook-free so both the server-rendered
 * grid and the client-side overflow toggle can render it.
 */
export function CalendarItem({
  card,
  clientSlug,
}: {
  card: CalendarCardItem;
  clientSlug: string | null;
}) {
  const color = clientColorCss(card.clientColorToken);
  const className = ['cal-item', card.columnIsBlocked && 'blocked', card.isDone && 'done']
    .filter(Boolean)
    .join(' ');
  // Bloqué garde son style danger (classe) : pas de couleur client inline.
  const style = card.columnIsBlocked
    ? undefined
    : { background: `color-mix(in srgb, ${color} 12%, transparent)`, color };

  return (
    <Link
      href={buildHrefWithClient(`/projects/${card.projectId}`, `card=${card.id}`, clientSlug)}
      className={className}
      style={style}
      title={`#${String(card.shortRef).padStart(3, '0')} · ${card.title}${card.isDone ? ' (terminée)' : ''}`}
    >
      {card.title}
      {card.isDone ? <span className="sr-only"> (terminée)</span> : null}
    </Link>
  );
}
```

- [ ] **Step 5: Run** — test calendar-view → PASS.

- [ ] **Step 6: Calendrier projet** (`[id]/calendar/page.tsx`) :
  - Imports : ajouter `lastUserColumnIds` à l'import `@nexushub/domain`, et `writeProjectCardFilter` à l'import `card-filter`.
  - `buildCardFilterClauses(filter, ctx.userId)`.
  - Select `columns` : `select: { id: true, name: true, position: true, isBlockedSystem: true }`.
  - Remplacer le calcul `const { dueDate: filterDueDate, ...restFilterClauses } …` jusqu'à `dueWhere` par :

```ts
  // Mois visible ∩ éventuel filtre `due` ∩ éventuel AND du filtre (asg + mine) :
  // tout passe dans un seul AND pour qu'aucune clé n'en écrase une autre.
  const { dueDate: filterDueDate, AND: filterAnd, ...restFilterClauses } = filterClauses;
  const monthDue = { gte: range.start, lt: range.endExclusive };
  const andClauses = [
    ...(Array.isArray(filterAnd) ? filterAnd : filterAnd ? [filterAnd] : []),
    { dueDate: monthDue },
    ...(filterDueDate ? [{ dueDate: filterDueDate }] : []),
  ];
```

  et dans le `where` de `card.findMany` remplacer `...dueWhere,` par `AND: andClauses,`.
  - Select carte : ajouter `columnId: true`.
  - Après la récupération : 
```ts
  const doneColumnIds = new Set(
    lastUserColumnIds(project.columns.map((c) => ({ ...c, projectId: project.id }))),
  );
```
  et dans le mapping `items` : `isDone: doneColumnIds.has(c.columnId),`.
  - Sur `<CalendarView … />` ajouter `extraParams={Object.fromEntries(writeProjectCardFilter(new URLSearchParams(), filter))}`.

- [ ] **Step 7: Calendrier global** (`projects/calendar/page.tsx`) :
  - Imports : `lastUserColumnIds` (domain) et `MyCardsToggle` (`@/features/projects/components/my-cards-toggle`).
  - Après `const range = …` : `const mine = readParam(sp['mine']) === '1';`
  - Dans le `where` des cartes, ajouter `...(mine ? { assignees: { some: { userId: ctx.userId } } } : {}),`.
  - Select carte : ajouter `columnId: true`.
  - Après `findMany` :

```ts
  const projectIds = [...new Set(cards.map((c) => c.project.id))];
  const columns =
    projectIds.length === 0
      ? []
      : await prisma.column.findMany({
          where: { projectId: { in: projectIds }, project: { workspaceId: ctx.workspaceId } },
          select: { id: true, name: true, projectId: true, position: true, isBlockedSystem: true },
        });
  const doneColumnIds = new Set(lastUserColumnIds(columns));
```

  - Mapping `items` : `isDone: doneColumnIds.has(c.columnId),`.
  - Header : envelopper la `view-toggle` existante dans `<div className="flex items-center gap-3"><MyCardsToggle /> … </div>`.
  - Lien « Kanban » : conserver le client comme aujourd'hui (pas de `mine` sur /projects).
  - `<CalendarView … extraParams={mine ? { mine: '1' } : {}} />`.
  - Sous-titre : si `mine`, préfixer le texte par `Mes cartes · `.

- [ ] **Step 8: Verify** — `pnpm --filter @nexushub/web typecheck` → PASS ; `pnpm --filter @nexushub/web exec vitest run features/projects` → PASS. `grep -n "isDone" apps/web/features/projects/components/calendar-day-overflow.tsx` : si le fichier construit des `CalendarCardItem` lui-même, ajouter le champ ; sinon rien.

- [ ] **Step 9: Commit**

```bash
git add apps/web
git commit -m "feat(calendar): strike through done cards, Mes cartes filter on global calendar, keep filters on month nav"
```

---

### Task 8: Widget « Mes cartes » (Overview)

**Files:**
- Create: `apps/web/features/overview/lib/my-cards.ts`
- Create: `apps/web/features/overview/lib/my-cards.test.ts`
- Modify: `apps/web/app/(app)/overview/page.tsx`

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  txMock: vi.fn(),
  columnFindMany: vi.fn(),
  cardCount: vi.fn(),
}));

vi.mock('@nexushub/db', () => ({
  prisma: {
    $transaction: m.txMock,
    column: { findMany: m.columnFindMany },
    card: { count: m.cardCount },
  },
}));

import { getMyCardsMetrics } from './my-cards';

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset();
  m.cardCount.mockImplementation((args: unknown) => args);
});

describe('getMyCardsMetrics', () => {
  it('counts open + overdue cards assigned to the user, excluding last columns', async () => {
    m.columnFindMany.mockResolvedValue([
      { id: 'c1', projectId: 'p1', position: 1, isBlockedSystem: false, name: 'A' },
      { id: 'c2', projectId: 'p1', position: 2, isBlockedSystem: false, name: 'B' },
      { id: 'cb', projectId: 'p1', position: 9, isBlockedSystem: true, name: 'Bloqué' },
    ]);
    m.txMock.mockResolvedValue([5, 2]);

    const res = await getMyCardsMetrics({ workspaceId: 'ws-1', userId: 'u-1' });

    expect(res).toEqual({ open: 5, overdue: 2 });
    const [openArgs, overdueArgs] = m.txMock.mock.calls[0]![0] as [
      { where: Record<string, unknown> },
      { where: Record<string, unknown> },
    ];
    expect(openArgs.where).toMatchObject({
      workspaceId: 'ws-1',
      deletedAt: null,
      archivedAt: null,
      assignees: { some: { userId: 'u-1' } },
      columnId: { notIn: ['c2'] },
    });
    expect(overdueArgs.where).toMatchObject({ dueDate: { lt: expect.any(Date) } });
  });

  it('applies the client filter to columns and cards', async () => {
    m.columnFindMany.mockResolvedValue([]);
    m.txMock.mockResolvedValue([0, 0]);
    await getMyCardsMetrics({ workspaceId: 'ws-1', userId: 'u-1', clientId: 'cl-1' });
    expect(m.columnFindMany.mock.calls[0]![0].where.project).toMatchObject({ clientId: 'cl-1' });
    const [openArgs] = m.txMock.mock.calls[0]![0] as [{ where: { project: unknown; columnId?: unknown } }];
    expect(openArgs.where.project).toMatchObject({ clientId: 'cl-1' });
    expect(openArgs.where.columnId).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run** — `pnpm --filter @nexushub/web exec vitest run features/overview/lib/my-cards.test.ts` → FAIL.

- [ ] **Step 3: Implement** `my-cards.ts` :

```ts
/**
 * Compteur « Mes cartes » de l'Overview : cartes assignées à l'utilisateur
 * (tout rôle RACI), non supprimées / archivées, hors dernière colonne
 * utilisateur de leur projet (= pas terminées). Les cartes en Bloqué
 * comptent : elles sont ouvertes et en retard.
 */
import 'server-only';
import { prisma } from '@nexushub/db';
import { lastUserColumnIds, startOfTodayInParis, type UserScope } from '@nexushub/domain';
import { scopedProjectWhere } from '@/lib/auth/scope';

export interface MyCardsMetrics {
  readonly open: number;
  readonly overdue: number;
}

export interface MyCardsMetricsOptions {
  readonly workspaceId: string;
  readonly userId: string;
  readonly clientId?: string;
  readonly scope?: UserScope;
}

export async function getMyCardsMetrics({
  workspaceId,
  userId,
  clientId,
  scope,
}: MyCardsMetricsOptions): Promise<MyCardsMetrics> {
  const projectWhere = {
    workspaceId,
    deletedAt: null,
    archivedAt: null,
    ...(scope ? scopedProjectWhere(scope) : {}),
    ...(clientId ? { clientId } : {}),
  };

  const columns = await prisma.column.findMany({
    where: { project: projectWhere },
    select: { id: true, name: true, projectId: true, position: true, isBlockedSystem: true },
  });
  const doneIds = lastUserColumnIds(columns);

  const openWhere = {
    workspaceId,
    deletedAt: null,
    archivedAt: null,
    assignees: { some: { userId } },
    project: projectWhere,
    ...(doneIds.length > 0 ? { columnId: { notIn: doneIds } } : {}),
  };

  const [open, overdue] = await prisma.$transaction([
    prisma.card.count({ where: openWhere }),
    prisma.card.count({ where: { ...openWhere, dueDate: { lt: startOfTodayInParis() } } }),
  ]);

  return { open, overdue };
}
```

- [ ] **Step 4: Run** — PASS. (Le 2e test attend `columnId` absent car aucune colonne.)

- [ ] **Step 5: Overview page** — dans `overview/page.tsx` :
  - Imports : `getMyCardsMetrics` depuis `@/features/overview/lib/my-cards`, `buildHrefWithClient` depuis `@/features/shell/lib/client-filter-url`.
  - Ajouter au `Promise.all` un 4e élément :
```ts
    getMyCardsMetrics({
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      scope,
      ...(activeClient ? { clientId: activeClient.id } : {}),
    }),
```
  et déstructurer `const [, profile, metrics, myCards] = …`.
  - Grille : `className="mb-10 grid grid-cols-2 gap-5 md:grid-cols-3 xl:grid-cols-5"`.
  - Après la carte « Cartes bloquées » :

```tsx
        <Link
          href={buildHrefWithClient('/projects/calendar', 'mine=1', activeClient?.slug ?? null)}
          aria-label={`Mes cartes : ${myCards.open} ouvertes${myCards.overdue > 0 ? `, dont ${myCards.overdue} en retard` : ''}. Ouvrir le calendrier`}
          className="block rounded-2xl transition hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-accent-primary)]"
        >
          <MetricCard
            label="Mes cartes"
            value={fmt(myCards.open)}
            className="h-full hover:shadow-[var(--shadow-hover)]"
            {...(myCards.overdue > 0
              ? { trend: `dont ${myCards.overdue} en retard`, trendTone: 'danger' as const }
              : {})}
          />
        </Link>
```

  (Vérifier que `activeClient` expose `slug` — c'est le cas via `resolveActiveClient`, cf. `lib/client-filter/server.ts:74`.)

- [ ] **Step 6: Verify** — `pnpm --filter @nexushub/web typecheck` → PASS ; `pnpm --filter @nexushub/web exec vitest run features/overview` → PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/features/overview apps/web/app/\(app\)/overview
git commit -m "feat(overview): Mes cartes widget linking to the filtered calendar"
```

---

### Task 9: Server Action `renameProject`

**Files:**
- Modify: `apps/web/features/projects/lib/schemas.ts:14` (`const NameSchema` → `export const NameSchema`)
- Create: `apps/web/features/projects/actions/rename-project.ts`
- Create: `apps/web/features/projects/actions/rename-project.test.ts`

- [ ] **Step 1: Failing test** (même pattern de mocks que `delete-project.test.ts`) :

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUserVerified: vi.fn(),
  projectFindFirst: vi.fn(),
  projectUpdate: vi.fn(),
  workspaceAccessFindMany: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@nexushub/db', async (orig) => ({
  ...(await orig<typeof import('@nexushub/db')>()),
  prisma: {
    project: { findFirst: mocks.projectFindFirst, update: mocks.projectUpdate },
    workspaceAccess: { findMany: mocks.workspaceAccessFindMany },
  },
}));
vi.mock('@/lib/auth', () => ({ requireUserVerified: mocks.requireUserVerified }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));

import { renameProject } from './rename-project';

const PROJECT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const admin = { userId: 'admin-1', workspaceId: 'ws-1', role: 'admin', isSuperAdmin: false, email: 'a@t' };

beforeEach(() => {
  for (const f of Object.values(mocks)) f.mockReset();
  mocks.workspaceAccessFindMany.mockResolvedValue([]);
});

describe('renameProject', () => {
  it('renames, returns the stored name and revalidates', async () => {
    mocks.requireUserVerified.mockResolvedValue(admin);
    mocks.projectFindFirst
      .mockResolvedValueOnce({ id: PROJECT_ID, clientId: 'c-1', startDate: null, endDate: null })
      .mockResolvedValueOnce({ name: 'Nouveau nom', description: null, startDate: null, endDate: null });
    mocks.projectUpdate.mockResolvedValue({});

    const res = await renameProject({ projectId: PROJECT_ID, name: '  Nouveau nom ' });

    expect(res).toEqual({ ok: true, name: 'Nouveau nom' });
    expect(mocks.projectUpdate.mock.calls[0]![0].data).toEqual({ name: 'Nouveau nom' });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/projects');
  });

  it('rejects an empty name without touching the DB', async () => {
    mocks.requireUserVerified.mockResolvedValue(admin);
    const res = await renameProject({ projectId: PROJECT_ID, name: '   ' });
    expect(res.ok).toBe(false);
    expect(mocks.projectUpdate).not.toHaveBeenCalled();
  });

  it('refuses a Viewer', async () => {
    mocks.requireUserVerified.mockResolvedValue({ ...admin, role: 'viewer' });
    const res = await renameProject({ projectId: PROJECT_ID, name: 'X' });
    expect(res).toEqual({ ok: false, message: 'Action réservée aux Admins et Users.' });
    expect(mocks.projectUpdate).not.toHaveBeenCalled();
  });
});
```

Si le mock `importOriginal` de `@nexushub/db` pose problème (Prisma client non généré en test), remplacer par le mock simple de `delete-project.test.ts` et ajouter `Prisma: { PrismaClientKnownRequestError: class extends Error {} }`. Vérifier aussi le `NameSchema` : si le trim n'y est pas fait, le test « Nouveau nom » doit attendre la valeur trimée — ajouter `.trim()` au schéma de l'action si besoin.

- [ ] **Step 2: Run** — `pnpm --filter @nexushub/web exec vitest run features/projects/actions/rename-project.test.ts` → FAIL.

- [ ] **Step 3: Implement** — exporter `NameSchema` dans `schemas.ts`, puis `rename-project.ts` :

```ts
'use server';
import 'server-only';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUserVerified } from '@/lib/auth';
import { updateProjectCore } from '../lib/project-core';
import { NameSchema } from '../lib/schemas';

const Schema = z.object({
  projectId: z.string().uuid(),
  name: NameSchema,
});

export type RenameProjectResult =
  | { readonly ok: true; readonly name: string }
  | { readonly ok: false; readonly message: string };

/**
 * Renommage inline (carte /projects + header projet). Mince wrapper :
 * auth + Zod ; les règles (Viewer refusé, scope, unicité) vivent dans
 * `updateProjectCore`, partagé avec l'assistant.
 */
export async function renameProject(input: {
  projectId: string;
  name: string;
}): Promise<RenameProjectResult> {
  const ctx = await requireUserVerified();
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Nom de projet invalide.' };
  }

  const res = await updateProjectCore(ctx, parsed.data);
  if (!res.ok) return res;

  revalidatePath('/projects');
  revalidatePath(`/projects/${parsed.data.projectId}`, 'layout');
  return { ok: true, name: res.name };
}
```

Note : le contrôle Viewer de `updateProjectCore` intervient avant la validation ? Non — Zod passe d'abord. Le test Viewer utilise un nom valide (`'X'`) donc atteint le core. Si `NameSchema` impose une longueur minimale > 1, utiliser `'Projet X'`.

- [ ] **Step 4: Run** — PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/features/projects
git commit -m "feat(projects): renameProject server action"
```

---

### Task 10: `ProjectTitleEditor` + intégration

**Files:**
- Create: `apps/web/features/projects/components/project-title-editor.tsx`
- Create: `apps/web/features/projects/components/project-title-editor.test.tsx`
- Modify: `apps/web/app/(app)/projects/page.tsx` (L96-134)
- Modify: `apps/web/app/(app)/projects/[id]/page.tsx:300`, `[id]/list/page.tsx:213`, `[id]/calendar/page.tsx:168-176`

- [ ] **Step 1: Failing test**

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const renameProject = vi.fn();
const notify = vi.fn();
vi.mock('../actions/rename-project', () => ({ renameProject }));
vi.mock('@/features/shell/components/toaster', () => ({ notify }));

import { ProjectTitleEditor } from './project-title-editor';

const ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

beforeEach(() => {
  renameProject.mockReset();
  notify.mockReset();
});

function startEditing() {
  fireEvent.click(screen.getByRole('button', { name: 'Renommer le projet' }));
  return screen.getByRole('textbox', { name: 'Nom du projet' });
}

describe('<ProjectTitleEditor />', () => {
  it('hides the pencil when the user cannot edit', () => {
    render(<ProjectTitleEditor projectId={ID} name="Alpha" canEdit={false} />);
    expect(screen.getByRole('heading', { name: 'Alpha' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Renommer le projet' })).toBeNull();
  });

  it('saves on Enter (optimistic)', async () => {
    renameProject.mockResolvedValue({ ok: true, name: 'Beta' });
    render(<ProjectTitleEditor projectId={ID} name="Alpha" canEdit />);
    const input = startEditing();
    fireEvent.change(input, { target: { value: 'Beta' } });
    await act(async () => fireEvent.keyDown(input, { key: 'Enter' }));
    expect(renameProject).toHaveBeenCalledWith({ projectId: ID, name: 'Beta' });
    expect(screen.getByRole('heading', { name: 'Beta' })).toBeInTheDocument();
  });

  it('cancels on Escape without saving', () => {
    render(<ProjectTitleEditor projectId={ID} name="Alpha" canEdit />);
    const input = startEditing();
    fireEvent.change(input, { target: { value: 'Beta' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(renameProject).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Alpha' })).toBeInTheDocument();
  });

  it('does not call the server for an empty or unchanged name', () => {
    render(<ProjectTitleEditor projectId={ID} name="Alpha" canEdit />);
    const input = startEditing();
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.blur(input);
    expect(renameProject).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Alpha' })).toBeInTheDocument();
  });

  it('rolls back and toasts on error', async () => {
    renameProject.mockResolvedValue({ ok: false, message: 'Un projet porte déjà ce nom.' });
    render(<ProjectTitleEditor projectId={ID} name="Alpha" canEdit />);
    const input = startEditing();
    fireEvent.change(input, { target: { value: 'Dup' } });
    await act(async () => fireEvent.blur(input));
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Alpha' })).toBeInTheDocument(),
    );
    expect(notify).toHaveBeenCalledWith({ tone: 'error', message: 'Un projet porte déjà ce nom.' });
  });
});
```

- [ ] **Step 2: Run** — `pnpm --filter @nexushub/web exec vitest run features/projects/components/project-title-editor.test.tsx` → FAIL.

- [ ] **Step 3: Implement**

```tsx
'use client';
import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react';
import { PencilIcon } from '@/features/shell/components/icons';
import { notify } from '@/features/shell/components/toaster';
import { renameProject } from '../actions/rename-project';

export interface ProjectTitleEditorProps {
  readonly projectId: string;
  readonly name: string;
  readonly canEdit: boolean;
  /** `h1` dans le header projet, `h2` sur les cartes de /projects. */
  readonly as?: 'h1' | 'h2';
  readonly className?: string;
  /** Rendu après le titre dans le heading (ex. « · calendrier »). */
  readonly suffix?: ReactNode;
}

/**
 * Titre de projet éditable inline : crayon (survol / focus) → champ ;
 * Entrée ou blur enregistre, Échap annule. Optimiste avec rollback + toast.
 * Sur les cartes /projects le parent est `pointer-events-none` (stretched
 * link) : seuls le crayon et le champ réactivent les événements.
 */
export function ProjectTitleEditor({
  projectId,
  name,
  canEdit,
  as: Heading = 'h1',
  className,
  suffix,
}: ProjectTitleEditorProps) {
  const [display, setDisplay] = useState(name);
  const [draft, setDraft] = useState(name);
  const [editing, setEditing] = useState(false);
  const [, startTransition] = useTransition();
  const cancelledRef = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => setDisplay(name), [name]);
  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const begin = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    cancelledRef.current = false;
    setDraft(display);
    setEditing(true);
  };

  const commit = () => {
    setEditing(false);
    if (cancelledRef.current) return;
    const next = draft.trim();
    if (next.length === 0 || next === display) return;
    const previous = display;
    setDisplay(next);
    startTransition(async () => {
      const res = await renameProject({ projectId, name: next });
      if (res.ok) setDisplay(res.name);
      else {
        setDisplay(previous);
        notify({ tone: 'error', message: res.message });
      }
    });
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        aria-label="Nom du projet"
        value={draft}
        maxLength={120}
        onChange={(e) => setDraft(e.target.value)}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            inputRef.current?.blur();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            cancelledRef.current = true;
            setEditing(false);
          }
        }}
        onBlur={commit}
        className={`pointer-events-auto relative z-[2] w-full rounded-md border border-[color:var(--color-accent-primary)] bg-[color:var(--color-bg-card)] px-2 py-0.5 font-extrabold tracking-tight text-[color:var(--color-text-main)] outline-none ${className ?? ''}`}
      />
    );
  }

  return (
    <div className="group/title flex items-center gap-2">
      <Heading className={className}>
        {display}
        {suffix}
      </Heading>
      {canEdit ? (
        <button
          type="button"
          onClick={begin}
          aria-label="Renommer le projet"
          title="Renommer"
          className="pointer-events-auto relative z-[2] inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[color:var(--color-text-muted)] opacity-0 transition hover:bg-[color:var(--color-bg-hover)] hover:text-[color:var(--color-text-main)] focus-visible:opacity-100 group-hover:opacity-100 group-hover/title:opacity-100"
        >
          <PencilIcon width={14} height={14} style={{ width: 14, height: 14, display: 'block' }} />
        </button>
      ) : null}
    </div>
  );
}
```

Note : `getByRole('heading', { name: 'Beta' })` — le heading contient seulement `display` (+ `suffix` absent en test). Si `--color-bg-hover` n'existe pas dans `tokens.css`, utiliser `--color-bg-subtle` (vérifier par `grep -n "bg-hover\|bg-subtle" packages/ui/src/tokens/tokens.css`).

- [ ] **Step 4: Run** — PASS.

- [ ] **Step 5: Cartes /projects** — dans `apps/web/app/(app)/projects/page.tsx`, remplacer le contenu de `<li key={p.id} …>` (L98-133) par un « stretched link » (pas d'élément interactif imbriqué dans le `<a>`) :

```tsx
            <li
              key={p.id}
              className="group relative rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-5 shadow-[var(--shadow-card)] transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-hover)]"
            >
              <Link
                href={buildHrefWithClient(`/projects/${p.id}`, '', activeClient?.slug ?? null)}
                aria-label={p.name}
                className="absolute inset-0 z-[1] rounded-2xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-accent-primary)]"
              />
              {!isViewer ? (
                <div className="pointer-events-none absolute right-3 top-3 z-10 opacity-0 transition-opacity duration-150 focus-within:pointer-events-auto focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100">
                  <DeleteProjectButton projectId={p.id} projectName={p.name} size="sm" />
                </div>
              ) : null}
              <div className="pointer-events-none relative">
                <div className="mb-2 flex items-center gap-2 text-xs text-[color:var(--color-text-muted)]">
                  <span
                    aria-hidden="true"
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ background: clientColorCss(p.client.colorToken) }}
                  />
                  {p.client.name}
                  {p.type ? (
                    <span>
                      · {p.type.icon} {p.type.name}
                    </span>
                  ) : null}
                </div>
                <ProjectTitleEditor
                  projectId={p.id}
                  name={p.name}
                  canEdit={!isViewer}
                  as="h2"
                  className="text-lg font-extrabold tracking-tight"
                />
                {p.description ? (
                  <p className="mt-1 line-clamp-2 text-sm text-[color:var(--color-text-muted)]">
                    {p.description}
                  </p>
                ) : null}
                <div className="mt-3 text-xs text-[color:var(--color-text-muted)]">
                  {p._count.cards === 0
                    ? 'Aucune carte'
                    : p._count.cards === 1
                      ? '1 carte'
                      : `${p._count.cards} cartes`}
                </div>
              </div>
            </li>
```

Importer `ProjectTitleEditor` depuis `@/features/projects/components/project-title-editor`. Le `z-[2]` du crayon/champ passe au-dessus du lien `z-[1]`.

- [ ] **Step 6: Headers projet**
  - `[id]/page.tsx:300` : `<ProjectTitleEditor projectId={project.id} name={project.name} canEdit={!isViewer} className="text-[32px] font-extrabold tracking-tight" />` (`isViewer` existe L236, déclaré avant le JSX).
  - `[id]/list/page.tsx:213` : idem (`isViewer` L122).
  - `[id]/calendar/page.tsx:168-176` : importer `Roles` depuis `@nexushub/domain` (fusionner avec l'import existant), puis remplacer le `<h1>` par :

```tsx
          <ProjectTitleEditor
            projectId={project.id}
            name={project.name}
            canEdit={ctx.role !== Roles.Viewer}
            className="text-[32px] font-extrabold tracking-tight"
            suffix={
              <>
                {' '}
                <span
                  className="bg-clip-text text-transparent"
                  style={{ backgroundImage: 'var(--accent-gradient)' }}
                >
                  · calendrier
                </span>
              </>
            }
          />
```

- [ ] **Step 7: Verify** — `pnpm --filter @nexushub/web typecheck && pnpm --filter @nexushub/web lint` → PASS ; `pnpm --filter @nexushub/web exec vitest run features/projects` → PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web
git commit -m "feat(projects): inline project rename on cards and project headers"
```

---

### Task 11: Vérification globale + docs

**Files:**
- Modify: `progress.md`, `CLAUDE.md` (§11 journal)

- [ ] **Step 1: Suite complète**

Run: `pnpm turbo run typecheck lint test --filter=@nexushub/domain --filter=@nexushub/ui --filter=@nexushub/web`
Expected: tout vert, coverage domain ≥ seuils.

- [ ] **Step 2: Contrôle manuel** (skill `run` / `pnpm --filter @nexushub/web dev`) :
  1. /projects : survol d'une carte → crayon, renommer, Entrée ; clic ailleurs sur la carte ouvre le projet.
  2. Header projet (Kanban, Liste, Calendrier) : renommer ; Échap annule.
  3. Overview : widget « Mes cartes » → `/projects/calendar?mine=1` ; avec un client filtré, `client=` conservé.
  4. Projet : bascule « Mes cartes » dans les 3 vues ; « Tout effacer » la retire ; nav mois conserve les filtres.
  5. Clients : 12 pastilles + « + » → couleur libre enregistrée, visible dans sidebar, calendrier, mails.
  6. Calendrier : carte en dernière colonne barrée.

- [ ] **Step 3: Docs** — `progress.md` : ajouter une entrée datée 2026-10-02 « Lot A quick wins » (5 points, fichiers clés, aucune migration). `CLAUDE.md` §11 : ajouter la ligne
`| 2026-10-02 | Lot A quick wins — renommage projet inline, widget + filtre « Mes cartes » (`mine`, userId de session), palette clients 12 tokens + couleur libre hex (contraste WCAG), cartes terminées barrées au calendrier | Angelo L. + Claude |`

- [ ] **Step 4: Commit**

```bash
git add progress.md CLAUDE.md
git commit -m "docs: progress + CLAUDE.md journal for lot A quick wins"
```
