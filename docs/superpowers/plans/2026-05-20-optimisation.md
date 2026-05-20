# Optimisation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship 4 independent UX/product tweaks on branch `optimisation`: Kanban "done" visual parity with list view, deadline treated as end-of-day Europe/Paris, login as landing page, and a Tiptap WYSIWYG comment editor (Markdown storage).

**Architecture:** Domain date logic stays pure (`packages/domain`), tested with Vitest. Deadline semantics change in one shared helper used by the blocked-routing rules + the overdue filter — no DB migration. The Kanban "done" state is derived client-side from `columnId === lastUserColumnId` (mirrors list view). The comment editor swaps its `<textarea>` for a Tiptap editor that serialises to Markdown into a hidden `body` input, leaving the Server Actions and `sanitize-html` render path untouched.

**Tech Stack:** TypeScript (strict) · Vitest · Next.js 15 App Router · React 19 · `@dnd-kit` · Tiptap (`@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-underline`, `@tiptap/extension-link`, `tiptap-markdown`) · `Intl.DateTimeFormat` for timezone math.

**Worktree:** `/Users/angelogeraci/Documents/Application/BND-OS/.worktrees/optimisation` · **Branch:** `optimisation` · **Base:** `bc8babe` (main with card-comments merged).

---

## File structure (locked-in)

### Created

- `packages/domain/src/dates/index.ts` — `isDueDateOverdue`, `startOfTodayInParis`, `DUE_TIME_ZONE`
- `packages/domain/src/dates/dates.test.ts` — unit tests for both helpers

### Modified

- `packages/domain/src/index.ts` — re-export `./dates/index`
- `packages/domain/src/kanban/index.ts` — use `isDueDateOverdue` in `shouldMoveToBlocked` + `shouldRestoreFromBlocked`
- `packages/domain/src/kanban/kanban.test.ts` — update overdue scenarios to the end-of-day semantics
- `apps/web/features/projects/lib/card-filter.ts` — `overdue` mode uses `startOfTodayInParis()`
- `apps/web/features/projects/components/kanban-card.tsx` — `isLastUserColumn` prop → `CardCompletedBadge` + struck title
- `apps/web/features/projects/components/kanban-column.tsx` — pass `isLastUserColumn` to `KanbanCard`
- `apps/web/features/projects/components/kanban-board.tsx` — pass `isLastUserColumn` to the `DragOverlay` card
- `packages/ui/src/tokens/components.css` — `.kcard-title--done` strike style + Tiptap editor styles
- `apps/web/app/page.tsx` — redirect (authed → `/overview`, else → `/login`)
- `apps/web/features/projects/components/comment-editor.tsx` — Tiptap rewrite
- `packages/integrations` is NOT touched (markdown render stays as-is)
- `apps/web/package.json` — Tiptap deps

---

## Task 1: Domain date helpers (`isDueDateOverdue`, `startOfTodayInParis`) — TDD

**Files:**

- Create: `packages/domain/src/dates/dates.test.ts`
- Create: `packages/domain/src/dates/index.ts`
- Modify: `packages/domain/src/index.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/domain/src/dates/dates.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isDueDateOverdue, startOfTodayInParis } from './index';

// Paris is UTC+2 in summer (CEST), UTC+1 in winter (CET).

describe('isDueDateOverdue', () => {
  it('is false when due date is later today (Paris)', () => {
    // due stored at UTC midnight of 2026-05-20 (how the date input persists it)
    const due = new Date('2026-05-20T00:00:00.000Z');
    // now = 2026-05-20 09:00 Paris (07:00Z) — same Paris calendar day
    const now = new Date('2026-05-20T07:00:00.000Z');
    expect(isDueDateOverdue(due, now)).toBe(false);
  });

  it('is false at 23:00 Paris on the due day', () => {
    const due = new Date('2026-05-20T00:00:00.000Z');
    // 2026-05-20 23:00 Paris = 21:00Z, still 05-20 in Paris
    const now = new Date('2026-05-20T21:00:00.000Z');
    expect(isDueDateOverdue(due, now)).toBe(false);
  });

  it('is true once Paris rolls over to the next day', () => {
    const due = new Date('2026-05-20T00:00:00.000Z');
    // 2026-05-20 22:30Z = 2026-05-21 00:30 Paris → next calendar day
    const now = new Date('2026-05-20T22:30:00.000Z');
    expect(isDueDateOverdue(due, now)).toBe(true);
  });

  it('is true when due date is clearly in the past', () => {
    const due = new Date('2026-05-18T00:00:00.000Z');
    const now = new Date('2026-05-20T07:00:00.000Z');
    expect(isDueDateOverdue(due, now)).toBe(true);
  });

  it('is false when due date is in the future', () => {
    const due = new Date('2026-05-25T00:00:00.000Z');
    const now = new Date('2026-05-20T07:00:00.000Z');
    expect(isDueDateOverdue(due, now)).toBe(false);
  });

  it('handles winter (CET, UTC+1) rollover', () => {
    const due = new Date('2026-01-15T00:00:00.000Z');
    // 2026-01-15 23:30Z = 2026-01-16 00:30 Paris (CET) → overdue
    const now = new Date('2026-01-15T23:30:00.000Z');
    expect(isDueDateOverdue(due, now)).toBe(true);
    // 2026-01-15 22:30Z = 2026-01-15 23:30 Paris → not yet
    const now2 = new Date('2026-01-15T22:30:00.000Z');
    expect(isDueDateOverdue(due, now2)).toBe(false);
  });
});

describe('startOfTodayInParis', () => {
  it('returns the UTC instant of Paris local midnight (summer, UTC+2)', () => {
    const now = new Date('2026-05-20T08:00:00.000Z'); // 10:00 Paris
    // Paris midnight 2026-05-20 00:00+02:00 = 2026-05-19T22:00:00Z
    expect(startOfTodayInParis(now).toISOString()).toBe('2026-05-19T22:00:00.000Z');
  });

  it('returns the UTC instant of Paris local midnight (winter, UTC+1)', () => {
    const now = new Date('2026-01-20T08:00:00.000Z'); // 09:00 Paris
    // Paris midnight 2026-01-20 00:00+01:00 = 2026-01-19T23:00:00Z
    expect(startOfTodayInParis(now).toISOString()).toBe('2026-01-19T23:00:00.000Z');
  });
});
```

- [ ] **Step 2: Run the tests, confirm they fail**

Run: `pnpm --filter @nexushub/domain test -- dates`
Expected: FAIL — `Cannot find module './index'`.

- [ ] **Step 3: Write the implementation**

Create `packages/domain/src/dates/index.ts`:

```ts
/**
 * Timezone-aware deadline helpers. Pure — no Node/Next/Prisma deps.
 *
 * Deadlines are date-only ("a day"), entered via a date input and stored at
 * UTC midnight. The product rule (decided 2026-05-20) treats a deadline as
 * end-of-day in Europe/Paris: a card due 20/5 is only overdue from 21/5
 * 00:00 Paris. We compare calendar days in Paris rather than instants, which
 * is DST-safe and needs no offset arithmetic.
 */

export const DUE_TIME_ZONE = 'Europe/Paris';

/** "YYYY-MM-DD" calendar day of `d` in the given IANA timezone. */
function calendarDayInTz(d: Date, timeZone: string): string {
  // en-CA formats as ISO YYYY-MM-DD, which is lexicographically comparable.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/**
 * True when `now`'s calendar day (Paris) is strictly after the due date's
 * calendar day (Paris) — i.e. the deadline's day has fully elapsed.
 */
export function isDueDateOverdue(
  dueDate: Date,
  now: Date,
  timeZone: string = DUE_TIME_ZONE,
): boolean {
  return calendarDayInTz(now, timeZone) > calendarDayInTz(dueDate, timeZone);
}

/**
 * The UTC instant corresponding to *today's* local midnight in Paris.
 * Used by the "overdue" card filter to build a `dueDate < X` clause that
 * matches the calendar-day semantics above.
 */
export function startOfTodayInParis(now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: DUE_TIME_ZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(now);

  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? '0');

  // `now` re-expressed as if its Paris wall-clock were UTC.
  const wallClockAsUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  // Paris offset (ms ahead of UTC) at this instant.
  const offsetMs = wallClockAsUtc - now.getTime();
  // Paris midnight wall-clock for today, then shift back by the offset to UTC.
  const parisMidnightWallClockAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'));
  return new Date(parisMidnightWallClockAsUtc - offsetMs);
}
```

- [ ] **Step 4: Run the tests, expect green**

Run: `pnpm --filter @nexushub/domain test -- dates`
Expected: PASS — 8 assertions.

- [ ] **Step 5: Re-export from the domain barrel**

Modify `packages/domain/src/index.ts` — add after the `./scope/index` line:

```ts
export * from './dates/index';
```

- [ ] **Step 6: Typecheck the domain package**

Run: `pnpm --filter @nexushub/domain typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/domain/src/dates packages/domain/src/index.ts
git commit -m "feat(domain): Paris end-of-day deadline helpers"
```

---

## Task 2: Apply end-of-day semantics in the blocked-routing rules — TDD

**Files:**

- Modify: `packages/domain/src/kanban/index.ts:80-97`
- Modify: `packages/domain/src/kanban/kanban.test.ts`

- [ ] **Step 1: Update the kanban tests to the end-of-day semantics**

Open `packages/domain/src/kanban/kanban.test.ts`. Find the `shouldMoveToBlocked` / `shouldRestoreFromBlocked` describe blocks. Add these cases (and adjust any existing case that assumed instant comparison — e.g. a test that set `dueDate` to "1ms before now" expecting blocked must change, since same-day is no longer overdue):

```ts
import { isDueDateOverdue } from '../dates/index';
// (top of file, with the other imports)

describe('shouldMoveToBlocked — end-of-day deadline', () => {
  const cols = [
    { id: 'a', name: 'À faire', position: 1, isBlockedSystem: false },
    { id: 'b', name: 'En cours', position: 2, isBlockedSystem: false },
    { id: 'done', name: 'Done', position: 3, isBlockedSystem: false },
    { id: 'blk', name: 'Bloqué', position: 99, isBlockedSystem: true },
  ];
  const baseCard = {
    id: 'c1',
    columnId: 'b',
    previousColumnId: null,
    checklistTotal: 0,
    checklistDone: 0,
    archivedAt: null as Date | null,
  };

  it('does NOT block a card due today (Paris)', () => {
    const due = new Date('2026-05-20T00:00:00.000Z');
    const now = new Date('2026-05-20T09:00:00.000Z'); // same Paris day
    expect(shouldMoveToBlocked({ ...baseCard, dueDate: due }, now, cols)).toBe(false);
  });

  it('blocks a card whose deadline day has passed', () => {
    const due = new Date('2026-05-19T00:00:00.000Z');
    const now = new Date('2026-05-20T09:00:00.000Z');
    expect(shouldMoveToBlocked({ ...baseCard, dueDate: due }, now, cols)).toBe(true);
  });

  it('still never blocks the last user column', () => {
    const due = new Date('2026-05-18T00:00:00.000Z');
    const now = new Date('2026-05-20T09:00:00.000Z');
    expect(shouldMoveToBlocked({ ...baseCard, columnId: 'done', dueDate: due }, now, cols)).toBe(
      false,
    );
  });
});
```

> Before writing them, read the existing `shouldMoveToBlocked`/`shouldRestoreFromBlocked` tests in this file. If any existing assertion encodes the old instant rule (e.g. `dueDate` set to `now - 1ms` and expecting `true`), update it to use a clearly-past _day_ so it matches the new semantics. Keep the column-exemption and archived-card cases unchanged.

- [ ] **Step 2: Run the tests, confirm the new ones fail**

Run: `pnpm --filter @nexushub/domain test -- kanban`
Expected: FAIL on the "due today" case (current code blocks it via instant comparison).

- [ ] **Step 3: Update the implementation**

In `packages/domain/src/kanban/index.ts`, add the import near the top (after the file header comment / existing constants):

```ts
import { isDueDateOverdue } from '../dates/index';
```

Replace the body of `shouldMoveToBlocked` overdue check:

```ts
export function shouldMoveToBlocked(card: Card, now: Date, columns: readonly Column[]): boolean {
  if (card.archivedAt !== null) return false;
  if (card.dueDate === null) return false;
  if (!isDueDateOverdue(card.dueDate, now)) return false;

  const current = columns.find((c) => c.id === card.columnId);
  if (!current) return false;
  if (current.isBlockedSystem) return false;
  if (isLastUserColumn(current, columns)) return false;
  return true;
}
```

Replace the body of `shouldRestoreFromBlocked`:

```ts
export function shouldRestoreFromBlocked(card: Card, now: Date, currentColumn: Column): boolean {
  if (!currentColumn.isBlockedSystem) return false;
  if (card.previousColumnId === null) return false;
  if (card.dueDate === null) return true; // due date cleared → unblock
  return !isDueDateOverdue(card.dueDate, now);
}
```

- [ ] **Step 4: Run the full domain suite, expect green**

Run: `pnpm --filter @nexushub/domain test`
Expected: PASS (all kanban + dates tests).

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/kanban/index.ts packages/domain/src/kanban/kanban.test.ts
git commit -m "feat(domain): treat deadlines as end-of-day Paris in blocked routing"
```

---

## Task 3: Align the "overdue" card filter to Paris

**Files:**

- Modify: `apps/web/features/projects/lib/card-filter.ts:153-175`

- [ ] **Step 1: Import the Paris helper + use it for overdue**

In `apps/web/features/projects/lib/card-filter.ts`, add to the existing `@nexushub/domain` import (or add a new import line):

```ts
import { startOfTodayInParis } from '@nexushub/domain';
```

Then change the `overdue` branch in `buildDueWhere`:

```ts
if (due.mode === 'overdue') {
  return { dueDate: { lt: startOfTodayInParis() } };
}
```

> Leave `today`/`week`/`range` as-is (they use `startOfTodayUtc()` for coarse range bucketing — out of scope; only `overdue` must match the new deadline semantics). `startOfTodayUtc` stays used by those branches, so do not remove it.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @nexushub/web typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/features/projects/lib/card-filter.ts
git commit -m "feat(web): align overdue filter to Paris end-of-day"
```

---

## Task 4: Kanban "done" visual (last user column → completed badge + struck title)

**Files:**

- Modify: `apps/web/features/projects/components/kanban-card.tsx`
- Modify: `apps/web/features/projects/components/kanban-column.tsx:119-125`
- Modify: `apps/web/features/projects/components/kanban-board.tsx` (DragOverlay)
- Modify: `packages/ui/src/tokens/components.css`

- [ ] **Step 1: Add the prop + conditional render in `KanbanCard`**

In `apps/web/features/projects/components/kanban-card.tsx`:

(a) Add the import alongside the existing `CardAdvanceCheckbox` import:

```ts
import { CardCompletedBadge } from './card-completed-badge';
```

(b) Add `isLastUserColumn` to `KanbanCardProps` (after `isReadOnly`):

```ts
  /** When true, the card sits in the last user column → render as "done"
   *  (filled check + struck title), mirroring the list view. */
  readonly isLastUserColumn?: boolean;
```

(c) Destructure it in the component signature with a default:

```ts
export function KanbanCard({
  card,
  blocked,
  cannotAdvance,
  csrfToken,
  isReadOnly = false,
  isLastUserColumn = false,
}: KanbanCardProps) {
```

(d) Replace the `CardAdvanceCheckbox` block (the one wrapped in `csrfToken ? (...)`, currently at lines ~102-107) so the top-left control switches to the completed badge in the last column:

```tsx
<div style={{ position: 'absolute', top: 10, left: 12, zIndex: 10 }}>
  {isLastUserColumn ? (
    <CardCompletedBadge cardId={card.id} disabled={isReadOnly} />
  ) : (
    <CardAdvanceCheckbox
      cardId={card.id}
      disabled={Boolean(blocked || cannotAdvance || isReadOnly)}
    />
  )}
</div>
```

(e) Strike the title when done — replace the title line:

```tsx
<div className={`kcard-title${isLastUserColumn ? 'kcard-title--done' : ''}`}>{card.title}</div>
```

- [ ] **Step 2: Pass the flag from `KanbanColumn`**

In `apps/web/features/projects/components/kanban-column.tsx`, the `<KanbanCard>` render (~line 119) already passes `cannotAdvance`. Add the new prop:

```tsx
<KanbanCard
  key={card.id}
  card={card}
  csrfToken={csrfToken}
  cannotAdvance={column.isBlockedSystem || isLastUserColumn === true}
  isLastUserColumn={isLastUserColumn === true}
  isReadOnly={isReadOnly}
/>
```

(Keep the existing props; only add the `isLastUserColumn` line.)

- [ ] **Step 3: Pass the flag to the `DragOverlay` card in `KanbanBoard`**

In `apps/web/features/projects/components/kanban-board.tsx`, the `<DragOverlay>` renders `<KanbanCard card={activeCard} isReadOnly={isReadOnly} />`. Compute whether the dragged card is in the last user column and pass it:

```tsx
<DragOverlay>
  {activeCard ? (
    <KanbanCard
      card={activeCard}
      isReadOnly={isReadOnly}
      isLastUserColumn={activeCard.columnId === lastUserColumnId}
    />
  ) : null}
</DragOverlay>
```

> `lastUserColumnId` is already computed in this component (it's passed to `KanbanColumn`). Reuse the same variable.

- [ ] **Step 4: Add the strike style**

In `packages/ui/src/tokens/components.css`, find the `.kcard-title { ... }` rule and add immediately after it:

```css
.kcard-title--done {
  color: var(--text-muted);
  text-decoration: line-through;
}
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @nexushub/web typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/features/projects/components/kanban-card.tsx apps/web/features/projects/components/kanban-column.tsx apps/web/features/projects/components/kanban-board.tsx packages/ui/src/tokens/components.css
git commit -m "feat(web): Kanban done-visual parity with list view"
```

---

## Task 5: Login as landing page

**Files:**

- Modify: `apps/web/app/page.tsx`

- [ ] **Step 1: Replace the welcome page with a redirect**

Overwrite `apps/web/app/page.tsx` entirely:

```tsx
import { redirect } from 'next/navigation';
import { getAuthContext } from '@/lib/auth';

/**
 * Root entry point. There is no marketing/welcome screen — `/` sends the
 * visitor straight to the app (if signed in) or the login page.
 */
export default async function HomePage() {
  const ctx = await getAuthContext();
  redirect(ctx ? '/overview' : '/login');
}
```

> `getAuthContext()` is the non-throwing variant exported from `@/lib/auth` (returns `null` when unauthenticated). `redirect()` returns `never`, so no JSX is needed.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @nexushub/web typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/page.tsx
git commit -m "feat(web): make login the landing page (drop welcome screen)"
```

---

## Task 6: Install Tiptap

**Files:**

- Modify: `apps/web/package.json`

- [ ] **Step 1: Check Context7 for current stable versions**

Query Context7 MCP for `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-underline`, `@tiptap/extension-link`, `@tiptap/extension-placeholder`, and `tiptap-markdown`. Note the latest stable major (Tiptap v2 line), peer deps (`@tiptap/pm` is a required peer), and any React 19 / Next 15 caveats. Record the versions in the commit message.

- [ ] **Step 2: Install into the web app**

Run from the worktree root:

```bash
pnpm --filter @nexushub/web add @tiptap/react @tiptap/pm @tiptap/starter-kit @tiptap/extension-underline @tiptap/extension-link @tiptap/extension-placeholder tiptap-markdown
```

Expected: `apps/web/package.json` gains the seven entries; lockfile updates.

- [ ] **Step 3: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml
git commit -m "chore(web): add Tiptap for the WYSIWYG comment editor"
```

---

## Task 7: Rewrite `CommentEditor` with Tiptap (Markdown storage)

**Files:**

- Modify: `apps/web/features/projects/components/comment-editor.tsx`

The public contract is unchanged: same props (`name`, `defaultValue`, `placeholder`, `disabled`, `ariaLabel`, `onSubmitShortcut`) and the same imperative handle (`clear()`, `focus()`). Consumers (`card-comment-form.tsx`, `card-comment-item.tsx`) keep working untouched. Internally the `<textarea>` becomes a Tiptap editor that writes Markdown into a hidden `<input name={name}>`.

- [ ] **Step 1: Write the new component**

Overwrite `apps/web/features/projects/components/comment-editor.tsx`:

```tsx
'use client';
import { forwardRef, useImperativeHandle } from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { Markdown } from 'tiptap-markdown';

export interface CommentEditorHandle {
  clear: () => void;
  focus: () => void;
}

export interface CommentEditorProps {
  readonly name: string;
  /** Markdown source to prefill (edit mode). */
  readonly defaultValue?: string;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly ariaLabel: string;
  /** Cmd/Ctrl+Enter → parent form submit. */
  readonly onSubmitShortcut?: () => void;
}

/** Read the editor document back as Markdown (tiptap-markdown storage API). */
function toMarkdown(editor: Editor | null): string {
  if (!editor) return '';
  const md = editor.storage.markdown?.getMarkdown?.();
  return typeof md === 'string' ? md.trim() : '';
}

export const CommentEditor = forwardRef<CommentEditorHandle, CommentEditorProps>(
  function CommentEditor(
    { name, defaultValue, placeholder, disabled, ariaLabel, onSubmitShortcut },
    ref,
  ) {
    const editor = useEditor({
      // Next.js 15 SSR: render only on the client to avoid hydration mismatch.
      immediatelyRender: false,
      editable: !disabled,
      extensions: [
        StarterKit.configure({
          // Match the sanitizer whitelist: drop headings / images / HR.
          heading: false,
          horizontalRule: false,
        }),
        Underline,
        Link.configure({
          openOnClick: false,
          autolink: true,
          protocols: ['https', 'mailto'],
          HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
        }),
        Placeholder.configure({ placeholder: placeholder ?? '' }),
        Markdown.configure({ html: false, linkify: true }),
      ],
      content: defaultValue ?? '',
      editorProps: {
        attributes: {
          'aria-label': ariaLabel,
          class: 'nx-comment-editor__surface',
        },
        handleKeyDown: (_view, event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault();
            onSubmitShortcut?.();
            return true;
          }
          return false;
        },
      },
    });

    useImperativeHandle(
      ref,
      () => ({
        clear: () => editor?.commands.clearContent(true),
        focus: () => editor?.commands.focus(),
      }),
      [editor],
    );

    const markdownValue = toMarkdown(editor);
    const isActive = (mark: string) => editor?.isActive(mark) ?? false;

    const setLink = () => {
      if (!editor) return;
      const previous = (editor.getAttributes('link').href as string | undefined) ?? 'https://';
      // eslint-disable-next-line no-alert -- simple URL prompt, parity with old editor
      const url = window.prompt('URL du lien (https://…)', previous);
      if (url === null) return;
      if (url.trim().length === 0) {
        editor.chain().focus().unsetLink().run();
        return;
      }
      editor.chain().focus().extendMarkAsLink(url.trim());
    };

    return (
      <div className="nx-comment-editor">
        <div className="nx-comment-editor__toolbar" role="toolbar" aria-label="Mise en forme">
          <button
            type="button"
            className={`nx-comment-editor__btn${isActive('bold') ? 'is-active' : ''}`}
            onClick={() => editor?.chain().focus().toggleBold().run()}
            disabled={disabled}
            title="Gras (Cmd/Ctrl+B)"
            aria-label="Gras"
            aria-pressed={isActive('bold')}
          >
            <strong>B</strong>
          </button>
          <button
            type="button"
            className={`nx-comment-editor__btn${isActive('italic') ? 'is-active' : ''}`}
            onClick={() => editor?.chain().focus().toggleItalic().run()}
            disabled={disabled}
            title="Italique (Cmd/Ctrl+I)"
            aria-label="Italique"
            aria-pressed={isActive('italic')}
          >
            <em>I</em>
          </button>
          <button
            type="button"
            className={`nx-comment-editor__btn${isActive('underline') ? 'is-active' : ''}`}
            onClick={() => editor?.chain().focus().toggleUnderline().run()}
            disabled={disabled}
            title="Souligné (Cmd/Ctrl+U)"
            aria-label="Souligné"
            aria-pressed={isActive('underline')}
          >
            <span style={{ textDecoration: 'underline' }}>U</span>
          </button>
          <button
            type="button"
            className={`nx-comment-editor__btn${isActive('link') ? 'is-active' : ''}`}
            onClick={setLink}
            disabled={disabled}
            title="Lien"
            aria-label="Lien"
            aria-pressed={isActive('link')}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 16 16"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M6.5 9.5l3-3" />
              <path d="M7 4.5l1.5-1.5a2.5 2.5 0 0 1 3.5 3.5L10.5 8" />
              <path d="M9 11.5L7.5 13a2.5 2.5 0 0 1-3.5-3.5L5.5 8" />
            </svg>
          </button>
        </div>
        <EditorContent editor={editor} />
        <input type="hidden" name={name} value={markdownValue} />
      </div>
    );
  },
);
```

> **Note on `extendMarkAsLink`:** if the installed `@tiptap/extension-link` version does not expose that command, use the standard chain instead: `editor.chain().focus().setLink({ href: url.trim() }).run();`. Confirm against the Context7 docs from Task 6 and use whichever the installed version supports. The hidden input must re-render with the latest Markdown on every keystroke — `useEditor` re-renders the component on transactions by default, so `toMarkdown(editor)` recomputes each render. If you find the hidden input lagging by one keystroke, add `onUpdate` to `useEditor` that calls a `useState` setter for the markdown value and bind the input to that state instead.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @nexushub/web typecheck`
Expected: PASS. If `editor.storage.markdown` typing complains, the `tiptap-markdown` types augment the storage; if not picked up, narrow with a local type guard (no `any` — use `unknown` + `typeof` check as already written in `toMarkdown`).

- [ ] **Step 3: Lint**

Run: `pnpm --filter @nexushub/web lint`
Expected: PASS (the single `no-alert` is disabled inline with justification, matching the previous editor).

- [ ] **Step 4: Commit**

```bash
git add apps/web/features/projects/components/comment-editor.tsx
git commit -m "feat(web): Tiptap WYSIWYG comment editor (Markdown storage)"
```

---

## Task 8: Tiptap editor styles

**Files:**

- Modify: `packages/ui/src/tokens/components.css`

- [ ] **Step 1: Replace the textarea-specific rules with editor-surface rules**

In `packages/ui/src/tokens/components.css`, locate the comment-editor block (the `.nx-comment-editor__textarea` / `.nx-comment-editor__toolbar` rules added in the card-comments work). Keep the toolbar + button rules. Replace the `.nx-comment-editor__textarea` selector with the Tiptap surface, and add active-state + placeholder + content styles. Append/replace with:

```css
.nx-comment-editor__surface {
  min-height: 72px;
  max-height: 320px;
  overflow-y: auto;
  padding: 10px 12px;
  border: 1px solid var(--border-light);
  border-top: 0;
  border-radius: 0 0 8px 8px;
  font-size: 14px;
  line-height: 1.55;
  background: var(--bg-card);
  color: var(--text-main);
  outline: none;
}
.nx-comment-editor__surface:focus-within,
.nx-comment-editor .ProseMirror-focused {
  border-color: var(--accent-primary);
  box-shadow: 0 0 0 3px rgba(139, 43, 226, 0.18);
}
/* Placeholder (shown when the doc is empty) */
.nx-comment-editor__surface p.is-editor-empty:first-child::before {
  content: attr(data-placeholder);
  color: var(--text-ghost);
  float: left;
  height: 0;
  pointer-events: none;
}
.nx-comment-editor__surface p {
  margin: 0 0 6px 0;
}
.nx-comment-editor__surface a {
  color: var(--accent-primary);
  text-decoration: underline;
}
.nx-comment-editor__surface code {
  background: rgba(139, 43, 226, 0.08);
  padding: 1px 4px;
  border-radius: 4px;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 13px;
}
.nx-comment-editor__surface pre {
  background: #0f172a;
  color: #e2e8f0;
  padding: 10px 12px;
  border-radius: 8px;
  overflow-x: auto;
}
.nx-comment-editor__btn.is-active {
  background: rgba(139, 43, 226, 0.14);
  color: var(--accent-primary);
}
```

> The placeholder rule relies on Tiptap adding `is-editor-empty` to the first empty paragraph. StarterKit ships the Placeholder behavior via the `data-placeholder` attribute we set in `editorProps.attributes`; if the empty-state class differs in the installed version, adjust the selector to match (inspect the rendered DOM during the smoke test).

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/tokens/components.css
git commit -m "feat(web): styles for the Tiptap comment editor"
```

---

## Task 9: Build verification

**Files:** none.

- [ ] **Step 1: Full typecheck + lint + tests**

Run:

```bash
pnpm -w typecheck
pnpm -w lint
pnpm -w test
```

Expected: all green. The domain suite gains the `dates` tests + updated kanban tests.

- [ ] **Step 2: Production build (catches Tiptap SSR/bundling issues)**

Run:

```bash
pnpm --filter @nexushub/web build
```

Expected: "Compiled successfully" + page-data collection passes. (The build may stop at static prerender for pages needing `NEXT_PUBLIC_*` env if run without `.env.local` — that's environmental, not a code failure. Confirm it gets past "Collecting page data" and "Compiled successfully".)

> If the build fails on Tiptap during bundling (ESM/CJS interop or SSR), apply the same remedy pattern used for the markdown lib: ensure `immediatelyRender: false` is set (already in Task 7) and, if needed, add the offending package to `serverExternalPackages` in `apps/web/next.config.ts`. Report any such change as a deviation.

---

## Task 10: Manual smoke test

**Files:** none.

- [ ] **Step 1: Boot the dev server**

The dev script hardcodes port 3000; run on another port from the worktree:

```bash
cd apps/web && ./node_modules/.bin/next dev --turbo --port 3001
```

(Requires `.env.local`; if missing in the worktree, copy it from the repo root as done previously.)

- [ ] **Step 2: Verify each change**

1. **Login landing**: open `/` while logged out → lands on `/login`. Log in → `/` redirects to `/overview`.
2. **Kanban done**: a card in the last user column shows the filled completed badge + struck title; clicking the badge sends it back a column (existing `uncompleteCard` behavior). A card in an earlier column still shows the advance checkbox.
3. **Deadline**: set a card's due date to _today_, not in the last column → it does NOT move to Bloqué. Set it to _yesterday_ → on next page load it moves to Bloqué. Push the date back to the future → it leaves Bloqué.
4. **Comment editor**: open a card, type in the comment box, apply Bold/Italic/Underline/Link via the toolbar — formatting renders live, no `**` visible. Send → the comment renders correctly. Edit an existing (Markdown) comment → it loads formatted in the editor; save → still correct.

- [ ] **Step 2: No commit — confirm with the user that smoke passed.**

---

## Task 11: Finish

- [ ] **Step 1: Hand off to `superpowers:finishing-a-development-branch`**

Invoke the finishing skill with `branch: optimisation` to push + open a PR (or merge), per the user's choice. No DB migration in this branch, so no migrate-before-deploy concern.

---

## Notes for the implementer

- **No DB migration** — the deadline change is comparison-only; storage is unchanged. Do not add a migration.
- **Domain stays pure** — `packages/domain/src/dates` must not import anything from Node/Next/Prisma. `Intl` is a JS built-in, allowed.
- **Comment storage stays Markdown** — do NOT change `createComment`/`updateComment` or the `sanitize-html` render. Tiptap only changes the _editing_ surface; it serialises back to Markdown into the hidden `body` input.
- **Don't touch the read render** — comments are still displayed via `renderMarkdownToSafeHtml` (server-side). `<u>` is already whitelisted.
- **Underline ↔ Markdown** — `tiptap-markdown` serialises underline as `<u>…</u>` (inline HTML), which the sanitizer keeps. Verify this round-trips during the smoke test.
- **Reuse `CardCompletedBadge`** — do not build a new "done" control for the Kanban; the list view's component is already correct (handles click-to-uncomplete + read-only).
