# Card Template Visibility & Default Bootstrap — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every card gets a template with a description (workspace default guaranteed), and the card modal links to the card-template editor with a deep-link.

**Architecture:** Zero new screens — reuse the existing `/templates/cards` editor with a `?template=<id>` deep-link, add a link in the card-modal side rail, bootstrap a default `CardTemplate` at workspace creation, and one data migration for existing workspaces + template-less cards. Spec: `docs/superpowers/specs/2026-07-28-card-template-visibility-design.md`.

**Tech Stack:** Next.js 15 App Router, Prisma 6 (Supabase Postgres), Vitest, pnpm workspaces (`@nexushub/domain`, `@nexushub/web`).

**Conventions:**

- Run web tests: `pnpm -F @nexushub/web test -- <path>` · domain tests: `pnpm -F @nexushub/domain test -- <path>`
- All UI copy is hardcoded French in these features (existing pattern) — follow it.
- Commits: Conventional Commits, one per task.

---

### Task 1: Domain — default card template constants

**Files:**

- Modify: `packages/domain/src/card-templates/index.ts` (append at end)
- Test: `packages/domain/src/card-templates/default-template.test.ts` (create)

The bootstrap action (Task 4) and the SQL migration (Task 5) must agree on the default template's shape. Single source of truth in domain.

- [ ] **Step 1: Write the failing test**

```ts
// packages/domain/src/card-templates/default-template.test.ts
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CARD_TEMPLATE_NAME,
  defaultCardTemplateItems,
  validateCardTemplateItems,
} from './index';

describe('default card template', () => {
  it('is named Standard', () => {
    expect(DEFAULT_CARD_TEMPLATE_NAME).toBe('Standard');
  });

  it('contains a description item followed by an empty checklist', () => {
    const items = defaultCardTemplateItems();
    expect(items).toEqual([
      { id: 'description', type: 'description' },
      { id: 'checklist', type: 'checklist', items: [] },
    ]);
  });

  it('round-trips through validateCardTemplateItems (same shape stored in DB)', () => {
    expect(validateCardTemplateItems(defaultCardTemplateItems())).toEqual(
      defaultCardTemplateItems(),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @nexushub/domain test -- src/card-templates/default-template.test.ts`
Expected: FAIL — `DEFAULT_CARD_TEMPLATE_NAME` is not exported.

- [ ] **Step 3: Implement**

Append to `packages/domain/src/card-templates/index.ts` (after the existing exports; `DESCRIPTION_ITEM_ID`, `CHECKLIST_ITEM_ID` and `CardTemplateItem` are already defined in this file):

```ts
// ---------- Workspace default template ---------------------------------------

/** Name of the card template bootstrapped for every new workspace. */
export const DEFAULT_CARD_TEMPLATE_NAME = 'Standard';

/**
 * Items of the bootstrapped default template: a description plus an empty
 * checklist. Kept in domain so the workspace-creation action and the data
 * migration stay in sync with the modal's rendering expectations.
 */
export function defaultCardTemplateItems(): CardTemplateItem[] {
  return [
    { id: DESCRIPTION_ITEM_ID, type: 'description' },
    { id: CHECKLIST_ITEM_ID, type: 'checklist', items: [] },
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F @nexushub/domain test -- src/card-templates/default-template.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/card-templates/index.ts packages/domain/src/card-templates/default-template.test.ts
git commit -m "feat(domain): default card template constants (Standard, description+checklist)"
```

---

### Task 2: Deep-link — `/templates/cards?template=<id>` opens that template

**Files:**

- Modify: `apps/web/features/templates/cards/use-editor-state.ts:49-65` (`makeInitialState`) and `:243-253` (`useEditorState`)
- Modify: `apps/web/features/templates/cards/editor-shell.tsx:12-18` (props)
- Modify: `apps/web/app/(app)/templates/cards/page.tsx` (read `searchParams`)
- Test: `apps/web/features/templates/cards/use-editor-state.test.ts` (extend — file exists)

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/features/templates/cards/use-editor-state.test.ts` (reuse the file's existing fixture helpers if any; otherwise this self-contained block):

```ts
describe('makeInitialState — deep-link initialSelectedId', () => {
  const tplA = {
    id: 'aaaaaaaa-0000-0000-0000-000000000001',
    name: 'A',
    items: [],
    isDefault: true,
  };
  const tplB = {
    id: 'aaaaaaaa-0000-0000-0000-000000000002',
    name: 'B',
    items: [],
    isDefault: false,
  };

  it('selects the requested template when it exists', () => {
    const s = makeInitialState([tplA, tplB], tplB.id);
    expect(s.selectedId).toBe(tplB.id);
    expect(s.draft?.name).toBe('B');
  });

  it('falls back to the default template when the requested id is unknown', () => {
    const s = makeInitialState([tplA, tplB], 'aaaaaaaa-0000-0000-0000-00000000dead');
    expect(s.selectedId).toBe(tplA.id);
  });

  it('keeps current behaviour when no id is requested', () => {
    const s = makeInitialState([tplA, tplB], null);
    expect(s.selectedId).toBe(tplA.id);
  });
});
```

If `makeInitialState` is not already imported in the test file, add it to the existing import from `./use-editor-state`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -F @nexushub/web test -- features/templates/cards/use-editor-state.test.ts`
Expected: FAIL — `makeInitialState` accepts 1 argument (TS error / wrong selection).

- [ ] **Step 3: Implement `makeInitialState` second parameter**

In `apps/web/features/templates/cards/use-editor-state.ts`, replace the `makeInitialState` signature and the `auto` line:

```ts
export function makeInitialState(
  templates: readonly TemplateDTO[],
  initialSelectedId?: string | null,
): EditorState {
  // Deep-link (?template=<id>) wins; otherwise auto-select the workspace
  // default template so the editor isn't blank when arriving on
  // /templates/cards; last resort, the first template.
  const requested = initialSelectedId
    ? templates.find((t) => t.id === initialSelectedId)
    : undefined;
  const auto = requested ?? templates.find((t) => t.isDefault) ?? templates[0] ?? null;
```

(the rest of the function body is unchanged). Then update `useEditorState`:

```ts
export function useEditorState(
  initial: readonly TemplateDTO[],
  initialSelectedId?: string | null,
) {
  const [state, dispatch] = useReducer(reduceEditorState, undefined, () =>
    makeInitialState(initial, initialSelectedId),
  );
```

- [ ] **Step 4: Wire EditorShell + page**

`apps/web/features/templates/cards/editor-shell.tsx`:

```ts
export interface EditorShellProps {
  readonly initialTemplates: readonly TemplateDTO[];
  /** Deep-link (?template=<id>) — template to open on first paint. */
  readonly initialSelectedId?: string | null;
}

export function EditorShell({ initialTemplates, initialSelectedId = null }: EditorShellProps) {
  const router = useRouter();
  const { state, dispatch } = useEditorState(initialTemplates, initialSelectedId);
```

`apps/web/app/(app)/templates/cards/page.tsx` — change the component signature and the `EditorShell` call:

```tsx
export default async function CardTemplatesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireUser();
  const sp = await searchParams;
  const requestedTemplateId = typeof sp.template === 'string' ? sp.template : null;
  // …existing prisma query + mapping unchanged…
  return (
    // …unchanged header…
    <EditorShell initialTemplates={templates} initialSelectedId={requestedTemplateId} />
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm -F @nexushub/web test -- features/templates/cards/use-editor-state.test.ts`
Expected: PASS (all existing + 3 new).

- [ ] **Step 6: Commit**

```bash
git add apps/web/features/templates/cards/use-editor-state.ts apps/web/features/templates/cards/use-editor-state.test.ts apps/web/features/templates/cards/editor-shell.tsx "apps/web/app/(app)/templates/cards/page.tsx"
git commit -m "feat(templates): deep-link ?template=<id> opens that card template in the editor"
```

---

### Task 3: Card modal — « Modifier le template » link in the side rail

**Files:**

- Create: `apps/web/features/projects/components/template-edit-link.tsx`
- Test: `apps/web/features/projects/components/template-edit-link.test.tsx` (create)
- Modify: `apps/web/features/projects/components/card-modal.tsx:429-440` (Template side-row) + import block

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/features/projects/components/template-edit-link.test.tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TemplateEditLink } from './template-edit-link';

describe('TemplateEditLink', () => {
  it('links to the editor deep-link when the card has a template', () => {
    render(<TemplateEditLink templateId="11111111-1111-1111-1111-111111111111" />);
    const link = screen.getByRole('link', { name: 'Modifier le template' });
    expect(link.getAttribute('href')).toBe(
      '/templates/cards?template=11111111-1111-1111-1111-111111111111',
    );
  });

  it('offers template management when the card has no template', () => {
    render(<TemplateEditLink templateId={null} />);
    expect(screen.getByText(/Aucun template appliqué/)).toBeDefined();
    const link = screen.getByRole('link', { name: 'Gérer les templates' });
    expect(link.getAttribute('href')).toBe('/templates/cards');
  });
});
```

(Mirror the vitest environment setup of the existing component tests, e.g. `apps/web/features/shell/components/nav-link.test.tsx` — if they carry a `// @vitest-environment jsdom` pragma or mock `next/link`, copy that setup.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @nexushub/web test -- features/projects/components/template-edit-link.test.tsx`
Expected: FAIL — module `./template-edit-link` not found.

- [ ] **Step 3: Implement the component**

```tsx
// apps/web/features/projects/components/template-edit-link.tsx
import Link from 'next/link';

/**
 * Side-rail escape hatch under the TemplatePicker: jump to the card-template
 * editor (deep-linked on the card's template). CRUD on templates is open to
 * Admin AND Membre (CLAUDE.md §6.7) — the caller only hides it in read-only
 * (viewer) mode.
 */
export function TemplateEditLink({ templateId }: { readonly templateId: string | null }) {
  if (!templateId) {
    return (
      <p className="mt-1 text-[10px] text-[color:var(--color-text-muted)]">
        Aucun template appliqué —{' '}
        <Link href="/templates/cards" className="underline hover:text-[color:var(--color-text)]">
          Gérer les templates
        </Link>
      </p>
    );
  }
  return (
    <p className="mt-1 text-[10px] text-[color:var(--color-text-muted)]">
      <Link
        href={`/templates/cards?template=${templateId}`}
        className="underline hover:text-[color:var(--color-text)]"
      >
        Modifier le template
      </Link>
    </p>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F @nexushub/web test -- features/projects/components/template-edit-link.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Mount it in the card modal**

In `apps/web/features/projects/components/card-modal.tsx`, add the import next to the other component imports:

```ts
import { TemplateEditLink } from './template-edit-link';
```

Then in the Template side-row (currently lines ~429-440), after the explanatory `<p>`:

```tsx
<div className="side-row" hidden={isLoading}>
  <div className="side-label">Template</div>
  <TemplatePicker
    cardId={card.id}
    currentTemplateId={card.templateId}
    templates={availableTemplates}
  />
  <p className="mt-1 text-[10px] text-[color:var(--color-text-muted)]">
    Changer le template ré-organise les champs structurés. Les valeurs des champs conservés sont
    préservées.
  </p>
  {!isReadOnly ? <TemplateEditLink templateId={card.templateId} /> : null}
</div>
```

- [ ] **Step 6: Typecheck + full web test sweep**

Run: `pnpm -F @nexushub/web typecheck && pnpm -F @nexushub/web test`
Expected: both PASS (no regression).

- [ ] **Step 7: Commit**

```bash
git add apps/web/features/projects/components/template-edit-link.tsx apps/web/features/projects/components/template-edit-link.test.tsx apps/web/features/projects/components/card-modal.tsx
git commit -m "feat(projects): link to card-template editor from the card modal side rail"
```

---

### Task 4: Bootstrap — default card template at workspace creation

**Files:**

- Modify: `apps/web/features/super-admin/actions/create-workspace-with-admin.ts:72-89`
- Test: `apps/web/features/super-admin/actions/create-workspace-with-admin.test.ts` (extend)

- [ ] **Step 1: Extend the test (failing first)**

In `create-workspace-with-admin.test.ts`:

1. Add to the `vi.hoisted` mocks object: `cardTemplateCreate: vi.fn(),`
2. Extend the `@nexushub/db` mock's `prisma` with `cardTemplate: { create: mocks.cardTemplateCreate },`
3. In `beforeEach`, add `mocks.cardTemplateCreate.mockResolvedValue({ id: 'tpl-1' });`
4. Add assertions to the happy-path test (`creates the workspace, fires the invitation, and audits`):

```ts
expect(mocks.cardTemplateCreate).toHaveBeenCalledOnce();
const tplArgs = mocks.cardTemplateCreate.mock.calls[0]![0];
expect(tplArgs.data.workspaceId).toBe(WS_ID);
expect(tplArgs.data.name).toBe('Standard');
expect(tplArgs.data.isDefault).toBe(true);
expect(tplArgs.data.items).toEqual([
  { id: 'description', type: 'description' },
  { id: 'checklist', type: 'checklist', items: [] },
]);
```

5. Add to the duplicate-slug test: `expect(mocks.cardTemplateCreate).not.toHaveBeenCalled();`

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @nexushub/web test -- features/super-admin/actions/create-workspace-with-admin.test.ts`
Expected: FAIL — `cardTemplateCreate` never called.

- [ ] **Step 3: Implement the bootstrap**

In `create-workspace-with-admin.ts`, add to the domain import (or create one):

```ts
import { DEFAULT_CARD_TEMPLATE_NAME, defaultCardTemplateItems } from '@nexushub/domain';
```

Then right after the `try/catch` that creates the workspace (after line 89, before `issueInvitation`):

```ts
// Bootstrap the workspace default card template so every card created in
// this workspace resolves to a template with a description (create-card's
// `isDefault: true` fallback). Best-effort like the invitation below: a
// failure doesn't roll back the workspace — the Admin can create/mark a
// default template via /templates/cards.
await prisma.cardTemplate.create({
  data: {
    workspaceId,
    name: DEFAULT_CARD_TEMPLATE_NAME,
    isDefault: true,
    items: defaultCardTemplateItems(),
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F @nexushub/web test -- features/super-admin/actions/create-workspace-with-admin.test.ts`
Expected: PASS (all 4+ tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/features/super-admin/actions/create-workspace-with-admin.ts apps/web/features/super-admin/actions/create-workspace-with-admin.test.ts
git commit -m "feat(super-admin): bootstrap Standard default card template at workspace creation"
```

---

### Task 5: Data migration — default template + backfill for existing workspaces

**Files:**

- Create: `packages/db/prisma/migrations/20260728120000_default_card_template_backfill/migration.sql`

Reminder ([reference_deploy_migrations](memory)): Vercel does NOT run migrations — this SQL must be applied to Supabase (staging `yphedrhofupththvlvoa`) manually **before** merge.

- [ ] **Step 1: Write the migration**

```sql
-- Guarantee every workspace has a default card template containing the
-- description item, and attach template-less cards to it.
-- Spec: docs/superpowers/specs/2026-07-28-card-template-visibility-design.md

-- 1. A workspace already owning an active template named 'Standard' but no
--    default: promote it (partial unique index card_templates_one_default_per_workspace
--    guarantees at most one default; the NOT EXISTS guard keeps us clear of it).
UPDATE "card_templates" ct
SET "is_default" = TRUE
WHERE ct."deleted_at" IS NULL
  AND ct."name" = 'Standard'
  AND NOT EXISTS (
    SELECT 1 FROM "card_templates" d
    WHERE d."workspace_id" = ct."workspace_id"
      AND d."is_default" AND d."deleted_at" IS NULL
  );

-- 2. Workspaces still lacking a default: insert the bootstrapped 'Standard'
--    template (same shape as @nexushub/domain defaultCardTemplateItems()).
--    The unique index (workspace_id, name) also covers soft-deleted rows, so
--    skip workspaces holding ANY row named 'Standard' — those (rare) cases
--    keep no default and are fixable via /templates/cards.
INSERT INTO "card_templates" ("workspace_id", "name", "is_default", "items", "created_at", "updated_at")
SELECT w."id", 'Standard', TRUE,
       '[{"id":"description","type":"description"},{"id":"checklist","type":"checklist","items":[]}]'::jsonb,
       NOW(), NOW()
FROM "workspaces" w
WHERE NOT EXISTS (
    SELECT 1 FROM "card_templates" d
    WHERE d."workspace_id" = w."id" AND d."is_default" AND d."deleted_at" IS NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM "card_templates" s
    WHERE s."workspace_id" = w."id" AND s."name" = 'Standard'
  );

-- 3. Backfill: attach active template-less cards to their workspace default
--    so already-created cards render the description section. Deliberate
--    trade-off (validated 2026-07-28): cards manually set to « Sans template »
--    are re-templated too.
UPDATE "cards" c
SET "template_id" = d."id"
FROM "card_templates" d
WHERE d."workspace_id" = c."workspace_id"
  AND d."is_default" AND d."deleted_at" IS NULL
  AND c."template_id" IS NULL
  AND c."deleted_at" IS NULL;
```

- [ ] **Step 2: Apply to staging Supabase (manual, before merge)**

Apply the SQL above on project `yphedrhofupththvlvoa` (bnd-os-staging) via the Supabase MCP `apply_migration` tool (name: `default_card_template_backfill`) or the SQL editor.

- [ ] **Step 3: Verify on staging**

Run these checks (expected: both counts = 0):

```sql
SELECT count(*) AS workspaces_without_default
FROM workspaces w
WHERE NOT EXISTS (
  SELECT 1 FROM card_templates d
  WHERE d.workspace_id = w.id AND d.is_default AND d.deleted_at IS NULL
);

SELECT count(*) AS active_cards_without_template
FROM cards WHERE template_id IS NULL AND deleted_at IS NULL;
```

Also spot-check the reporter's workspace (`30e95e04-…`): it should now have a default 'Standard' template and its « Gestion de projet » cards should point at it.

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma/migrations/20260728120000_default_card_template_backfill/migration.sql
git commit -m "feat(db): backfill default card template + attach template-less cards"
```

---

### Task 6: Docs, full verification

**Files:**

- Modify: `progress.md` (status note)
- Modify: `CLAUDE.md` (§11 journal — one line)

- [ ] **Step 1: Full sweep**

Run: `pnpm -F @nexushub/domain test && pnpm -F @nexushub/web test && pnpm -F @nexushub/web typecheck && pnpm -F @nexushub/web lint`
Expected: all PASS.

- [ ] **Step 2: Update docs**

- `progress.md`: add an entry for this iteration (card template visibility + default bootstrap, date 2026-07-28).
- `CLAUDE.md` §11: add journal line `| 2026-07-28 | Template de carte : deep-link éditeur, lien modal, bootstrap défaut « Standard » + backfill | Angelo L. + Claude |`.

- [ ] **Step 3: Commit**

```bash
git add progress.md CLAUDE.md
git commit -m "docs: card template visibility iteration notes"
```

---

## Self-review (done at plan time)

- **Spec coverage:** §1 deep-link → Task 2 · §2 modal link → Task 3 · §3 bootstrap → Task 4 · §4 migration+backfill → Task 5 · tests → embedded per task. ✓
- **Type consistency:** `makeInitialState(templates, initialSelectedId?)` used identically in Tasks 2; `defaultCardTemplateItems()` shape matches migration JSON and Task 4 assertions. ✓
- **No placeholders.** ✓
