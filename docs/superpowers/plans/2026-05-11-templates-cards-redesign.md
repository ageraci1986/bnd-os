# `/templates/cards` Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refonte de l'éditeur de templates de cartes en 3 colonnes (liste · éditeur · aperçu live), drawer slide-over à gauche, drag & drop des items, suppression de la notion de groupes, ajout d'un type d'item "section", description devient un item système.

**Architecture:** On bascule le storage de `card_templates` d'un schéma `fields[] + descriptionPosition` à un schéma unifié `items[]`. La couche domain reçoit un nouveau validator. La couche UI est réécrite intégralement (10 nouveaux fichiers focalisés, suppression du monolithe `editor.tsx`). Les actions serveur passent à la nouvelle forme. Le rendu de carte dans `/projects` boucle sur `items` au lieu de l'ancienne logique conditionnelle `descriptionPosition`.

**Tech Stack:** Next.js 15 RSC + Server Actions · React 19 · TypeScript strict · Tailwind v4 · Prisma 6 · `@dnd-kit/sortable` · Vitest · Playwright. Aucune nouvelle dépendance.

**Patterns du codebase à respecter :**

- Confirmations destructives → `window.confirm()` (pas de Radix AlertDialog, aucun composant Radix n'est utilisé dans `apps/web/features`).
- Popover du "+ Ajouter un item" → composant custom (state + click-outside), pas de nouvelle dépendance Radix.
- Animations du drawer → CSS transition, pas de framer-motion (non installé).
- Tous les imports `@nexushub/domain` passent par le barrel `packages/domain/src/index.ts`.

**Spec source :** `docs/superpowers/specs/2026-05-11-templates-cards-redesign-design.md`

---

## Phase 1 — Couche domain (TDD, additif)

On ajoute les nouveaux types/validators **à côté** des anciens. Les anciens (`CardFieldDef`, `validateCardFields`, `pruneFieldValues`, `DESCRIPTION_POSITIONS`, `isDescriptionPosition`, `CardTemplateDescriptionPosition`, `CardFieldGroup`, `CARD_FIELD_GROUPS`, `CARD_FIELD_PRESETS`) restent fonctionnels jusqu'à la Phase 6. Ça permet de migrer la chaîne pas à pas sans tout casser.

### Task 1 : Types `CardTemplateItem` et helpers

**Files:**

- Modify: `packages/domain/src/card-templates/index.ts`

- [ ] **Step 1 : Ajouter le nouveau type union à la fin du fichier**

Ouvrir `packages/domain/src/card-templates/index.ts` et ajouter, après la fonction `pruneFieldValues` (ligne ~262, avant la fin du fichier) :

```ts
// ---------- New unified items model -----------------------------------------

/** Singleton id for the description marker item. */
export const DESCRIPTION_ITEM_ID = 'description';

export type CardTemplateInputType =
  | 'text'
  | 'longtext'
  | 'select'
  | 'link'
  | 'checkbox'
  | 'date'
  | 'number';

export interface CardTemplateInputItem {
  readonly id: string;
  readonly type: CardTemplateInputType;
  readonly label: string;
  readonly options?: readonly string[];
  readonly placeholder?: string;
}

export interface CardTemplateSectionItem {
  readonly id: string;
  readonly type: 'section';
  readonly label: string;
}

export interface CardTemplateDescriptionItem {
  readonly id: typeof DESCRIPTION_ITEM_ID;
  readonly type: 'description';
}

export type CardTemplateItem =
  | CardTemplateInputItem
  | CardTemplateSectionItem
  | CardTemplateDescriptionItem;

/** Labels for the "+ Ajouter un item" popover. Order matters: it is the display order. */
export const CARD_TEMPLATE_ITEM_TYPES: readonly { id: CardTemplateItem['type']; label: string }[] =
  [
    { id: 'text', label: 'Texte court' },
    { id: 'longtext', label: 'Texte long' },
    { id: 'select', label: 'Liste déroulante' },
    { id: 'link', label: 'Lien URL' },
    { id: 'checkbox', label: 'Case à cocher' },
    { id: 'date', label: 'Date' },
    { id: 'number', label: 'Nombre' },
    { id: 'section', label: 'Section' },
    { id: 'description', label: 'Description' },
  ];

/** Default label generated when the user adds a new item, by type. */
export function defaultLabelForItemType(type: CardTemplateItem['type']): string {
  switch (type) {
    case 'text':
      return 'Nouveau champ texte';
    case 'longtext':
      return 'Nouveau champ texte long';
    case 'select':
      return 'Nouvelle liste';
    case 'link':
      return 'Nouveau lien';
    case 'checkbox':
      return 'Nouvelle case à cocher';
    case 'date':
      return 'Nouvelle date';
    case 'number':
      return 'Nouveau nombre';
    case 'section':
      return 'Nouvelle section';
    case 'description':
      return 'Description';
  }
}
```

- [ ] **Step 2 : Lint + typecheck du package domain**

Run: `pnpm --filter @nexushub/domain typecheck && pnpm --filter @nexushub/domain lint`
Expected : tous deux passent.

- [ ] **Step 3 : Commit**

```bash
git add packages/domain/src/card-templates/index.ts
git commit -m "feat(domain): add CardTemplateItem union for templates redesign"
```

---

### Task 2 : `validateCardTemplateItems` (TDD)

**Files:**

- Create: `packages/domain/src/card-templates/validate-items.test.ts`
- Modify: `packages/domain/src/card-templates/index.ts`

- [ ] **Step 1 : Écrire les tests d'abord**

Créer `packages/domain/src/card-templates/validate-items.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { validateCardTemplateItems, DESCRIPTION_ITEM_ID } from './index';

describe('validateCardTemplateItems', () => {
  it('returns [] for an empty array', () => {
    expect(validateCardTemplateItems([])).toEqual([]);
  });

  it('returns null for non-array input', () => {
    expect(validateCardTemplateItems(null)).toBeNull();
    expect(validateCardTemplateItems('foo')).toBeNull();
    expect(validateCardTemplateItems({})).toBeNull();
  });

  it('accepts a mix of input, section and description items', () => {
    const items = [
      { id: 'a', type: 'text', label: 'Titre' },
      { id: 's1', type: 'section', label: 'Brief' },
      { id: DESCRIPTION_ITEM_ID, type: 'description' },
      { id: 'b', type: 'select', label: 'Statut', options: ['todo', 'doing'] },
    ];
    expect(validateCardTemplateItems(items)).toEqual(items);
  });

  it('rejects more than one description item', () => {
    const items = [
      { id: DESCRIPTION_ITEM_ID, type: 'description' },
      { id: DESCRIPTION_ITEM_ID, type: 'description' },
    ];
    expect(validateCardTemplateItems(items)).toBeNull();
  });

  it('rejects duplicate ids on non-description items', () => {
    const items = [
      { id: 'dup', type: 'text', label: 'A' },
      { id: 'dup', type: 'text', label: 'B' },
    ];
    expect(validateCardTemplateItems(items)).toBeNull();
  });

  it('rejects a select without options', () => {
    expect(validateCardTemplateItems([{ id: 'x', type: 'select', label: 'X' }])).toBeNull();
  });

  it('rejects a select with an empty options array', () => {
    expect(
      validateCardTemplateItems([{ id: 'x', type: 'select', label: 'X', options: [] }]),
    ).toBeNull();
  });

  it('rejects a section without a label', () => {
    expect(validateCardTemplateItems([{ id: 's1', type: 'section' }])).toBeNull();
  });

  it('rejects unknown types', () => {
    expect(validateCardTemplateItems([{ id: 'x', type: 'unknown', label: 'X' }])).toBeNull();
  });

  it('rejects a description marker with a wrong id', () => {
    expect(validateCardTemplateItems([{ id: 'desc', type: 'description' }])).toBeNull();
  });

  it('strips unknown properties on input items', () => {
    const result = validateCardTemplateItems([
      { id: 'a', type: 'text', label: 'A', group: 'overview', foo: 'bar' },
    ]);
    expect(result).toEqual([{ id: 'a', type: 'text', label: 'A' }]);
  });

  it('trims and rejects empty labels', () => {
    expect(validateCardTemplateItems([{ id: 'a', type: 'text', label: '  ' }])).toBeNull();
  });

  it('rejects items list longer than 60', () => {
    const items = Array.from({ length: 61 }, (_, i) => ({
      id: `f${i}`,
      type: 'text',
      label: `F ${i}`,
    }));
    expect(validateCardTemplateItems(items)).toBeNull();
  });
});
```

- [ ] **Step 2 : Vérifier que les tests échouent**

Run: `pnpm --filter @nexushub/domain test --run -- validate-items`
Expected : FAIL — `validateCardTemplateItems is not a function`.

- [ ] **Step 3 : Implémenter `validateCardTemplateItems`**

Dans `packages/domain/src/card-templates/index.ts`, ajouter à la fin :

```ts
const ITEMS_MAX = 60;
const LABEL_MAX = 120;
const ID_MAX = 64;
const OPTIONS_MAX = 32;
const OPTION_MAX = 80;
const PLACEHOLDER_MAX = 200;

const INPUT_TYPES: ReadonlySet<string> = new Set([
  'text',
  'longtext',
  'select',
  'link',
  'checkbox',
  'date',
  'number',
]);

/**
 * Validate the JSONB stored in `card_templates.items`.
 * Returns `null` on the first invalid shape (caller logs / rejects).
 */
export function validateCardTemplateItems(value: unknown): readonly CardTemplateItem[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length > ITEMS_MAX) return null;

  const out: CardTemplateItem[] = [];
  const seenIds = new Set<string>();
  let seenDescription = false;

  for (const raw of value) {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    const id = r['id'];
    const type = r['type'];

    if (typeof id !== 'string' || id.length === 0 || id.length > ID_MAX) return null;
    if (typeof type !== 'string') return null;

    // description marker
    if (type === 'description') {
      if (id !== DESCRIPTION_ITEM_ID) return null;
      if (seenDescription) return null;
      seenDescription = true;
      out.push({ id: DESCRIPTION_ITEM_ID, type: 'description' });
      continue;
    }

    if (seenIds.has(id)) return null;
    seenIds.add(id);

    const label = r['label'];
    if (typeof label !== 'string') return null;
    const labelTrim = label.trim();
    if (labelTrim.length === 0 || labelTrim.length > LABEL_MAX) return null;

    if (type === 'section') {
      out.push({ id, type: 'section', label: labelTrim });
      continue;
    }

    if (!INPUT_TYPES.has(type)) return null;

    const options = r['options'];
    const placeholder = r['placeholder'];

    if (type === 'select') {
      if (!Array.isArray(options) || options.length === 0 || options.length > OPTIONS_MAX) {
        return null;
      }
      if (options.some((o) => typeof o !== 'string' || o.length === 0 || o.length > OPTION_MAX)) {
        return null;
      }
    } else if (options !== undefined) {
      // options only valid on select
      return null;
    }

    if (placeholder !== undefined) {
      if (typeof placeholder !== 'string' || placeholder.length > PLACEHOLDER_MAX) return null;
    }

    out.push({
      id,
      type: type as CardTemplateInputType,
      label: labelTrim,
      ...(Array.isArray(options) ? { options: [...(options as string[])] } : {}),
      ...(typeof placeholder === 'string' ? { placeholder } : {}),
    });
  }

  return out;
}
```

- [ ] **Step 4 : Vérifier que les tests passent**

Run: `pnpm --filter @nexushub/domain test --run -- validate-items`
Expected : PASS (12 tests).

- [ ] **Step 5 : Commit**

```bash
git add packages/domain/src/card-templates/index.ts packages/domain/src/card-templates/validate-items.test.ts
git commit -m "feat(domain): add validateCardTemplateItems with full test coverage"
```

---

### Task 3 : Adapter `pruneFieldValues` au nouveau modèle (TDD)

**Files:**

- Create: `packages/domain/src/card-templates/prune-values.test.ts`
- Modify: `packages/domain/src/card-templates/index.ts`

Le `pruneFieldValues` actuel prend `readonly CardFieldDef[]`. On crée une variante `pruneFieldValuesByItems(values, items)` qui ignore les items section/description. L'ancien reste en place pour la transition.

- [ ] **Step 1 : Écrire les tests**

Créer `packages/domain/src/card-templates/prune-values.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { pruneFieldValuesByItems, type CardTemplateItem, DESCRIPTION_ITEM_ID } from './index';

describe('pruneFieldValuesByItems', () => {
  it('returns {} for empty items', () => {
    expect(pruneFieldValuesByItems({ a: '1' }, [])).toEqual({});
  });

  it('keeps values for input items only', () => {
    const items: CardTemplateItem[] = [
      { id: 'title', type: 'text', label: 'T' },
      { id: 's1', type: 'section', label: 'Brief' },
      { id: DESCRIPTION_ITEM_ID, type: 'description' },
      { id: 'when', type: 'date', label: 'W' },
    ];
    const values = { title: 'Hello', when: '2026-05-11', orphan: 'x', s1: 'should drop' };
    expect(pruneFieldValuesByItems(values, items)).toEqual({
      title: 'Hello',
      when: '2026-05-11',
    });
  });

  it('drops non-string values', () => {
    const items: CardTemplateItem[] = [{ id: 'a', type: 'text', label: 'A' }];
    const values: Record<string, unknown> = { a: 42, b: 'kept-not' };
    expect(pruneFieldValuesByItems(values, items)).toEqual({});
  });
});
```

- [ ] **Step 2 : Vérifier que les tests échouent**

Run: `pnpm --filter @nexushub/domain test --run -- prune-values`
Expected : FAIL — `pruneFieldValuesByItems is not a function`.

- [ ] **Step 3 : Implémenter**

Dans `packages/domain/src/card-templates/index.ts`, ajouter à la fin :

```ts
/**
 * Strip values keyed by ids that no longer exist or refer to non-input items
 * (section / description don't store values). Keeps per-card storage clean.
 */
export function pruneFieldValuesByItems(
  values: Record<string, unknown>,
  items: readonly CardTemplateItem[],
): Record<string, string> {
  const inputIds = new Set<string>();
  for (const it of items) {
    if (it.type !== 'section' && it.type !== 'description') inputIds.add(it.id);
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) {
    if (inputIds.has(k) && typeof v === 'string') out[k] = v;
  }
  return out;
}
```

- [ ] **Step 4 : Vérifier les tests**

Run: `pnpm --filter @nexushub/domain test --run -- prune-values`
Expected : PASS (3 tests).

- [ ] **Step 5 : Commit**

```bash
git add packages/domain/src/card-templates/index.ts packages/domain/src/card-templates/prune-values.test.ts
git commit -m "feat(domain): add pruneFieldValuesByItems for the items model"
```

---

### Task 4 : Helper de migration `migrateFieldsToItems` (TDD pure function)

**Files:**

- Create: `packages/domain/src/card-templates/migrate-fields-to-items.test.ts`
- Modify: `packages/domain/src/card-templates/index.ts`

C'est la fonction pure que le script de backfill utilisera. La logique : (1) strip `group` de chaque field, (2) injecter le marker description selon `descriptionPosition`.

- [ ] **Step 1 : Écrire les tests**

Créer `packages/domain/src/card-templates/migrate-fields-to-items.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { migrateFieldsToItems, DESCRIPTION_ITEM_ID, type CardFieldDef } from './index';

describe('migrateFieldsToItems', () => {
  const fields: CardFieldDef[] = [
    { id: 'title', type: 'text', label: 'Titre', group: 'overview' },
    { id: 'platform', type: 'select', label: 'Platform', options: ['IG', 'FB'] },
  ];

  it('strips group and appends description marker for after-fields', () => {
    expect(migrateFieldsToItems(fields, 'after-fields')).toEqual([
      { id: 'title', type: 'text', label: 'Titre' },
      { id: 'platform', type: 'select', label: 'Platform', options: ['IG', 'FB'] },
      { id: DESCRIPTION_ITEM_ID, type: 'description' },
    ]);
  });

  it('prepends description marker for before-fields', () => {
    expect(migrateFieldsToItems(fields, 'before-fields')).toEqual([
      { id: DESCRIPTION_ITEM_ID, type: 'description' },
      { id: 'title', type: 'text', label: 'Titre' },
      { id: 'platform', type: 'select', label: 'Platform', options: ['IG', 'FB'] },
    ]);
  });

  it('omits description marker for hidden', () => {
    expect(migrateFieldsToItems(fields, 'hidden')).toEqual([
      { id: 'title', type: 'text', label: 'Titre' },
      { id: 'platform', type: 'select', label: 'Platform', options: ['IG', 'FB'] },
    ]);
  });

  it('handles empty fields with after-fields position', () => {
    expect(migrateFieldsToItems([], 'after-fields')).toEqual([
      { id: DESCRIPTION_ITEM_ID, type: 'description' },
    ]);
  });

  it('handles empty fields with hidden', () => {
    expect(migrateFieldsToItems([], 'hidden')).toEqual([]);
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `pnpm --filter @nexushub/domain test --run -- migrate-fields-to-items`
Expected : FAIL — `migrateFieldsToItems is not a function`.

- [ ] **Step 3 : Implémenter**

Dans `packages/domain/src/card-templates/index.ts`, ajouter à la fin :

```ts
/**
 * One-shot migration: convert legacy (fields[], descriptionPosition) shape
 * to the unified items[] shape. Pure function — used by the backfill script.
 */
export function migrateFieldsToItems(
  fields: readonly CardFieldDef[],
  descriptionPosition: CardTemplateDescriptionPosition,
): readonly CardTemplateItem[] {
  const stripped: CardTemplateItem[] = fields.map((f) => {
    // Drop `group`. Keep options/placeholder if present.
    const base: CardTemplateInputItem = { id: f.id, type: f.type, label: f.label };
    return {
      ...base,
      ...(f.options ? { options: [...f.options] } : {}),
      ...(f.placeholder !== undefined ? { placeholder: f.placeholder } : {}),
    };
  });
  const marker: CardTemplateDescriptionItem = { id: DESCRIPTION_ITEM_ID, type: 'description' };

  if (descriptionPosition === 'before-fields') return [marker, ...stripped];
  if (descriptionPosition === 'after-fields') return [...stripped, marker];
  return stripped;
}
```

- [ ] **Step 4 : Vérifier les tests**

Run: `pnpm --filter @nexushub/domain test --run -- migrate-fields-to-items`
Expected : PASS (5 tests).

- [ ] **Step 5 : Run all domain tests**

Run: `pnpm --filter @nexushub/domain test --run`
Expected : tous les tests existants + 20 nouveaux passent.

- [ ] **Step 6 : Commit**

```bash
git add packages/domain/src/card-templates/index.ts packages/domain/src/card-templates/migrate-fields-to-items.test.ts
git commit -m "feat(domain): add migrateFieldsToItems for the legacy → items backfill"
```

---

## Phase 2 — Migration schéma (additive, sans drop)

### Task 5 : Migration Prisma — ajout colonne `items`

**Files:**

- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260512100001_card_template_items/migration.sql`

- [ ] **Step 1 : Ajouter la colonne au schéma**

Dans `packages/db/prisma/schema.prisma`, modèle `CardTemplate`, ajouter `items` après `fields` :

```prisma
  /// Array of CardFieldDef objects (validated client-side; stored as Json).
  fields           Json      @default("[]")
  /// Unified ordered list of CardTemplateItem (input/section/description).
  /// Replaces fields + descriptionPosition (kept dual-write during migration).
  items            Json      @default("[]")
  defaultChecklist String[]  @default([]) @map("default_checklist")
```

- [ ] **Step 2 : Créer la migration SQL manuellement**

Créer le dossier puis le fichier :

```bash
mkdir -p packages/db/prisma/migrations/20260512100001_card_template_items
```

Écrire `packages/db/prisma/migrations/20260512100001_card_template_items/migration.sql` :

```sql
-- Add the unified items column. Populated by data script after deploy.
ALTER TABLE "public"."card_templates"
  ADD COLUMN "items" JSONB NOT NULL DEFAULT '[]';
```

- [ ] **Step 3 : Régénérer le client Prisma + typecheck DB**

Run:

```bash
pnpm --filter @nexushub/db db:generate
pnpm --filter @nexushub/db typecheck
```

Expected : génération OK, typecheck OK.

- [ ] **Step 4 : Appliquer la migration localement**

Run: `pnpm --filter @nexushub/db db:migrate -- --name card_template_items`
Expected : migration appliquée, "Already in sync".
(Si le nom diffère, supprimer le dossier auto-créé par Prisma et garder uniquement le tien.)

- [ ] **Step 5 : Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260512100001_card_template_items
git commit -m "feat(db): add card_templates.items column for unified template items"
```

---

### Task 6 : Script de backfill `items` depuis `fields + description_position`

**Files:**

- Create: `packages/db/prisma/migrations-data/2026-05-12-card-template-items.ts`
- Modify: `packages/db/package.json`

- [ ] **Step 1 : Créer le dossier**

```bash
mkdir -p packages/db/prisma/migrations-data
```

- [ ] **Step 2 : Écrire le script de backfill**

Créer `packages/db/prisma/migrations-data/2026-05-12-card-template-items.ts` :

```ts
/**
 * One-shot data migration: backfill card_templates.items from the legacy
 * (fields[], description_position) shape. Idempotent — skips rows where
 * `items` is already non-empty.
 *
 * Run via: pnpm --filter @nexushub/db migrate-data:card-template-items
 */
import {
  isDescriptionPosition,
  migrateFieldsToItems,
  validateCardFields,
  type CardTemplateDescriptionPosition,
} from '@nexushub/domain';
import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.cardTemplate.findMany({
      select: { id: true, fields: true, descriptionPosition: true, items: true },
    });

    let updated = 0;
    let skipped = 0;
    for (const row of rows) {
      // Idempotency: skip if items already populated.
      if (Array.isArray(row.items) && (row.items as unknown[]).length > 0) {
        skipped++;
        continue;
      }

      const fields = validateCardFields(row.fields) ?? [];
      const descPos: CardTemplateDescriptionPosition = isDescriptionPosition(
        row.descriptionPosition,
      )
        ? row.descriptionPosition
        : 'after-fields';

      const items = migrateFieldsToItems(fields, descPos);
      await prisma.cardTemplate.update({
        where: { id: row.id },
        data: { items: items as unknown as object[] },
      });
      updated++;
    }

    console.log(`✓ Backfill done: ${updated} updated, ${skipped} skipped (already populated).`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 3 : Ajouter le script npm**

Modifier `packages/db/package.json` — ajouter dans `scripts` (après `db:seed`) :

```json
"migrate-data:card-template-items": "tsx --env-file=../../.env.local prisma/migrations-data/2026-05-12-card-template-items.ts",
```

- [ ] **Step 4 : Lancer le backfill localement**

Run: `pnpm --filter @nexushub/db migrate-data:card-template-items`
Expected : `✓ Backfill done: N updated, 0 skipped.`

- [ ] **Step 5 : Vérifier en DB**

Run: `pnpm --filter @nexushub/db db:studio` (ou ouvrir Supabase studio) → table `card_templates` → vérifier que la colonne `items` est peuplée et que la position de la description correspond à `description_position`.

- [ ] **Step 6 : Re-run pour valider l'idempotence**

Run: `pnpm --filter @nexushub/db migrate-data:card-template-items`
Expected : `✓ Backfill done: 0 updated, N skipped (already populated).`

- [ ] **Step 7 : Commit**

```bash
git add packages/db/prisma/migrations-data/ packages/db/package.json
git commit -m "feat(db): backfill script for card_templates.items"
```

---

## Phase 3 — Adapter la lecture (cards rendering + actions projets)

À ce stade, la DB a `items` peuplé pour toutes les lignes. On bascule la lecture côté `/projects` sur `items` tout en gardant la cohabitation côté écriture (un `update-card-template` continue de servir un payload `items`, l'éditeur templates écrira plus tard).

### Task 7 : Adapter `change-card-template.ts` à `items`

**Files:**

- Modify: `apps/web/features/projects/actions/change-card-template.ts`

- [ ] **Step 1 : Lire le fichier**

Read: `apps/web/features/projects/actions/change-card-template.ts` — il fait actuellement `validateCardFields(tpl.fields)` + `pruneFieldValues`.

- [ ] **Step 2 : Remplacer la logique**

Remplacer le contenu entier de la fonction `changeCardTemplate` par la version qui lit `items` :

```ts
'use server';
import 'server-only';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@nexushub/db';
import {
  NotFoundError,
  validateCardTemplateItems,
  pruneFieldValuesByItems,
} from '@nexushub/domain';
import { requireUser } from '@/lib/auth';

const Schema = z.object({
  cardId: z.string().uuid(),
  templateId: z.string().uuid().or(z.literal('')),
});

export async function changeCardTemplate(input: {
  cardId: string;
  templateId: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const ctx = await requireUser();
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Données invalides.' };

  const card = await prisma.card.findFirst({
    where: { id: parsed.data.cardId, workspaceId: ctx.workspaceId, deletedAt: null },
    select: { id: true, projectId: true, fieldValues: true },
  });
  if (!card) throw new NotFoundError('Card');

  let newTemplateId: string | null = null;
  let newItems: ReturnType<typeof validateCardTemplateItems> = [];
  if (parsed.data.templateId.length > 0) {
    const tpl = await prisma.cardTemplate.findFirst({
      where: { id: parsed.data.templateId, workspaceId: ctx.workspaceId, deletedAt: null },
      select: { id: true, items: true },
    });
    if (!tpl) return { ok: false, message: 'Template introuvable.' };
    newTemplateId = tpl.id;
    newItems = validateCardTemplateItems(tpl.items) ?? [];
  }

  const currentValues =
    card.fieldValues && typeof card.fieldValues === 'object' && !Array.isArray(card.fieldValues)
      ? (card.fieldValues as Record<string, unknown>)
      : {};
  const prunedValues = pruneFieldValuesByItems(currentValues, newItems ?? []);

  await prisma.card.update({
    where: { id: card.id },
    data: {
      templateId: newTemplateId,
      fieldValues: prunedValues,
    },
  });

  revalidatePath(`/projects/${card.projectId}`);
  return { ok: true };
}
```

- [ ] **Step 3 : Typecheck**

Run: `pnpm --filter web typecheck`
Expected : PASS.

- [ ] **Step 4 : Commit**

```bash
git add apps/web/features/projects/actions/change-card-template.ts
git commit -m "feat(projects): change-card-template reads items instead of fields"
```

---

### Task 8 : Adapter `update-card-field.ts` à `items`

**Files:**

- Modify: `apps/web/features/projects/actions/update-card-field.ts`

- [ ] **Step 1 : Inspecter le fichier**

Read: `apps/web/features/projects/actions/update-card-field.ts`. Trouver le block qui fait `validateCardFields(card.template?.fields ?? [])` et l'usage qui en suit (validation par type).

- [ ] **Step 2 : Remplacer la validation des champs**

Dans `update-card-field.ts` :

- Remplacer l'import `validateCardFields` par `validateCardTemplateItems`.
- Remplacer `select: { template: { select: { fields: true } } }` par `select: { template: { select: { items: true } } }`.
- Remplacer `const fields = validateCardFields(card.template?.fields ?? []) ?? [];` par :

```ts
const items = validateCardTemplateItems(card.template?.items ?? []) ?? [];
const field = items.find(
  (it) => it.id === parsed.data.fieldId && it.type !== 'section' && it.type !== 'description',
);
```

- Remplacer toutes les références ultérieures `fields.find(...)` ou la variable `field` issue de l'ancien code par cette nouvelle `field`.

- [ ] **Step 3 : Typecheck**

Run: `pnpm --filter web typecheck`
Expected : PASS.

- [ ] **Step 4 : Run le test existant**

Run: `pnpm --filter web test --run -- update-card-due-date` (vérifie qu'on n'a rien cassé dans les actions voisines).
Expected : PASS.

- [ ] **Step 5 : Commit**

```bash
git add apps/web/features/projects/actions/update-card-field.ts
git commit -m "feat(projects): update-card-field validates against template items"
```

---

### Task 9 : Adapter `card-modal.tsx` pour rendre `items`

**Files:**

- Modify: `apps/web/features/projects/components/card-modal.tsx`
- Modify: `apps/web/features/projects/components/template-fields-section.tsx`

On remplace le bloc conditionnel `descriptionPosition` + la boucle groups par un seul mapping sur `items`.

- [ ] **Step 1 : Modifier la signature `CardModalProps.card`**

Dans `apps/web/features/projects/components/card-modal.tsx`, lignes 35-51, remplacer :

```ts
    readonly templateId: string | null;
    readonly templateFields: readonly CardFieldDef[];
    readonly fieldValues: Record<string, string>;
    readonly descriptionPosition: CardTemplateDescriptionPosition;
```

par :

```ts
    readonly templateId: string | null;
    readonly templateItems: readonly CardTemplateItem[];
    readonly fieldValues: Record<string, string>;
```

Mettre à jour l'import en haut du fichier — remplacer :

```ts
import type { CardFieldDef, CardTemplateDescriptionPosition } from '@nexushub/domain';
```

par :

```ts
import type { CardTemplateItem } from '@nexushub/domain';
```

- [ ] **Step 2 : Remplacer la zone de rendu fields + description (lignes 138-163 environ)**

Remplacer les 3 blocs conditionnels (`descriptionPosition === 'before-fields'` / `templateFields.length > 0` / `descriptionPosition === 'after-fields'`) par un seul appel à un nouveau composant :

```tsx
<TemplateItemsRender
  cardId={card.id}
  items={card.templateItems}
  fieldValues={card.fieldValues}
  description={card.description ?? ''}
/>
```

- [ ] **Step 3 : Réécrire `template-fields-section.tsx` → `template-items-render.tsx`**

Renommer le fichier : `git mv apps/web/features/projects/components/template-fields-section.tsx apps/web/features/projects/components/template-items-render.tsx`.

Réécrire son contenu :

```tsx
'use client';
import { useEffect, useRef, useState } from 'react';
import type { CardTemplateItem, CardTemplateInputItem } from '@nexushub/domain';
import { updateCardField } from '../actions/update-card-field';
import { CardDescriptionInput } from './card-description-input';

export interface TemplateItemsRenderProps {
  readonly cardId: string;
  readonly items: readonly CardTemplateItem[];
  readonly fieldValues: Record<string, string>;
  readonly description: string;
}

export function TemplateItemsRender({
  cardId,
  items,
  fieldValues,
  description,
}: TemplateItemsRenderProps) {
  if (items.length === 0) return null;
  return (
    <>
      {items.map((item) => {
        if (item.type === 'section') {
          return (
            <section className="modal-section" key={item.id}>
              <div className="section-label">{item.label}</div>
            </section>
          );
        }
        if (item.type === 'description') {
          return (
            <section className="modal-section" key={item.id}>
              <div className="section-label">Description</div>
              <CardDescriptionInput cardId={cardId} initial={description} />
            </section>
          );
        }
        return (
          <section className="modal-section" key={item.id}>
            <FieldInput cardId={cardId} field={item} initial={fieldValues[item.id] ?? ''} />
          </section>
        );
      })}
    </>
  );
}

function FieldInput({
  cardId,
  field,
  initial,
}: {
  cardId: string;
  field: CardTemplateInputItem;
  initial: string;
}) {
  // [reuse the existing FieldInput body from template-fields-section.tsx
  //  unchanged — copy lines 58-206 verbatim into here, replacing
  //  `CardFieldDef` with `CardTemplateInputItem` in the prop type.]
}
```

Note: copier verbatim le corps actuel de `FieldInput` (lignes 58-206 de l'ancien `template-fields-section.tsx`) en changeant juste le type `field: CardFieldDef` → `field: CardTemplateInputItem`.

- [ ] **Step 4 : Sortir `CardDescriptionInput` dans son propre fichier**

Le composant `CardDescriptionInput` est défini en interne dans `card-modal.tsx`. Il est maintenant appelé depuis `template-items-render.tsx`, donc on l'extrait :

Créer `apps/web/features/projects/components/card-description-input.tsx`.

Trouver la définition `function CardDescriptionInput(...)` dans `card-modal.tsx` (chercher `function CardDescriptionInput`), copier toute la définition + ses imports nécessaires (`updateCard`, `useTransition`, etc.) dans le nouveau fichier. Supprimer du `card-modal.tsx`. Ajouter en haut de `card-modal.tsx` :

```ts
import { CardDescriptionInput } from './card-description-input';
```

Puis ajouter aussi `import { TemplateItemsRender } from './template-items-render';` à la place de l'import `template-fields-section`.

- [ ] **Step 5 : Typecheck**

Run: `pnpm --filter web typecheck`
Expected : PASS (les autres usages de `templateFields`/`descriptionPosition` doivent être tous remplacés ; sinon corriger).

- [ ] **Step 6 : Commit**

```bash
git add apps/web/features/projects/components/
git commit -m "feat(projects): card modal renders templateItems (sections + description + fields)"
```

---

### Task 10 : Adapter `projects/[id]/page.tsx` pour passer `items`

**Files:**

- Modify: `apps/web/app/(app)/projects/[id]/page.tsx`

- [ ] **Step 1 : Lire le fichier (lignes ~100-250)**

Read: `apps/web/app/(app)/projects/[id]/page.tsx` lignes 100-260 pour repérer le mapping vers `CardModal`.

- [ ] **Step 2 : Modifier le `select` de la requête template**

Ligne ~112, remplacer :

```ts
template: { select: { fields: true, descriptionPosition: true } },
```

par :

```ts
template: { select: { items: true } },
```

- [ ] **Step 3 : Modifier le mapping vers les props `card`**

Lignes ~230-250, dans l'objet `card` passé à `<CardModal />`, remplacer :

```ts
templateFields: validateCardFields(openCard.template?.fields ?? []) ?? [],
…
descriptionPosition: ((): CardTemplateDescriptionPosition => {
  const raw = openCard.template?.descriptionPosition;
  …
})(),
```

par :

```ts
templateItems: validateCardTemplateItems(openCard.template?.items ?? []) ?? [],
```

Mettre à jour l'import en haut du fichier — remplacer :

```ts
import {
  validateCardFields,
  isDescriptionPosition,
  type CardTemplateDescriptionPosition,
  …
} from '@nexushub/domain';
```

par :

```ts
import {
  validateCardTemplateItems,
  …
} from '@nexushub/domain';
```

(retirer `validateCardFields`, `isDescriptionPosition`, `CardTemplateDescriptionPosition` s'ils ne sont plus utilisés ailleurs dans le fichier — vérifier avec grep avant suppression).

- [ ] **Step 4 : Typecheck + lint**

Run: `pnpm --filter web typecheck && pnpm --filter web lint`
Expected : PASS.

- [ ] **Step 5 : Test manuel rapide**

Run: `pnpm --filter web dev`
Ouvrir un projet, ouvrir une carte qui a un template avec description. Vérifier que la carte rend correctement (titre, brief, description) selon l'ordre des items. Fermer le serveur (Ctrl+C).

- [ ] **Step 6 : Commit**

```bash
git add apps/web/app/\(app\)/projects/\[id\]/page.tsx
git commit -m "feat(projects): page passes templateItems to CardModal"
```

---

## Phase 4 — Server actions templates

### Task 11 : Adapter `templates/cards/actions.ts` pour accepter `items`

**Files:**

- Modify: `apps/web/features/templates/cards/actions.ts`

- [ ] **Step 1 : Lire le fichier**

Read: `apps/web/features/templates/cards/actions.ts` — repérer `CreateSchema`, `UpdateSchema`, et les appels Prisma.

- [ ] **Step 2 : Remplacer `FieldsSchema` + `DescriptionPositionSchema` par `ItemsSchema`**

Remplacer le bloc complet (`FieldsSchema = …` + `DescriptionPositionSchema = …`) par :

```ts
const ItemsSchema = z
  .array(z.unknown())
  .max(60)
  .default([])
  .transform((arr, ctx) => {
    const validated = validateCardTemplateItems(arr);
    if (validated === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Définition d'items invalide.",
      });
      return [] as readonly CardTemplateItem[];
    }
    return validated;
  });
```

Et remplacer l'import :

```ts
import {
  NotFoundError,
  validateCardFields,
  validateCardTemplateName,
  type CardFieldDef,
} from '@nexushub/domain';
```

par :

```ts
import {
  NotFoundError,
  validateCardTemplateItems,
  validateCardTemplateName,
  type CardTemplateItem,
} from '@nexushub/domain';
```

- [ ] **Step 3 : Remplacer les schémas + signatures**

Remplacer `CreateSchema` :

```ts
const CreateSchema = z.object({
  name: NameSchema,
  body: BodySchema,
  items: ItemsSchema,
  defaultChecklist: ChecklistSchema,
  isDefault: z.boolean().default(false),
});
```

(plus de `fields` ni de `descriptionPosition`). Idem pour `UpdateSchema` via `extend`.

Remplacer la signature `createCardTemplate(input: {...})` et son corps :

```ts
export async function createCardTemplate(input: {
  name: string;
  body: string;
  items: readonly CardTemplateItem[];
  defaultChecklist: string[];
  isDefault: boolean;
}): Promise<TemplateMutationResult> {
  const ctx = await requireUser();
  const parsed = CreateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Données invalides.' };
  }

  try {
    if (parsed.data.isDefault) {
      await prisma.cardTemplate.updateMany({
        where: { workspaceId: ctx.workspaceId, deletedAt: null, isDefault: true },
        data: { isDefault: false },
      });
    }
    const created = await prisma.cardTemplate.create({
      data: {
        workspaceId: ctx.workspaceId,
        name: parsed.data.name,
        body: parsed.data.body,
        items: parsed.data.items as unknown as Prisma.InputJsonValue,
        defaultChecklist: parsed.data.defaultChecklist,
        isDefault: parsed.data.isDefault,
      },
      select: { id: true },
    });
    revalidatePath('/templates/cards');
    return { ok: true, id: created.id };
  } catch (err) {
    if (prismaErrorCode(err) === 'P2002') {
      return { ok: false, message: 'Un template porte déjà ce nom.' };
    }
    throw err;
  }
}
```

(Note : on ne setait plus `fields` ni `descriptionPosition` dans le `data` — l'ancien colonne reste mais avec sa valeur par défaut `[]` / `'after-fields'`. Ça reste valide jusqu'au DROP final.)

Faire la même chose pour `updateCardTemplate` (remplacer `fields` + `descriptionPosition` par `items` dans le `data` du `prisma.cardTemplate.update`).

- [ ] **Step 4 : Typecheck**

Run: `pnpm --filter web typecheck`
Expected : PASS — l'éditeur templates appelle encore `createCardTemplate({ fields, descriptionPosition, … })` donc le typecheck échouera **ici**. On corrige dans la phase suivante. Pour ce step, on accepte un échec localisé à `apps/web/features/templates/cards/editor.tsx` uniquement. Si d'autres fichiers échouent, c'est un signal de manque.

- [ ] **Step 5 : Commit (avec build cassé temporaire annoncé dans le message)**

```bash
git add apps/web/features/templates/cards/actions.ts
git commit -m "feat(templates): actions accept items[] (editor wiring follows next)"
```

---

## Phase 5 — Réécriture UI de l'éditeur templates

À ce stade, le nouveau modèle est en place côté domain + DB + lecture. Reste l'éditeur templates lui-même, qui aujourd'hui consomme `fields[]` + `descriptionPosition`. On le réécrit en 8 fichiers focalisés.

### Task 12 : Reducer `use-editor-state.ts` (TDD)

**Files:**

- Create: `apps/web/features/templates/cards/use-editor-state.ts`
- Create: `apps/web/features/templates/cards/use-editor-state.test.ts`

- [ ] **Step 1 : Écrire les tests d'abord**

Créer `apps/web/features/templates/cards/use-editor-state.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import {
  reduceEditorState,
  makeInitialState,
  type EditorState,
  type Action,
} from './use-editor-state';
import { DESCRIPTION_ITEM_ID } from '@nexushub/domain';

const baseTemplate = {
  id: 't1',
  name: 'Tâche standard',
  items: [
    { id: 'title', type: 'text' as const, label: 'Titre' },
    { id: DESCRIPTION_ITEM_ID, type: 'description' as const },
  ],
};

describe('reduceEditorState', () => {
  it('selectTemplate loads the draft', () => {
    const initial = makeInitialState([baseTemplate]);
    const next = reduceEditorState(initial, { type: 'selectTemplate', id: 't1' });
    expect(next.selectedId).toBe('t1');
    expect(next.draft).toEqual({ name: 'Tâche standard', items: baseTemplate.items });
    expect(next.isDirty).toBe(false);
  });

  it('renameDraft marks dirty', () => {
    const s1 = reduceEditorState(makeInitialState([baseTemplate]), {
      type: 'selectTemplate',
      id: 't1',
    });
    const s2 = reduceEditorState(s1, { type: 'renameDraft', name: 'Autre nom' });
    expect(s2.draft?.name).toBe('Autre nom');
    expect(s2.isDirty).toBe(true);
  });

  it('addItem appends with default label and opens drawer on it', () => {
    const s1 = reduceEditorState(makeInitialState([baseTemplate]), {
      type: 'selectTemplate',
      id: 't1',
    });
    const s2 = reduceEditorState(s1, { type: 'addItem', itemType: 'text' });
    expect(s2.draft?.items.length).toBe(3);
    const added = s2.draft!.items[2];
    expect(added.type).toBe('text');
    expect(s2.editingItemId).toBe(added.id);
    expect(s2.isDirty).toBe(true);
  });

  it('addItem of type description is rejected when description already present', () => {
    const s1 = reduceEditorState(makeInitialState([baseTemplate]), {
      type: 'selectTemplate',
      id: 't1',
    });
    const s2 = reduceEditorState(s1, { type: 'addItem', itemType: 'description' });
    expect(s2.draft?.items.length).toBe(2);
  });

  it('removeItem drops the item and closes the drawer if it was open', () => {
    const s1 = reduceEditorState(makeInitialState([baseTemplate]), {
      type: 'selectTemplate',
      id: 't1',
    });
    const s2: EditorState = { ...s1, editingItemId: 'title' };
    const s3 = reduceEditorState(s2, { type: 'removeItem', id: 'title' });
    expect(s3.draft?.items.map((i) => i.id)).toEqual([DESCRIPTION_ITEM_ID]);
    expect(s3.editingItemId).toBeNull();
  });

  it('reorderItems swaps positions', () => {
    const s1 = reduceEditorState(makeInitialState([baseTemplate]), {
      type: 'selectTemplate',
      id: 't1',
    });
    const s2 = reduceEditorState(s1, { type: 'reorderItems', from: 0, to: 1 });
    expect(s2.draft?.items.map((i) => i.id)).toEqual([DESCRIPTION_ITEM_ID, 'title']);
  });

  it('updateItem patches an input item live', () => {
    const s1 = reduceEditorState(makeInitialState([baseTemplate]), {
      type: 'selectTemplate',
      id: 't1',
    });
    const s2 = reduceEditorState(s1, {
      type: 'updateItem',
      id: 'title',
      patch: { label: 'Nouveau' },
    });
    const updated = s2.draft!.items[0];
    expect(updated.type).toBe('text');
    if (updated.type === 'text') expect(updated.label).toBe('Nouveau');
  });

  it('convertItemType keeps label, replaces options on select→text', () => {
    const tplWithSelect = {
      id: 't2',
      name: 'X',
      items: [{ id: 's', type: 'select' as const, label: 'S', options: ['a', 'b'] }],
    };
    const s1 = reduceEditorState(makeInitialState([tplWithSelect]), {
      type: 'selectTemplate',
      id: 't2',
    });
    const s2 = reduceEditorState(s1, { type: 'convertItemType', id: 's', toType: 'text' });
    const updated = s2.draft!.items[0];
    expect(updated.type).toBe('text');
    if (updated.type === 'text') expect(updated.label).toBe('S');
    expect('options' in updated).toBe(false);
  });

  it('convertItemType text→select initializes empty options', () => {
    const s1 = reduceEditorState(makeInitialState([baseTemplate]), {
      type: 'selectTemplate',
      id: 't1',
    });
    const s2 = reduceEditorState(s1, { type: 'convertItemType', id: 'title', toType: 'select' });
    const updated = s2.draft!.items[0];
    expect(updated.type).toBe('select');
    if (updated.type === 'select') expect(updated.options).toEqual([]);
  });

  it('saved clears dirty + replaces the template in the cache', () => {
    const s1 = reduceEditorState(makeInitialState([baseTemplate]), {
      type: 'selectTemplate',
      id: 't1',
    });
    const s2 = reduceEditorState(s1, { type: 'renameDraft', name: 'Renommé' });
    const s3 = reduceEditorState(s2, {
      type: 'saved',
      template: { ...baseTemplate, name: 'Renommé' },
    });
    expect(s3.isDirty).toBe(false);
    expect(s3.templates.find((t) => t.id === 't1')?.name).toBe('Renommé');
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `pnpm --filter web test --run -- use-editor-state`
Expected : FAIL — fichier `use-editor-state.ts` n'existe pas.

- [ ] **Step 3 : Implémenter le reducer**

Créer `apps/web/features/templates/cards/use-editor-state.ts` :

```ts
'use client';
import { useReducer, useMemo } from 'react';
import {
  DESCRIPTION_ITEM_ID,
  defaultLabelForItemType,
  generateCustomFieldId,
  type CardTemplateItem,
  type CardTemplateInputType,
} from '@nexushub/domain';

export interface TemplateDTO {
  readonly id: string;
  readonly name: string;
  readonly items: readonly CardTemplateItem[];
  readonly isDefault?: boolean;
}

export interface EditorDraft {
  readonly name: string;
  readonly items: readonly CardTemplateItem[];
}

export interface EditorState {
  readonly templates: readonly TemplateDTO[];
  readonly selectedId: string | null;
  readonly draft: EditorDraft | null;
  readonly editingItemId: string | null;
  readonly isDirty: boolean;
}

export type Action =
  | { type: 'selectTemplate'; id: string }
  | { type: 'deselect' }
  | { type: 'renameDraft'; name: string }
  | { type: 'addItem'; itemType: CardTemplateItem['type'] }
  | { type: 'removeItem'; id: string }
  | { type: 'reorderItems'; from: number; to: number }
  | { type: 'updateItem'; id: string; patch: Record<string, unknown> }
  | { type: 'convertItemType'; id: string; toType: CardTemplateInputType }
  | { type: 'openItemDrawer'; id: string }
  | { type: 'closeItemDrawer' }
  | { type: 'saved'; template: TemplateDTO }
  | { type: 'created'; template: TemplateDTO }
  | { type: 'deleted'; id: string };

export function makeInitialState(templates: readonly TemplateDTO[]): EditorState {
  return { templates, selectedId: null, draft: null, editingItemId: null, isDirty: false };
}

function findItemIndex(items: readonly CardTemplateItem[], id: string): number {
  return items.findIndex((i) => i.id === id);
}

function takenIds(items: readonly CardTemplateItem[]): Set<string> {
  return new Set(items.map((i) => i.id));
}

export function reduceEditorState(state: EditorState, action: Action): EditorState {
  switch (action.type) {
    case 'selectTemplate': {
      const tpl = state.templates.find((t) => t.id === action.id);
      if (!tpl) return state;
      return {
        ...state,
        selectedId: tpl.id,
        draft: { name: tpl.name, items: tpl.items },
        editingItemId: null,
        isDirty: false,
      };
    }
    case 'deselect':
      return { ...state, selectedId: null, draft: null, editingItemId: null, isDirty: false };
    case 'renameDraft':
      if (!state.draft) return state;
      return { ...state, draft: { ...state.draft, name: action.name }, isDirty: true };
    case 'addItem': {
      if (!state.draft) return state;
      // Description is singleton.
      if (action.itemType === 'description') {
        if (state.draft.items.some((i) => i.type === 'description')) return state;
        const newItem: CardTemplateItem = { id: DESCRIPTION_ITEM_ID, type: 'description' };
        return {
          ...state,
          draft: { ...state.draft, items: [...state.draft.items, newItem] },
          editingItemId: newItem.id,
          isDirty: true,
        };
      }
      const label = defaultLabelForItemType(action.itemType);
      const id = generateCustomFieldId(label, takenIds(state.draft.items));
      let newItem: CardTemplateItem;
      if (action.itemType === 'section') {
        newItem = { id, type: 'section', label };
      } else if (action.itemType === 'select') {
        newItem = { id, type: 'select', label, options: [] };
      } else {
        newItem = { id, type: action.itemType, label };
      }
      return {
        ...state,
        draft: { ...state.draft, items: [...state.draft.items, newItem] },
        editingItemId: newItem.id,
        isDirty: true,
      };
    }
    case 'removeItem': {
      if (!state.draft) return state;
      const idx = findItemIndex(state.draft.items, action.id);
      if (idx === -1) return state;
      const next = [...state.draft.items.slice(0, idx), ...state.draft.items.slice(idx + 1)];
      return {
        ...state,
        draft: { ...state.draft, items: next },
        editingItemId: state.editingItemId === action.id ? null : state.editingItemId,
        isDirty: true,
      };
    }
    case 'reorderItems': {
      if (!state.draft) return state;
      const { from, to } = action;
      if (from === to) return state;
      const items = [...state.draft.items];
      const [moved] = items.splice(from, 1);
      if (!moved) return state;
      items.splice(to, 0, moved);
      return { ...state, draft: { ...state.draft, items }, isDirty: true };
    }
    case 'updateItem': {
      if (!state.draft) return state;
      const next = state.draft.items.map((it) => {
        if (it.id !== action.id) return it;
        // description has no editable fields
        if (it.type === 'description') return it;
        return { ...it, ...action.patch } as CardTemplateItem;
      });
      return { ...state, draft: { ...state.draft, items: next }, isDirty: true };
    }
    case 'convertItemType': {
      if (!state.draft) return state;
      const next = state.draft.items.map((it) => {
        if (it.id !== action.id) return it;
        if (it.type === 'description' || it.type === 'section') return it;
        const toType = action.toType;
        // Preserve label + placeholder; reset options when leaving/entering select.
        const base = { id: it.id, label: it.label };
        const placeholder = 'placeholder' in it ? it.placeholder : undefined;
        if (toType === 'select') {
          return {
            ...base,
            type: 'select',
            options: [],
            ...(placeholder !== undefined ? { placeholder } : {}),
          } as CardTemplateItem;
        }
        return {
          ...base,
          type: toType,
          ...(placeholder !== undefined ? { placeholder } : {}),
        } as CardTemplateItem;
      });
      return { ...state, draft: { ...state.draft, items: next }, isDirty: true };
    }
    case 'openItemDrawer':
      return { ...state, editingItemId: action.id };
    case 'closeItemDrawer':
      return { ...state, editingItemId: null };
    case 'saved': {
      return {
        ...state,
        templates: state.templates.map((t) => (t.id === action.template.id ? action.template : t)),
        isDirty: false,
      };
    }
    case 'created': {
      return {
        ...state,
        templates: [...state.templates, action.template],
        selectedId: action.template.id,
        draft: { name: action.template.name, items: action.template.items },
        editingItemId: null,
        isDirty: false,
      };
    }
    case 'deleted':
      return {
        ...state,
        templates: state.templates.filter((t) => t.id !== action.id),
        selectedId: state.selectedId === action.id ? null : state.selectedId,
        draft: state.selectedId === action.id ? null : state.draft,
        editingItemId: state.selectedId === action.id ? null : state.editingItemId,
        isDirty: state.selectedId === action.id ? false : state.isDirty,
      };
  }
}

export function useEditorState(initial: readonly TemplateDTO[]) {
  const [state, dispatch] = useReducer(reduceEditorState, undefined, () =>
    makeInitialState(initial),
  );
  const selectedTemplate = useMemo(
    () =>
      state.selectedId ? (state.templates.find((t) => t.id === state.selectedId) ?? null) : null,
    [state.selectedId, state.templates],
  );
  return { state, dispatch, selectedTemplate };
}
```

- [ ] **Step 4 : Vérifier que les tests passent**

Run: `pnpm --filter web test --run -- use-editor-state`
Expected : PASS (10 tests).

- [ ] **Step 5 : Commit**

```bash
git add apps/web/features/templates/cards/use-editor-state.ts apps/web/features/templates/cards/use-editor-state.test.ts
git commit -m "feat(templates): editor reducer + tests for the items model"
```

---

### Task 13 : Composants statiques — `preview-card-body.tsx` + `template-preview.tsx`

**Files:**

- Create: `apps/web/features/templates/cards/preview-card-body.tsx`
- Create: `apps/web/features/templates/cards/template-preview.tsx`

L'aperçu doit ressembler au modal carte. On réutilise les classes CSS existantes (`modal-section`, `section-label`, `field-input`, etc.) — pas besoin de framer-motion ni de Radix.

- [ ] **Step 1 : Créer `preview-card-body.tsx`**

```tsx
'use client';
import type { CardTemplateItem, CardTemplateInputItem } from '@nexushub/domain';

export interface PreviewCardBodyProps {
  readonly items: readonly CardTemplateItem[];
}

export function PreviewCardBody({ items }: PreviewCardBodyProps) {
  if (items.length === 0) {
    return (
      <p className="text-xs text-[color:var(--color-text-muted)]">
        Aucun item — ajoute des champs, sections ou la description.
      </p>
    );
  }
  return (
    <div className="grid gap-4">
      {items.map((item) => {
        if (item.type === 'section') {
          return (
            <div className="section-label" key={item.id}>
              {item.label}
            </div>
          );
        }
        if (item.type === 'description') {
          return (
            <section className="modal-section" key={item.id}>
              <div className="section-label">Description</div>
              <p className="text-xs italic text-[color:var(--color-text-muted)]">
                Description de la carte (placeholder).
              </p>
            </section>
          );
        }
        return <PreviewField key={item.id} field={item} />;
      })}
    </div>
  );
}

function PreviewField({ field }: { field: CardTemplateInputItem }) {
  const ph = previewPlaceholder(field);
  return (
    <label className="grid gap-1">
      <span className="text-[11px] font-bold text-[color:var(--color-text-soft)]">
        {field.label}
      </span>
      {field.type === 'longtext' ? (
        <textarea rows={3} readOnly value={ph} className="field-input opacity-70" />
      ) : field.type === 'select' ? (
        <select className="field-select opacity-70" disabled value={ph}>
          <option>{ph}</option>
        </select>
      ) : field.type === 'checkbox' ? (
        <input type="checkbox" disabled />
      ) : (
        <input
          type={
            field.type === 'date'
              ? 'date'
              : field.type === 'number'
                ? 'number'
                : field.type === 'link'
                  ? 'url'
                  : 'text'
          }
          readOnly
          value={ph}
          className="field-input opacity-70"
        />
      )}
    </label>
  );
}

function previewPlaceholder(field: CardTemplateInputItem): string {
  if (field.placeholder) return field.placeholder;
  switch (field.type) {
    case 'text':
    case 'longtext':
      return 'Lorem ipsum dolor sit amet…';
    case 'select':
      return field.options?.[0] ?? '— Non défini —';
    case 'link':
      return 'https://example.com';
    case 'date':
      return new Date().toISOString().slice(0, 10);
    case 'number':
      return '42';
    case 'checkbox':
      return '';
  }
}
```

- [ ] **Step 2 : Créer `template-preview.tsx`**

```tsx
'use client';
import type { CardTemplateItem } from '@nexushub/domain';
import { PreviewCardBody } from './preview-card-body';

export interface TemplatePreviewProps {
  readonly templateName: string;
  readonly items: readonly CardTemplateItem[];
}

export function TemplatePreview({ templateName, items }: TemplatePreviewProps) {
  return (
    <aside className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-4">
      <header className="mb-4">
        <p className="text-[10px] font-extrabold uppercase tracking-[1px] text-[color:var(--color-text-muted)]">
          Aperçu
        </p>
        <h2 className="text-lg font-bold">{templateName || 'Sans titre'}</h2>
      </header>
      <PreviewCardBody items={items} />
    </aside>
  );
}
```

- [ ] **Step 3 : Typecheck**

Run: `pnpm --filter web typecheck`
Expected : PASS (sauf erreurs résiduelles dans `editor.tsx` qu'on traite plus tard).

- [ ] **Step 4 : Commit**

```bash
git add apps/web/features/templates/cards/preview-card-body.tsx apps/web/features/templates/cards/template-preview.tsx
git commit -m "feat(templates): preview-card-body + template-preview components"
```

---

### Task 14 : Composant `templates-list.tsx` (colonne gauche)

**Files:**

- Create: `apps/web/features/templates/cards/templates-list.tsx`

- [ ] **Step 1 : Créer le composant**

```tsx
'use client';
import type { TemplateDTO } from './use-editor-state';

export interface TemplatesListProps {
  readonly templates: readonly TemplateDTO[];
  readonly selectedId: string | null;
  readonly isDirty: boolean;
  readonly onSelect: (id: string) => void;
  readonly onCreate: () => void;
  readonly onDelete: (id: string, name: string) => void;
}

export function TemplatesList({
  templates,
  selectedId,
  isDirty,
  onSelect,
  onCreate,
  onDelete,
}: TemplatesListProps) {
  return (
    <aside className="flex h-full flex-col gap-2 rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-3">
      <header className="flex items-center justify-between px-1">
        <p className="text-[10px] font-extrabold uppercase tracking-[1px] text-[color:var(--color-text-muted)]">
          Templates
        </p>
        <button
          type="button"
          onClick={() => {
            if (
              isDirty &&
              !window.confirm('Modifications non sauvées. Créer un nouveau template quand même ?')
            )
              return;
            onCreate();
          }}
          className="rounded-md border border-dashed border-[color:var(--color-border)] px-2 py-0.5 text-xs text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)]"
        >
          + Nouveau
        </button>
      </header>
      <ul className="flex flex-col gap-1">
        {templates.length === 0 ? (
          <li className="px-2 py-3 text-xs text-[color:var(--color-text-muted)]">
            Aucun template — crée le premier ↑
          </li>
        ) : (
          templates.map((t) => (
            <li key={t.id} className="group flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  if (selectedId === t.id) return;
                  if (
                    isDirty &&
                    !window.confirm('Modifications non sauvées. Changer de template ?')
                  )
                    return;
                  onSelect(t.id);
                }}
                className={`flex-1 truncate rounded-md px-2 py-1.5 text-left text-sm ${
                  selectedId === t.id
                    ? 'bg-[color:var(--color-accent-soft,rgba(91,108,255,0.12))] font-medium text-[color:var(--color-text)]'
                    : 'text-[color:var(--color-text-soft)] hover:bg-[color:var(--color-surface-2,#f6f7fb)]'
                }`}
              >
                {t.name || 'Sans titre'}
              </button>
              <button
                type="button"
                aria-label={`Supprimer ${t.name}`}
                onClick={() => onDelete(t.id, t.name)}
                className="rounded-md px-1 text-sm text-[color:var(--color-text-muted)] opacity-0 hover:text-[color:#e0506b] group-hover:opacity-100"
              >
                ×
              </button>
            </li>
          ))
        )}
      </ul>
    </aside>
  );
}
```

- [ ] **Step 2 : Typecheck**

Run: `pnpm --filter web typecheck`
Expected : PASS (sauf `editor.tsx` toujours en transition).

- [ ] **Step 3 : Commit**

```bash
git add apps/web/features/templates/cards/templates-list.tsx
git commit -m "feat(templates): templates-list (column 1) with create + delete"
```

---

### Task 15 : `item-row.tsx` + `items-list.tsx` (drag & drop)

**Files:**

- Create: `apps/web/features/templates/cards/item-row.tsx`
- Create: `apps/web/features/templates/cards/items-list.tsx`

- [ ] **Step 1 : `item-row.tsx`**

```tsx
'use client';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { CardTemplateItem } from '@nexushub/domain';

const TYPE_ICON: Record<CardTemplateItem['type'], string> = {
  text: 'Aa',
  longtext: '¶',
  select: '▣',
  link: '🔗',
  checkbox: '☑',
  date: '📅',
  number: '#',
  section: '§',
  description: '¶',
};

const TYPE_LABEL: Record<CardTemplateItem['type'], string> = {
  text: 'Texte court',
  longtext: 'Texte long',
  select: 'Liste',
  link: 'Lien',
  checkbox: 'Case',
  date: 'Date',
  number: 'Nombre',
  section: 'Section',
  description: 'Description',
};

export interface ItemRowProps {
  readonly item: CardTemplateItem;
  readonly isEditing: boolean;
  readonly onEdit: (id: string) => void;
  readonly onRemove: (id: string) => void;
}

export function ItemRow({ item, isEditing, onEdit, onRemove }: ItemRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  const isSection = item.type === 'section';
  const isDesc = item.type === 'description';

  return (
    <li
      ref={setNodeRef}
      style={style}
      onClick={() => onEdit(item.id)}
      className={`group flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
        isEditing
          ? 'border-[color:var(--color-accent,#5b6cff)] bg-[color:var(--color-accent-soft,rgba(91,108,255,0.06))]'
          : isSection
            ? 'border-dashed border-[color:var(--color-border)] bg-[color:var(--color-surface)]'
            : isDesc
              ? 'border-[color:var(--color-accent,#5b6cff)]/30 bg-[color:var(--color-accent-soft,rgba(91,108,255,0.06))]/50'
              : 'border-[color:var(--color-border)] bg-[color:var(--color-surface-2,#f6f7fb)]'
      }`}
    >
      <span
        {...attributes}
        {...listeners}
        onClick={(e) => e.stopPropagation()}
        className="cursor-grab select-none text-xs text-[color:var(--color-text-muted)]"
        aria-label="Réorganiser"
      >
        ⋮⋮
      </span>
      <span className="flex h-6 w-6 items-center justify-center rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-surface)] text-xs">
        {TYPE_ICON[item.type]}
      </span>
      <span className="flex-1 truncate font-medium">
        {item.type === 'description' ? 'Description' : item.label}
      </span>
      <span className="rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-2 py-0.5 text-[10px] text-[color:var(--color-text-muted)]">
        {TYPE_LABEL[item.type]}
      </span>
      <span className="flex gap-1 opacity-60 group-hover:opacity-100">
        <button
          type="button"
          aria-label="Supprimer"
          onClick={(e) => {
            e.stopPropagation();
            if (!window.confirm('Supprimer cet item ?')) return;
            onRemove(item.id);
          }}
          className="rounded border border-[color:var(--color-border)] px-1.5 py-0.5 text-xs text-[color:var(--color-text-muted)] hover:border-[#e0506b] hover:text-[#e0506b]"
        >
          ×
        </button>
      </span>
    </li>
  );
}
```

- [ ] **Step 2 : `items-list.tsx`**

```tsx
'use client';
import { useId } from 'react';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import type { CardTemplateItem } from '@nexushub/domain';
import { ItemRow } from './item-row';

export interface ItemsListProps {
  readonly items: readonly CardTemplateItem[];
  readonly editingItemId: string | null;
  readonly onReorder: (from: number, to: number) => void;
  readonly onEdit: (id: string) => void;
  readonly onRemove: (id: string) => void;
}

export function ItemsList({ items, editingItemId, onReorder, onEdit, onRemove }: ItemsListProps) {
  const idPrefix = useId();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = items.findIndex((i) => i.id === e.active.id);
    const to = items.findIndex((i) => i.id === e.over!.id);
    if (from === -1 || to === -1) return;
    onReorder(from, to);
  };

  if (items.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-[color:var(--color-border)] px-3 py-6 text-center text-xs text-[color:var(--color-text-muted)]">
        Aucun item — utilise « + Ajouter un item » ci-dessous.
      </p>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
      id={idPrefix}
    >
      <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <ul className="flex flex-col gap-1.5">
          {items.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              isEditing={editingItemId === item.id}
              onEdit={onEdit}
              onRemove={onRemove}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

export { arrayMove };
```

- [ ] **Step 3 : Typecheck**

Run: `pnpm --filter web typecheck`
Expected : PASS.

- [ ] **Step 4 : Commit**

```bash
git add apps/web/features/templates/cards/item-row.tsx apps/web/features/templates/cards/items-list.tsx
git commit -m "feat(templates): items-list with dnd-kit drag & drop + item-row"
```

---

### Task 16 : `add-item-popover.tsx` (popover custom, sans Radix)

**Files:**

- Create: `apps/web/features/templates/cards/add-item-popover.tsx`

- [ ] **Step 1 : Créer le composant**

```tsx
'use client';
import { useEffect, useRef, useState } from 'react';
import { CARD_TEMPLATE_ITEM_TYPES, type CardTemplateItem } from '@nexushub/domain';

const ICONS: Record<CardTemplateItem['type'], string> = {
  text: 'Aa',
  longtext: '¶',
  select: '▣',
  link: '🔗',
  checkbox: '☑',
  date: '📅',
  number: '#',
  section: '§',
  description: '¶',
};

export interface AddItemPopoverProps {
  readonly hasDescription: boolean;
  readonly onAdd: (type: CardTemplateItem['type']) => void;
}

export function AddItemPopover({ hasDescription, onAdd }: AddItemPopoverProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (type: CardTemplateItem['type']) => {
    if (type === 'description' && hasDescription) return;
    setOpen(false);
    onAdd(type);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full rounded-lg border border-dashed border-[color:var(--color-border)] px-3 py-2.5 text-sm text-[color:var(--color-text-muted)] hover:border-[color:var(--color-accent,#5b6cff)] hover:text-[color:var(--color-text)]"
      >
        + Ajouter un item
      </button>
      {open ? (
        <div className="absolute left-0 right-0 z-20 mt-1 max-h-80 overflow-auto rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-1.5 shadow-lg">
          {CARD_TEMPLATE_ITEM_TYPES.map((t, idx) => {
            const isSep = idx === 7; // after `number`, before `section`
            const disabled = t.id === 'description' && hasDescription;
            return (
              <div key={t.id}>
                {isSep ? <div className="my-1 h-px bg-[color:var(--color-border)]" /> : null}
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => pick(t.id)}
                  className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm ${
                    disabled
                      ? 'cursor-not-allowed text-[color:var(--color-text-muted)] opacity-50'
                      : 'hover:bg-[color:var(--color-surface-2,#f6f7fb)]'
                  }`}
                >
                  <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[color:var(--color-surface-2,#f6f7fb)] text-xs">
                    {ICONS[t.id]}
                  </span>
                  <span className="flex-1">{t.label}</span>
                  {disabled ? (
                    <span className="text-[10px] uppercase tracking-wide text-[color:var(--color-text-muted)]">
                      déjà présente
                    </span>
                  ) : null}
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2 : Typecheck**

Run: `pnpm --filter web typecheck`
Expected : PASS.

- [ ] **Step 3 : Commit**

```bash
git add apps/web/features/templates/cards/add-item-popover.tsx
git commit -m "feat(templates): add-item-popover (custom, no Radix dep)"
```

---

### Task 17 : `edit-item-drawer.tsx` (slide-over avec formulaires par type)

**Files:**

- Create: `apps/web/features/templates/cards/edit-item-drawer.tsx`

- [ ] **Step 1 : Créer le composant**

```tsx
'use client';
import { useEffect } from 'react';
import type {
  CardTemplateItem,
  CardTemplateInputItem,
  CardTemplateInputType,
} from '@nexushub/domain';

export interface EditItemDrawerProps {
  readonly item: CardTemplateItem | null;
  readonly onClose: () => void;
  readonly onUpdate: (id: string, patch: Record<string, unknown>) => void;
  readonly onConvertType: (id: string, toType: CardTemplateInputType) => void;
  readonly onRemove: (id: string) => void;
}

const CONVERTIBLE_TYPES: { id: CardTemplateInputType; label: string }[] = [
  { id: 'text', label: 'Texte court' },
  { id: 'longtext', label: 'Texte long' },
  { id: 'select', label: 'Liste déroulante' },
  { id: 'link', label: 'Lien URL' },
  { id: 'checkbox', label: 'Case à cocher' },
  { id: 'date', label: 'Date' },
  { id: 'number', label: 'Nombre' },
];

export function EditItemDrawer({
  item,
  onClose,
  onUpdate,
  onConvertType,
  onRemove,
}: EditItemDrawerProps) {
  useEffect(() => {
    if (!item) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [item, onClose]);

  if (!item) return null;

  return (
    <div className="absolute inset-0 z-30 flex flex-col gap-3 rounded-2xl border border-[color:var(--color-accent,#5b6cff)] bg-[color:var(--color-surface)] p-4 shadow-xl">
      <header className="flex items-start justify-between">
        <div>
          <p className="text-[10px] font-extrabold uppercase tracking-[1px] text-[color:var(--color-text-muted)]">
            Édition d'un item
          </p>
          <h3 className="text-sm font-bold">
            {item.type === 'description'
              ? 'Description'
              : item.type === 'section'
                ? 'Section'
                : item.label || 'Sans label'}
          </h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-[color:var(--color-border)] px-2 py-0.5 text-xs text-[color:var(--color-text-muted)]"
          aria-label="Fermer"
        >
          ×
        </button>
      </header>

      {item.type === 'description' ? (
        <p className="rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface-2,#f6f7fb)] px-3 py-2 text-xs text-[color:var(--color-text-muted)]">
          Élément système. Sa position dans la carte est contrôlée par drag &amp; drop ; aucun autre
          réglage.
        </p>
      ) : null}

      {item.type === 'section' ? (
        <LabelField value={item.label} onChange={(v) => onUpdate(item.id, { label: v })} />
      ) : null}

      {item.type !== 'section' && item.type !== 'description' ? (
        <>
          <TypeSelector
            currentType={item.type}
            onChange={(toType) => onConvertType(item.id, toType)}
          />
          <LabelField value={item.label} onChange={(v) => onUpdate(item.id, { label: v })} />
          {item.type !== 'checkbox' && item.type !== 'date' ? (
            <PlaceholderField
              value={item.placeholder ?? ''}
              onChange={(v) => onUpdate(item.id, { placeholder: v || undefined })}
            />
          ) : null}
          {item.type === 'select' ? (
            <OptionsField
              options={item.options ?? []}
              onChange={(opts) => onUpdate(item.id, { options: opts })}
            />
          ) : null}
        </>
      ) : null}

      <footer className="mt-auto flex items-center justify-between border-t border-[color:var(--color-border)] pt-3">
        <button
          type="button"
          onClick={() => {
            if (!window.confirm('Supprimer cet item ?')) return;
            onRemove(item.id);
          }}
          className="text-xs text-[#e0506b] hover:underline"
        >
          Supprimer
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md bg-[color:var(--color-accent,#5b6cff)] px-3 py-1 text-xs font-medium text-white"
        >
          Fermer
        </button>
      </footer>
    </div>
  );
}

function LabelField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="grid gap-1">
      <span className="text-[10px] font-extrabold uppercase tracking-[1px] text-[color:var(--color-text-muted)]">
        Label
      </span>
      <input
        type="text"
        value={value}
        maxLength={120}
        onChange={(e) => onChange(e.target.value)}
        className="field-input"
      />
    </label>
  );
}

function PlaceholderField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="grid gap-1">
      <span className="text-[10px] font-extrabold uppercase tracking-[1px] text-[color:var(--color-text-muted)]">
        Placeholder
      </span>
      <input
        type="text"
        value={value}
        maxLength={200}
        onChange={(e) => onChange(e.target.value)}
        className="field-input"
      />
    </label>
  );
}

function TypeSelector({
  currentType,
  onChange,
}: {
  currentType: CardTemplateInputItem['type'];
  onChange: (to: CardTemplateInputType) => void;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-[10px] font-extrabold uppercase tracking-[1px] text-[color:var(--color-text-muted)]">
        Type
      </span>
      <select
        className="field-select"
        value={currentType}
        onChange={(e) => onChange(e.target.value as CardTemplateInputType)}
      >
        {CONVERTIBLE_TYPES.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function OptionsField({
  options,
  onChange,
}: {
  options: readonly string[];
  onChange: (opts: string[]) => void;
}) {
  const update = (idx: number, value: string) => {
    const next = [...options];
    next[idx] = value;
    onChange(next);
  };
  const remove = (idx: number) => onChange(options.filter((_, i) => i !== idx));
  const add = () => onChange([...options, '']);

  return (
    <div className="grid gap-1">
      <span className="text-[10px] font-extrabold uppercase tracking-[1px] text-[color:var(--color-text-muted)]">
        Options
      </span>
      <div className="grid gap-1.5">
        {options.map((opt, idx) => (
          <div key={idx} className="flex items-center gap-1.5">
            <input
              type="text"
              value={opt}
              maxLength={80}
              onChange={(e) => update(idx, e.target.value)}
              className="field-input flex-1"
            />
            <button
              type="button"
              onClick={() => remove(idx)}
              className="rounded border border-[color:var(--color-border)] px-2 py-0.5 text-xs text-[color:var(--color-text-muted)] hover:border-[#e0506b] hover:text-[#e0506b]"
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={add}
          className="self-start rounded border border-dashed border-[color:var(--color-border)] px-2 py-1 text-xs text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)]"
        >
          + Ajouter une option
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2 : Typecheck**

Run: `pnpm --filter web typecheck`
Expected : PASS.

- [ ] **Step 3 : Commit**

```bash
git add apps/web/features/templates/cards/edit-item-drawer.tsx
git commit -m "feat(templates): edit-item-drawer with per-type forms"
```

---

### Task 18 : `template-editor.tsx` (colonne centrale qui assemble le tout)

**Files:**

- Create: `apps/web/features/templates/cards/template-editor.tsx`

- [ ] **Step 1 : Créer le composant**

```tsx
'use client';
import type { CardTemplateItem, CardTemplateInputType } from '@nexushub/domain';
import { ItemsList } from './items-list';
import { AddItemPopover } from './add-item-popover';

export interface TemplateEditorProps {
  readonly name: string;
  readonly items: readonly CardTemplateItem[];
  readonly isDirty: boolean;
  readonly isSaving: boolean;
  readonly editingItemId: string | null;
  readonly onRename: (name: string) => void;
  readonly onAddItem: (type: CardTemplateItem['type']) => void;
  readonly onReorder: (from: number, to: number) => void;
  readonly onEditItem: (id: string) => void;
  readonly onRemoveItem: (id: string) => void;
  readonly onSave: () => void;
  readonly onDeleteTemplate: () => void;
}

export function TemplateEditor({
  name,
  items,
  isDirty,
  isSaving,
  editingItemId,
  onRename,
  onAddItem,
  onReorder,
  onEditItem,
  onRemoveItem,
  onSave,
  onDeleteTemplate,
}: TemplateEditorProps) {
  const hasDescription = items.some((i) => i.type === 'description');

  return (
    <section className="flex h-full flex-col gap-4 rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-4">
      <header className="flex items-center gap-3 border-b border-[color:var(--color-border)] pb-3">
        <input
          type="text"
          value={name}
          maxLength={80}
          onChange={(e) => onRename(e.target.value)}
          placeholder="Nom du template"
          className="flex-1 rounded-md border border-transparent px-2 py-1 text-xl font-bold focus:border-[color:var(--color-border)]"
        />
        {isDirty ? (
          <span className="text-[10px] uppercase tracking-wide text-[color:var(--color-text-muted)]">
            non sauvé
          </span>
        ) : null}
        <button
          type="button"
          onClick={onSave}
          disabled={!isDirty || isSaving}
          className="rounded-md bg-[color:var(--color-accent,#5b6cff)] px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {isSaving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </header>

      <ItemsList
        items={items}
        editingItemId={editingItemId}
        onReorder={onReorder}
        onEdit={onEditItem}
        onRemove={onRemoveItem}
      />

      <AddItemPopover hasDescription={hasDescription} onAdd={onAddItem} />

      <footer className="mt-4 flex justify-end border-t border-[color:var(--color-border)] pt-3">
        <button
          type="button"
          onClick={onDeleteTemplate}
          className="rounded-md border border-[#e0506b] px-3 py-1 text-xs text-[#e0506b] hover:bg-[#e0506b] hover:text-white"
        >
          Supprimer ce template
        </button>
      </footer>
    </section>
  );
}
```

- [ ] **Step 2 : Typecheck**

Run: `pnpm --filter web typecheck`
Expected : PASS.

- [ ] **Step 3 : Commit**

```bash
git add apps/web/features/templates/cards/template-editor.tsx
git commit -m "feat(templates): template-editor (column 2) wiring items-list + add + danger"
```

---

### Task 19 : `editor-shell.tsx` (composant top-level qui orchestre tout)

**Files:**

- Create: `apps/web/features/templates/cards/editor-shell.tsx`

- [ ] **Step 1 : Créer le composant**

```tsx
'use client';
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { CardTemplateInputType, CardTemplateItem } from '@nexushub/domain';
import { useEditorState, type TemplateDTO } from './use-editor-state';
import { TemplatesList } from './templates-list';
import { TemplateEditor } from './template-editor';
import { TemplatePreview } from './template-preview';
import { EditItemDrawer } from './edit-item-drawer';
import { createCardTemplate, updateCardTemplate, deleteCardTemplate } from './actions';

export interface EditorShellProps {
  readonly initialTemplates: readonly TemplateDTO[];
}

export function EditorShell({ initialTemplates }: EditorShellProps) {
  const router = useRouter();
  const { state, dispatch } = useEditorState(initialTemplates);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // beforeunload dirty guard (V1 scope)
  useEffect(() => {
    if (!state.isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [state.isDirty]);

  const editingItem: CardTemplateItem | null = (() => {
    if (!state.editingItemId || !state.draft) return null;
    return state.draft.items.find((i) => i.id === state.editingItemId) ?? null;
  })();

  const onCreate = () => {
    setError(null);
    startTransition(async () => {
      const res = await createCardTemplate({
        name: 'Sans titre',
        body: '',
        items: [],
        defaultChecklist: [],
        isDefault: false,
      });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      dispatch({
        type: 'created',
        template: { id: res.id, name: 'Sans titre', items: [] },
      });
      router.refresh();
    });
  };

  const onSave = () => {
    if (!state.draft || !state.selectedId) return;
    setError(null);
    startTransition(async () => {
      const res = await updateCardTemplate({
        id: state.selectedId!,
        name: state.draft!.name,
        body: '',
        items: state.draft!.items,
        defaultChecklist: [],
        isDefault: state.templates.find((t) => t.id === state.selectedId)?.isDefault ?? false,
      });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      dispatch({
        type: 'saved',
        template: { id: state.selectedId!, name: state.draft!.name, items: state.draft!.items },
      });
      router.refresh();
    });
  };

  const onDeleteTemplate = () => {
    if (!state.selectedId) return;
    const name = state.draft?.name ?? '';
    if (!window.confirm(`Supprimer le template « ${name} » ?`)) return;
    setError(null);
    const id = state.selectedId;
    startTransition(async () => {
      const res = await deleteCardTemplate({ id });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      dispatch({ type: 'deleted', id });
      router.refresh();
    });
  };

  const onDeleteFromList = (id: string, name: string) => {
    if (!window.confirm(`Supprimer le template « ${name} » ?`)) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteCardTemplate({ id });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      dispatch({ type: 'deleted', id });
      router.refresh();
    });
  };

  return (
    <div className="grid h-[calc(100vh-180px)] grid-cols-[220px_minmax(420px,1fr)_minmax(320px,1fr)] gap-4">
      <div className="relative">
        <TemplatesList
          templates={state.templates}
          selectedId={state.selectedId}
          isDirty={state.isDirty}
          onSelect={(id) => dispatch({ type: 'selectTemplate', id })}
          onCreate={onCreate}
          onDelete={onDeleteFromList}
        />
        <EditItemDrawer
          item={editingItem}
          onClose={() => dispatch({ type: 'closeItemDrawer' })}
          onUpdate={(id, patch) => dispatch({ type: 'updateItem', id, patch })}
          onConvertType={(id, toType: CardTemplateInputType) =>
            dispatch({ type: 'convertItemType', id, toType })
          }
          onRemove={(id) => dispatch({ type: 'removeItem', id })}
        />
      </div>

      {state.draft && state.selectedId ? (
        <TemplateEditor
          name={state.draft.name}
          items={state.draft.items}
          isDirty={state.isDirty}
          isSaving={pending}
          editingItemId={state.editingItemId}
          onRename={(name) => dispatch({ type: 'renameDraft', name })}
          onAddItem={(type) => dispatch({ type: 'addItem', itemType: type })}
          onReorder={(from, to) => dispatch({ type: 'reorderItems', from, to })}
          onEditItem={(id) => dispatch({ type: 'openItemDrawer', id })}
          onRemoveItem={(id) => dispatch({ type: 'removeItem', id })}
          onSave={onSave}
          onDeleteTemplate={onDeleteTemplate}
        />
      ) : (
        <EmptyEditor />
      )}

      {state.draft ? (
        <TemplatePreview templateName={state.draft.name} items={state.draft.items} />
      ) : (
        <div />
      )}

      {error ? (
        <div className="col-span-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}
    </div>
  );
}

function EmptyEditor() {
  return (
    <section className="flex h-full items-center justify-center rounded-2xl border border-dashed border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-6 text-center text-sm text-[color:var(--color-text-muted)]">
      Sélectionne un template à gauche, ou crée-en un nouveau.
    </section>
  );
}
```

- [ ] **Step 2 : Typecheck**

Run: `pnpm --filter web typecheck`
Expected : PASS sauf une erreur résiduelle dans `editor.tsx` (l'ancien fichier) et dans `app/(app)/templates/cards/page.tsx`. On les corrige Task 20.

- [ ] **Step 3 : Commit**

```bash
git add apps/web/features/templates/cards/editor-shell.tsx
git commit -m "feat(templates): editor-shell orchestrates list/editor/preview/drawer"
```

---

### Task 20 : Wiring page.tsx + suppression de l'ancien `editor.tsx`

**Files:**

- Modify: `apps/web/app/(app)/templates/cards/page.tsx`
- Delete: `apps/web/features/templates/cards/editor.tsx`

- [ ] **Step 1 : Réécrire page.tsx**

Remplacer intégralement `apps/web/app/(app)/templates/cards/page.tsx` :

```tsx
import type { Metadata } from 'next';
import { prisma } from '@nexushub/db';
import { validateCardTemplateItems } from '@nexushub/domain';
import { requireUser } from '@/lib/auth';
import { EditorShell } from '@/features/templates/cards/editor-shell';
import type { TemplateDTO } from '@/features/templates/cards/use-editor-state';

export const metadata: Metadata = { title: 'Templates Cartes' };

export default async function CardTemplatesPage() {
  const ctx = await requireUser();

  const rows = await prisma.cardTemplate.findMany({
    where: { workspaceId: ctx.workspaceId, deletedAt: null },
    orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      items: true,
      isDefault: true,
    },
  });

  const templates: TemplateDTO[] = rows.map((t) => ({
    id: t.id,
    name: t.name,
    items: validateCardTemplateItems(t.items) ?? [],
    isDefault: t.isDefault,
  }));

  return (
    <div className="mx-auto max-w-[1280px]">
      <header className="mb-6">
        <h1 className="text-[34px] font-extrabold tracking-tight">Templates de cartes</h1>
        <p className="mt-2 text-sm text-[color:var(--color-text-muted)]">
          Compose le contenu d'une carte : champs, sections, description. L'aperçu à droite reflète
          exactement le rendu dans Projets.
        </p>
      </header>

      <EditorShell initialTemplates={templates} />
    </div>
  );
}
```

- [ ] **Step 2 : Supprimer l'ancien `editor.tsx`**

```bash
git rm apps/web/features/templates/cards/editor.tsx
```

- [ ] **Step 3 : Typecheck + lint complet**

Run: `pnpm --filter web typecheck && pnpm --filter web lint`
Expected : PASS sur les deux.

- [ ] **Step 4 : Test manuel**

Run: `pnpm --filter web dev`

- Ouvrir `/templates/cards`.
- Sélectionner un template existant : vérifier liste + aperçu.
- Ajouter un champ "Texte court" via le popover : drawer s'ouvre, label par défaut, l'aperçu se met à jour live.
- Drag-and-drop : réordonner deux items.
- Cliquer "Enregistrer" : toast / pas d'erreur, recharger la page → ordre persisté.
- Créer un nouveau template, le supprimer.
- Aller dans `/projects`, ouvrir une carte avec ce template : vérifier le rendu.

- [ ] **Step 5 : Commit**

```bash
git add apps/web/app/\(app\)/templates/cards/page.tsx apps/web/features/templates/cards/editor.tsx
git commit -m "feat(templates): wire EditorShell into page; remove legacy monolithic editor"
```

---

## Phase 6 — Nettoyage (drop deprecated colonnes + symboles domain)

### Task 21 : Drop deprecated domain symbols

**Files:**

- Modify: `packages/domain/src/card-templates/index.ts`

- [ ] **Step 1 : Vérifier qu'aucun consommateur n'utilise plus les symbols à supprimer**

```bash
grep -rn "CARD_FIELD_PRESETS\|CARD_FIELD_GROUPS\|DESCRIPTION_POSITIONS\|isDescriptionPosition\|validateCardFields\|CardTemplateDescriptionPosition\|CardFieldGroup\|getFieldPreset\|pruneFieldValues\b" apps/web packages 2>/dev/null | grep -v node_modules | grep -v ".next/"
```

Expected : aucune occurrence dans le code (sauf `packages/domain/src/card-templates/index.ts` lui-même, qui est ce qu'on va nettoyer).

S'il en reste, retourner aux tâches précédentes pour les remplacer.

- [ ] **Step 2 : Supprimer les exports deprecated**

Dans `packages/domain/src/card-templates/index.ts`, supprimer les lignes :

- type `CardFieldGroup`
- type `CardTemplateDescriptionPosition`
- const `DESCRIPTION_POSITIONS`
- function `isDescriptionPosition`
- interface `CardFieldDef`
- const `CARD_FIELD_PRESETS`
- const `CARD_FIELD_GROUPS`
- const `CARD_FIELD_TYPES` (remplacé par `CARD_TEMPLATE_ITEM_TYPES`)
- function `getFieldPreset`
- function `validateCardFields`
- function `pruneFieldValues` (renommé `pruneFieldValuesByItems`)

**Conserver** : `validateCardTemplateName`, `slugifyFieldLabel`, `generateCustomFieldId`, et tout le bloc "New unified items model".

`migrateFieldsToItems` peut être conservé (utile si on doit rejouer le backfill) ou supprimé — au choix de l'implémenteur. Si on le garde, garder aussi son type d'argument `CardFieldDef`. Recommandation : supprimer (le backfill a déjà tourné en prod) pour éviter le code mort.

Si on supprime `migrateFieldsToItems`, supprimer aussi son fichier de test.

- [ ] **Step 3 : Typecheck + tests domain**

Run: `pnpm --filter @nexushub/domain typecheck && pnpm --filter @nexushub/domain test --run`
Expected : tous deux PASS.

- [ ] **Step 4 : Typecheck web (sanity)**

Run: `pnpm --filter web typecheck`
Expected : PASS.

- [ ] **Step 5 : Commit**

```bash
git add packages/domain/src/card-templates/
git commit -m "chore(domain): drop deprecated card-template symbols (fields/groups/descriptionPosition)"
```

---

### Task 22 : Migration finale — drop `fields` et `description_position`

**Files:**

- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260513100001_drop_card_template_legacy/migration.sql`

- [ ] **Step 1 : Retirer les colonnes du schéma**

Dans `packages/db/prisma/schema.prisma`, modèle `CardTemplate`, supprimer :

```prisma
  /// Array of CardFieldDef objects (validated client-side; stored as Json).
  fields           Json      @default("[]")
  …
  /// Where the card's `description` block sits in the modal relative to
  /// the structured fields: 'before-fields' | 'after-fields' | 'hidden'.
  descriptionPosition String @default("after-fields") @map("description_position")
```

- [ ] **Step 2 : Créer la migration SQL**

```bash
mkdir -p packages/db/prisma/migrations/20260513100001_drop_card_template_legacy
```

Écrire `packages/db/prisma/migrations/20260513100001_drop_card_template_legacy/migration.sql` :

```sql
ALTER TABLE "public"."card_templates"
  DROP CONSTRAINT IF EXISTS "card_templates_description_position_check";

ALTER TABLE "public"."card_templates"
  DROP COLUMN "fields",
  DROP COLUMN "description_position";
```

- [ ] **Step 3 : Régénérer + appliquer**

Run:

```bash
pnpm --filter @nexushub/db db:generate
pnpm --filter @nexushub/db db:migrate -- --name drop_card_template_legacy
pnpm --filter @nexushub/db typecheck
```

Expected : génération + migration + typecheck OK. (Là encore, si Prisma crée un dossier auto avec un autre nom, supprimer l'auto et garder le tien.)

- [ ] **Step 4 : Sanity check**

Run: `pnpm --filter web typecheck && pnpm --filter web test --run`
Expected : PASS.

- [ ] **Step 5 : Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260513100001_drop_card_template_legacy/
git commit -m "feat(db): drop legacy card_templates.fields + description_position columns"
```

---

## Phase 7 — Tests E2E

### Task 23 : Playwright happy path

**Files:**

- Create: `e2e/templates-cards-redesign.spec.ts`

- [ ] **Step 1 : Voir un E2E existant pour le pattern**

```bash
ls e2e/
```

Choisir un fichier de référence pour les helpers d'auth, par ex. `auth-gate.spec.ts`.

- [ ] **Step 2 : Écrire le test**

Créer `e2e/templates-cards-redesign.spec.ts` :

```ts
import { test, expect } from '@playwright/test';

test.describe('Templates Cartes — redesign', () => {
  test('crée un template, ajoute un champ + une section + la description, sauve, recharge', async ({
    page,
  }) => {
    // [Adapter à l'auth helper du projet — voir e2e/auth-gate.spec.ts]
    await page.goto('/templates/cards');

    // Créer un nouveau template
    await page.getByRole('button', { name: '+ Nouveau' }).click();

    // Renommer
    const nameInput = page.locator('input[placeholder="Nom du template"]');
    await nameInput.fill('Tâche E2E');

    // Ouvrir le popover et ajouter un texte court
    await page.getByRole('button', { name: '+ Ajouter un item' }).click();
    await page.getByRole('button', { name: 'Texte court' }).click();
    // Drawer ouvert sur le nouvel item
    await page.locator('input[type="text"]').last().fill('Titre court');
    // Fermer le drawer
    await page.keyboard.press('Escape');

    // Ajouter une section
    await page.getByRole('button', { name: '+ Ajouter un item' }).click();
    await page.getByRole('button', { name: 'Section', exact: true }).click();
    await page.keyboard.press('Escape');

    // Ajouter description
    await page.getByRole('button', { name: '+ Ajouter un item' }).click();
    await page.getByRole('button', { name: 'Description', exact: true }).click();

    // Vérifier dans l'aperçu que la description apparaît
    await expect(page.getByText('Description de la carte (placeholder)')).toBeVisible();

    // Sauver
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();

    // Recharger et vérifier persistance
    await page.reload();
    await page.getByRole('button', { name: 'Tâche E2E' }).click();
    await expect(page.getByText('Titre court')).toBeVisible();
  });
});
```

(Note : adapter aux conventions d'auth-helper du projet — voir un autre `e2e/*.spec.ts` pour le pattern de login.)

- [ ] **Step 3 : Run le test**

Run: `pnpm e2e --grep "redesign"`
Expected : PASS.

Si nécessaire, corriger les sélecteurs (l'aperçu ARIA peut différer) et ré-itérer.

- [ ] **Step 4 : Commit**

```bash
git add e2e/templates-cards-redesign.spec.ts
git commit -m "test(e2e): templates cards redesign happy path"
```

---

## Self-Review (after writing)

**Spec coverage** :

- §2 décisions A/A1/B3/C1/D1/E2/F2/G1 → toutes implémentées par les tâches 12-19.
- §3.1 modèle de données → Task 1, 2 (validateur), 5 (schéma), 6 (backfill), 21-22 (cleanup).
- §3.2 domain → Task 1-4.
- §3.3 UI structure → Task 12-20.
- §3.3 dirty guard `beforeunload` V1 → Task 19 (effect dans EditorShell).
- §3.3 conversion de type → Task 12 (`convertItemType`) + Task 17 (UI).
- §3.3 bascule de drawer item → Task 15 (`onClick={onEdit}` sur la row, dispatch `openItemDrawer`).
- §3.3 popover singleton description → Task 16 (`disabled` si `hasDescription`).
- §4 server actions → Task 7, 8, 11.
- §5 rendu modal carte → Task 9.
- §6 hors scope → respecté (pas de responsive, pas de versioning, pas d'undo, pas d'i18n par item).
- §7 tests → Task 2, 3, 4, 12 (unitaires), Task 23 (E2E).
- §9 plan de déploiement → Task 5 → 6 → 7-20 → 22 respecte l'ordre.

**Placeholder scan** :

- Task 9 step 3 contient une note "[reuse the existing FieldInput body…]" — c'est volontaire pour éviter la duplication du bloc de 150 lignes ; la réf au numéro de lignes + verbatim + le changement de type unique sont précis.
- Task 23 step 2 dit "Adapter à l'auth helper du projet" — non placeholder, c'est une instruction concrète : lire `e2e/auth-gate.spec.ts` qui existe et reproduire le pattern.

**Type consistency** :

- `CardTemplateItem` / `CardTemplateInputItem` / `CardTemplateInputType` utilisés cohéremment Task 1 → 23.
- `TemplateDTO` défini Task 12, importé Task 19 + 20.
- `Action` union du reducer Task 12 ; tous les `dispatch({ type: '…' })` dans Task 19 correspondent à un cas du switch.
- Pas de divergence de nom (e.g. `onEditItem` ≠ `onEdit` — chaque composant utilise sa prop, les renames se font dans les `<Component onChild={parent}/>`).

**Notes de risque** :

- La migration Phase 6 (drop colonnes) **doit** être appliquée APRÈS que le code lisant `items` est en prod. L'ordre dans le plan le garantit.
- Le script de backfill Task 6 utilise `--env-file=../../.env.local` (existant) ; en CI/prod il faudra un mécanisme équivalent — hors scope du plan.
