# Card Comments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship card comments end-to-end on `feature/card-comments` — every authenticated user (Admin, User, Viewer) in scope of a card can post / edit / delete their own markdown comments; assignees (R/A/C/I) receive an instant email per new comment (minus the author).

**Architecture:** A shared, security-hardened markdown→HTML helper lives in `@nexushub/integrations/markdown` and is consumed by both the comments feature and any future surface (Slack relay, Notes). Three Server Actions (`createComment`, `updateComment`, `deleteComment`) handle every mutation with explicit scope/author/admin checks; email fan-out goes through `Promise.allSettled` so a partial Resend failure does not break the action. The card modal gets a new "Commentaires" pane built from three components — `CardCommentsThread` (renders pre-sanitised HTML), `CardCommentItem` (per-row actions), `CardCommentForm` (markdown textarea + Cmd/Ctrl+Enter submit).

**Tech Stack:** Next.js 15 (App Router + Server Actions) · React 19 (`useTransition`) · Prisma 6 (`Comment` row already exists) · Zod (input schemas) · `marked` (markdown parser) · `isomorphic-dompurify` (HTML sanitizer, runs server- and client-side) · Resend (email) · Vitest (tests).

**Worktree:** `/Users/angelogeraci/Documents/Application/BND-OS/.worktrees/card-comments` · **Branch:** `feature/card-comments` · **Base:** `main` at commit `455d06c` (the spec).

---

## File structure (locked-in)

### Created

- `packages/integrations/src/markdown/index.ts` — `renderMarkdownToSafeHtml(raw)` + `markdownToPlainText(raw)`
- `packages/integrations/src/markdown/index.test.ts` — XSS / scheme / markdown spec tests
- `packages/db/prisma/migrations/20260519160001_comments_channel_email_and_rls/migration.sql`
- `apps/web/features/projects/lib/comment-schemas.ts` — Zod schemas + body limits
- `apps/web/features/projects/lib/load-card-comments.ts` — single Prisma query + HTML render (server-side helper used by page.tsx, list/page.tsx, get-card-modal-data)
- `apps/web/features/projects/actions/create-comment.ts`
- `apps/web/features/projects/actions/create-comment.test.ts`
- `apps/web/features/projects/actions/update-comment.ts`
- `apps/web/features/projects/actions/update-comment.test.ts`
- `apps/web/features/projects/actions/delete-comment.ts`
- `apps/web/features/projects/actions/delete-comment.test.ts`
- `apps/web/features/notifications/email/comment-notification.ts` — `renderCommentNotificationEmail()`
- `apps/web/features/notifications/email/comment-notification.test.ts`
- `apps/web/features/projects/components/card-comments-thread.tsx` — Client Component, receives pre-sanitised HTML
- `apps/web/features/projects/components/card-comment-item.tsx` — Client Component, per-row, edit/delete inline
- `apps/web/features/projects/components/card-comment-form.tsx` — Client Component, textarea + Cmd/Ctrl+Enter
- `apps/web/features/projects/lib/comment-dto.ts` — shared `CardCommentDTO` type (server + client)

### Modified

- `packages/integrations/package.json` — add `marked` + `isomorphic-dompurify`
- `packages/integrations/src/index.ts` — re-export `* as markdown`
- `packages/db/prisma/schema.prisma` — add `email` to `enum NotificationChannel`
- `apps/web/app/(app)/projects/[id]/page.tsx` — load comments when `openCard` is set, pass DTO array into `CardModalController`
- `apps/web/app/(app)/projects/[id]/list/page.tsx` — same
- `apps/web/features/projects/actions/get-card-modal-data.ts` — include `comments` in the payload
- `apps/web/features/projects/components/card-modal-controller.tsx` — accept `comments` prop, pass through
- `apps/web/features/projects/components/card-modal.tsx` — mount `<CardCommentsThread>` under the existing main column
- `.claude/projects/-Users-angelogeraci-Documents-Application-BND-OS/memory/MEMORY.md` + `project_comments_deferred.md` — delete the "deferred" memory note now that the feature is shipped

> **Existing security model unchanged:** server actions run as service-role and bypass RLS; we strengthen the RLS posture defensively (no direct INSERT/UPDATE/DELETE from supabase-js clients) but the policy _change_ is the only DB-RLS work — no business-logic-in-SQL.

---

## Task 0: Worktree sanity check

**Files:** none changed.

- [ ] **Step 1: Confirm worktree + branch**

Run:

```bash
cd /Users/angelogeraci/Documents/Application/BND-OS/.worktrees/card-comments
git status --short
git branch --show-current
```

Expected: clean working tree, branch `feature/card-comments`.

- [ ] **Step 2: Confirm Prisma generates + tests green at baseline**

Run:

```bash
pnpm -w test
```

Expected: all suites pass (154 domain tests + web tests). If anything fails here, stop and report — do not start changes on a red baseline.

---

## Task 1: Add `marked` + `isomorphic-dompurify` to `@nexushub/integrations`

**Files:**

- Modify: `packages/integrations/package.json`

- [ ] **Step 1: Check Context7 for current stable versions** (CLAUDE.md §2)

Query Context7 MCP for `marked` and `isomorphic-dompurify`. Note the latest stable version of each, peer deps, and any TypeScript-related caveats. Record the chosen versions in the commit message.

- [ ] **Step 2: Install the two libraries into the integrations package**

Run from worktree root:

```bash
pnpm --filter @nexushub/integrations add marked isomorphic-dompurify
```

Expected: lockfile updates, `packages/integrations/package.json` gains the two entries under `dependencies`.

- [ ] **Step 3: Commit**

```bash
git add packages/integrations/package.json pnpm-lock.yaml
git commit -m "chore(integrations): add marked + isomorphic-dompurify for markdown rendering"
```

---

## Task 2: Markdown helper — write failing tests first

**Files:**

- Create: `packages/integrations/src/markdown/index.test.ts`

- [ ] **Step 1: Scaffold the test file with full XSS + markdown coverage**

Write `packages/integrations/src/markdown/index.test.ts`:

````ts
import { describe, expect, it } from 'vitest';
import { renderMarkdownToSafeHtml, markdownToPlainText } from './index';

describe('renderMarkdownToSafeHtml', () => {
  it('renders bold + italic + inline code', () => {
    const out = renderMarkdownToSafeHtml('**bold** *em* `code`');
    expect(out).toContain('<strong>bold</strong>');
    expect(out).toContain('<em>em</em>');
    expect(out).toContain('<code>code</code>');
  });

  it('renders fenced code blocks', () => {
    const out = renderMarkdownToSafeHtml('```\nhello\n```');
    expect(out).toContain('<pre>');
    expect(out).toContain('<code>');
    expect(out).toContain('hello');
  });

  it('renders bullet + ordered lists', () => {
    const ul = renderMarkdownToSafeHtml('- one\n- two');
    expect(ul).toContain('<ul>');
    expect(ul).toContain('<li>one</li>');
    const ol = renderMarkdownToSafeHtml('1. one\n2. two');
    expect(ol).toContain('<ol>');
  });

  it('renders blockquote', () => {
    const out = renderMarkdownToSafeHtml('> quoted');
    expect(out).toContain('<blockquote>');
  });

  it('renders https links with target=_blank + rel=noopener noreferrer', () => {
    const out = renderMarkdownToSafeHtml('[label](https://example.com)');
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
  });

  it('renders mailto: links', () => {
    const out = renderMarkdownToSafeHtml('[mail me](mailto:a@b.c)');
    expect(out).toContain('href="mailto:a@b.c"');
  });

  it('strips javascript: schemes from anchors', () => {
    const out = renderMarkdownToSafeHtml('[click](javascript:alert(1))');
    expect(out).not.toContain('javascript:');
    expect(out).not.toContain('alert');
  });

  it('strips data: schemes from anchors', () => {
    const out = renderMarkdownToSafeHtml('[x](data:text/html,<script>1</script>)');
    expect(out).not.toContain('data:');
    expect(out).not.toContain('<script>');
  });

  it('strips raw <script> tags', () => {
    const out = renderMarkdownToSafeHtml('hello<script>alert(1)</script>world');
    expect(out).not.toContain('<script>');
    expect(out).not.toContain('alert');
    expect(out).toContain('hello');
    expect(out).toContain('world');
  });

  it('strips <img> tags entirely', () => {
    const out = renderMarkdownToSafeHtml('![pwn](https://x.test/x.png)');
    expect(out).not.toContain('<img');
  });

  it('strips <iframe> tags', () => {
    const out = renderMarkdownToSafeHtml('<iframe src="https://evil"></iframe>');
    expect(out).not.toContain('<iframe');
  });

  it('strips on* event-handler attributes', () => {
    const out = renderMarkdownToSafeHtml('<a href="https://x.test" onclick="alert(1)">x</a>');
    expect(out).not.toContain('onclick');
    expect(out).not.toContain('alert');
  });

  it('strips style attributes (CSS-based XSS like background:url(javascript:…))', () => {
    const out = renderMarkdownToSafeHtml('<a href="https://x.test" style="background:red">x</a>');
    expect(out).not.toContain('style=');
  });

  it('escapes lone < and > characters in plain text', () => {
    const out = renderMarkdownToSafeHtml('a < b > c');
    expect(out).not.toMatch(/<[a-z]/i);
  });

  it('returns empty string for empty input', () => {
    expect(renderMarkdownToSafeHtml('')).toBe('');
    expect(renderMarkdownToSafeHtml('   \n  ')).toBe('');
  });
});

describe('markdownToPlainText', () => {
  it('strips markdown syntax', () => {
    expect(markdownToPlainText('**bold** and *italic*')).toBe('bold and italic');
  });

  it('strips link syntax but keeps the label', () => {
    expect(markdownToPlainText('see [docs](https://x.test)')).toBe('see docs');
  });

  it('flattens multiline content to spaces', () => {
    const out = markdownToPlainText('line one\n\nline two\n- a\n- b');
    expect(out).toContain('line one');
    expect(out).toContain('line two');
    expect(out).toContain('a');
    expect(out).toContain('b');
    expect(out).not.toContain('\n\n');
  });

  it('truncates politely with ellipsis when limit is given', () => {
    const long = 'a'.repeat(500);
    const out = markdownToPlainText(long, 100);
    expect(out.length).toBeLessThanOrEqual(101); // 100 + ellipsis "…" = 1 char
    expect(out.endsWith('…')).toBe(true);
  });

  it('does not truncate when under limit', () => {
    const out = markdownToPlainText('short', 100);
    expect(out).toBe('short');
  });
});
````

- [ ] **Step 2: Run the suite and confirm it fails**

Run:

```bash
pnpm --filter @nexushub/integrations test
```

Expected: FAIL — `Cannot find module './index'` or similar.

---

## Task 3: Implement the markdown helper

**Files:**

- Create: `packages/integrations/src/markdown/index.ts`

- [ ] **Step 1: Write the implementation**

Create `packages/integrations/src/markdown/index.ts`:

````ts
/**
 * Markdown → safe HTML (and → plain text) helper.
 *
 * Shared by every surface that needs user-authored prose: card comments
 * (V1), Slack mirror (V1.5), Notes (V2). Single sanitisation policy
 * means a future XSS finding is patched in one place.
 *
 * SECURITY:
 *  - Stored body is raw markdown — sanitisation happens at render time
 *    so an updated DOMPurify whitelist applies retroactively to old rows.
 *  - Whitelist is intentionally narrow: no <img>, no <iframe>, no event
 *    handlers, no styles, no data:/javascript: URIs.
 */
import { marked } from 'marked';
import DOMPurify from 'isomorphic-dompurify';

const ALLOWED_TAGS = [
  'p',
  'br',
  'strong',
  'em',
  'code',
  'pre',
  'blockquote',
  'ul',
  'ol',
  'li',
  'a',
];

const ALLOWED_ATTR = ['href', 'target', 'rel'];

// marked options — keep close to GFM minus image rendering. We disable
// `mangle` (legacy email-obfuscation) and `headerIds` (no h*, no IDs).
marked.use({
  gfm: true,
  breaks: true,
});

/**
 * Convert raw markdown to a sanitised HTML string suitable for
 * `dangerouslySetInnerHTML`. Returns "" for empty input.
 *
 * Calling this twice on already-safe HTML is idempotent (DOMPurify does
 * not re-encode entities).
 */
export function renderMarkdownToSafeHtml(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return '';

  // marked v12+ returns string synchronously when `async: false` is the
  // default; we cast to string to keep TS happy across minor versions.
  const dirty = marked.parse(trimmed, { async: false }) as string;

  const clean = DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    // Stricter than the default: only https + mailto for href.
    ALLOWED_URI_REGEXP: /^(?:https:|mailto:)/i,
    ADD_ATTR: ['target', 'rel'], // ensure they're not stripped post-hook
    FORBID_TAGS: ['style', 'script', 'iframe', 'img'],
    FORBID_ATTR: ['style', 'onerror', 'onclick', 'onload', 'onmouseover'],
  });

  // Force every anchor to open in a new tab with safe rel — DOMPurify
  // strips javascript: hrefs but does not add target/rel for us.
  return clean.replace(
    /<a\s+([^>]*?)href="([^"]+)"([^>]*)>/gi,
    (_match, pre: string, href: string, post: string) => {
      // Strip any attacker-supplied target/rel, set our own.
      const cleanedPre = pre.replace(/\s(target|rel)="[^"]*"/gi, '');
      const cleanedPost = post.replace(/\s(target|rel)="[^"]*"/gi, '');
      return `<a ${cleanedPre.trim()} href="${href}" target="_blank" rel="noopener noreferrer" ${cleanedPost.trim()}>`.replace(
        /\s+>/,
        '>',
      );
    },
  );
}

/**
 * Convert markdown to a plain-text string, optionally truncated.
 *
 * Used for the email body preview (first 200 chars) where HTML rendering
 * across mail clients is unreliable.
 */
export function markdownToPlainText(raw: string, maxLength?: number): string {
  // Cheap markdown stripping — no need to involve marked here.
  let text = raw
    .replace(/```[\s\S]*?```/g, ' ') // fenced code blocks
    .replace(/`([^`]+)`/g, '$1') // inline code
    .replace(/\*\*([^*]+)\*\*/g, '$1') // bold
    .replace(/__([^_]+)__/g, '$1') // bold (alt)
    .replace(/\*([^*]+)\*/g, '$1') // italic
    .replace(/_([^_]+)_/g, '$1') // italic (alt)
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '') // images
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links → label
    .replace(/^>\s?/gm, '') // blockquote
    .replace(/^[-*+]\s+/gm, '') // bullet markers
    .replace(/^\d+\.\s+/gm, '') // ordered markers
    .replace(/[\r\n]+/g, ' ') // newlines → single space
    .replace(/\s+/g, ' ') // collapse spaces
    .trim();

  if (typeof maxLength === 'number' && text.length > maxLength) {
    text = `${text.slice(0, maxLength)}…`;
  }
  return text;
}
````

- [ ] **Step 2: Run the suite, expect green**

Run:

```bash
pnpm --filter @nexushub/integrations test
```

Expected: PASS — all 22+ assertions across `renderMarkdownToSafeHtml` + `markdownToPlainText`.

- [ ] **Step 3: Re-export from the package barrel + add subpath export**

Modify `packages/integrations/src/index.ts`:

```ts
export * as slack from './slack/index';
export * as graph from './graph/index';
export * as email from './email/index';
export * as markdown from './markdown/index';
```

Modify `packages/integrations/package.json` `exports` block (preserve existing key order — just add the new key):

```json
"exports": {
  ".": "./src/index.ts",
  "./slack": "./src/slack/index.ts",
  "./graph": "./src/graph/index.ts",
  "./email": "./src/email/index.ts",
  "./markdown": "./src/markdown/index.ts"
},
```

- [ ] **Step 4: Typecheck the package**

Run:

```bash
pnpm --filter @nexushub/integrations typecheck
```

Expected: PASS, no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/integrations/src/markdown packages/integrations/src/index.ts packages/integrations/package.json
git commit -m "feat(integrations): sanitised markdown renderer + plain-text extractor"
```

---

## Task 4: Prisma migration — `email` channel + RLS lockdown

**Files:**

- Create: `packages/db/prisma/migrations/20260519160001_comments_channel_email_and_rls/migration.sql`
- Modify: `packages/db/prisma/schema.prisma` (enum NotificationChannel)

- [ ] **Step 1: Edit the Prisma schema to add `email` to NotificationChannel**

In `packages/db/prisma/schema.prisma`, locate `enum NotificationChannel` and update from:

```prisma
enum NotificationChannel {
  push
  slack
}
```

to:

```prisma
enum NotificationChannel {
  push
  slack
  email
}
```

- [ ] **Step 2: Create the migration SQL file**

Create `packages/db/prisma/migrations/20260519160001_comments_channel_email_and_rls/migration.sql`:

```sql
-- Add `email` to the NotificationChannel enum so card-comment notifications
-- can be persisted with channel = 'email'.
ALTER TYPE "public"."NotificationChannel" ADD VALUE IF NOT EXISTS 'email';

-- Defensive RLS posture: every comment write must go through the
-- server-action layer (which checks scope, author, admin). The previous
-- author-only INSERT/UPDATE/DELETE policies are dropped so a leaked user
-- JWT can never write directly via supabase-js. SELECT policy stays —
-- members of the workspace can still read.
DROP POLICY IF EXISTS comments_insert_member ON public.comments;
DROP POLICY IF EXISTS comments_update_own ON public.comments;
DROP POLICY IF EXISTS comments_delete_own ON public.comments;

-- Belt-and-braces explicit deny — anyone (other than service-role bypass)
-- attempting INSERT/UPDATE/DELETE on comments via PostgREST is refused.
DROP POLICY IF EXISTS comments_no_direct_writes ON public.comments;
CREATE POLICY comments_no_direct_writes ON public.comments
  AS RESTRICTIVE
  FOR ALL
  USING (false)
  WITH CHECK (false);
```

> **Note:** `RESTRICTIVE` means the policy is AND-combined with permissive policies. Combined with the existing `comments_read` SELECT policy (permissive), reads still work; writes are uniformly refused. Service-role connections (the ones our Server Actions use via Prisma) bypass RLS entirely, so this does not affect application behaviour.

- [ ] **Step 3: Apply the migration to the local Supabase / dev DB**

> **NB:** Production migrations go through CI; locally Prisma needs to apply the new migration so subsequent steps run against a DB that has the `email` enum value. If `DATABASE_URL` is configured in `.env.local`, run:

```bash
pnpm --filter @nexushub/db exec prisma migrate deploy
```

Expected: "1 migration found" → "Applied successfully".

If no local DB is configured, document this in the commit message and continue — CI will apply the migration when the branch deploys to staging.

- [ ] **Step 4: Regenerate Prisma client**

Run:

```bash
pnpm --filter @nexushub/db exec prisma generate
```

Expected: "Generated Prisma Client".

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260519160001_comments_channel_email_and_rls
git commit -m "feat(db): add 'email' to NotificationChannel + lock down comments RLS writes"
```

---

## Task 5: Zod schemas + shared DTO

**Files:**

- Create: `apps/web/features/projects/lib/comment-schemas.ts`
- Create: `apps/web/features/projects/lib/comment-dto.ts`

- [ ] **Step 1: Write `comment-schemas.ts`**

Create `apps/web/features/projects/lib/comment-schemas.ts`:

```ts
/**
 * Zod schemas shared by the three comment Server Actions. Body limits
 * come from the spec: 1 to 10_000 chars trimmed, no all-whitespace.
 */
import { z } from 'zod';

export const COMMENT_BODY_MAX = 10_000;

const bodySchema = z
  .string()
  .trim()
  .min(1, 'Le commentaire ne peut pas être vide.')
  .max(COMMENT_BODY_MAX, `Maximum ${COMMENT_BODY_MAX} caractères.`);

export const CreateCommentSchema = z.object({
  cardId: z.string().uuid(),
  body: bodySchema,
});

export const UpdateCommentSchema = z.object({
  commentId: z.string().uuid(),
  body: bodySchema,
});

export const DeleteCommentSchema = z.object({
  commentId: z.string().uuid(),
});
```

- [ ] **Step 2: Write `comment-dto.ts`**

Create `apps/web/features/projects/lib/comment-dto.ts`:

```ts
/**
 * DTO shared between server (load-card-comments, get-card-modal-data) and
 * client (card-comments-thread). The `bodyHtml` field is rendered server-
 * side via `@nexushub/integrations/markdown` so the client only needs to
 * dump it into `dangerouslySetInnerHTML` — already sanitised.
 */
export interface CardCommentDTO {
  readonly id: string;
  readonly body: string;
  readonly bodyHtml: string;
  readonly createdAt: string; // ISO
  readonly updatedAt: string; // ISO
  readonly isEdited: boolean;
  readonly author: {
    readonly id: string;
    readonly displayName: string;
    readonly initials: string;
  };
  /** True when the current viewer authored this comment (can edit/delete). */
  readonly isMine: boolean;
  /** True when the current viewer is Admin (can delete any comment). */
  readonly canModerate: boolean;
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/features/projects/lib/comment-schemas.ts apps/web/features/projects/lib/comment-dto.ts
git commit -m "feat(web): shared schemas + DTO for card comments"
```

---

## Task 6: Server helper — `load-card-comments`

**Files:**

- Create: `apps/web/features/projects/lib/load-card-comments.ts`

- [ ] **Step 1: Write the helper**

Create `apps/web/features/projects/lib/load-card-comments.ts`:

```ts
/**
 * Single Prisma round-trip + HTML render for the comments thread of a
 * card. Returns DTOs ready for the client.
 *
 * SECURITY:
 *  - Caller has already verified the card is in scope. This helper does
 *    not re-check scope (would duplicate the parent's effort).
 *  - HTML is sanitised here so the client never sees raw markdown.
 */
import 'server-only';
import { prisma } from '@nexushub/db';
import { markdown } from '@nexushub/integrations';
import { Roles, type Role } from '@nexushub/domain';
import type { CardCommentDTO } from './comment-dto';

interface LoadCardCommentsInput {
  readonly cardId: string;
  readonly currentUserId: string;
  readonly currentRole: Role;
}

const EDIT_THRESHOLD_MS = 1000;

function displayName(user: {
  firstName: string | null;
  lastName: string | null;
  email: string;
}): string {
  const full = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();
  return full.length > 0 ? full : user.email;
}

function initials(user: {
  firstName: string | null;
  lastName: string | null;
  email: string;
}): string {
  const first = user.firstName?.[0] ?? '';
  const last = user.lastName?.[0] ?? '';
  const combined = `${first}${last}`.trim().toUpperCase();
  return combined.length > 0 ? combined : (user.email[0] ?? '?').toUpperCase();
}

export async function loadCardComments(
  input: LoadCardCommentsInput,
): Promise<readonly CardCommentDTO[]> {
  const rows = await prisma.comment.findMany({
    where: { cardId: input.cardId, deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      body: true,
      createdAt: true,
      updatedAt: true,
      author: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  });

  const canModerate = input.currentRole === Roles.Admin;

  return rows.map((row): CardCommentDTO => {
    const isEdited = row.updatedAt.getTime() - row.createdAt.getTime() > EDIT_THRESHOLD_MS;
    return {
      id: row.id,
      body: row.body,
      bodyHtml: markdown.renderMarkdownToSafeHtml(row.body),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      isEdited,
      author: {
        id: row.author.id,
        displayName: displayName(row.author),
        initials: initials(row.author),
      },
      isMine: row.author.id === input.currentUserId,
      canModerate,
    };
  });
}
```

- [ ] **Step 2: Typecheck the web app**

Run:

```bash
pnpm --filter @nexushub/web typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/features/projects/lib/load-card-comments.ts
git commit -m "feat(web): load-card-comments helper (Prisma + safe markdown render)"
```

---

## Task 7: Email template — `comment-notification`

**Files:**

- Create: `apps/web/features/notifications/email/comment-notification.ts`
- Create: `apps/web/features/notifications/email/comment-notification.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/features/notifications/email/comment-notification.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { renderCommentNotificationEmail } from './comment-notification';

describe('renderCommentNotificationEmail', () => {
  const base = {
    recipientFirstName: 'Alice',
    authorDisplayName: 'Bob Martin',
    cardShortRef: 42,
    cardTitle: 'Refonte homepage',
    projectName: 'Site corporate',
    clientName: 'Acme Corp',
    commentBodyPreview: 'Bonjour, voici mes remarques.',
    commentUrl: 'https://nexushub.app/projects/p1?card=c1',
  };

  it('subject mentions the author + card title', () => {
    const { subject } = renderCommentNotificationEmail(base);
    expect(subject).toContain('Bob Martin');
    expect(subject).toContain('Refonte homepage');
  });

  it('text body greets the recipient', () => {
    const { text } = renderCommentNotificationEmail(base);
    expect(text).toContain('Salut Alice');
    expect(text).toContain('Bob Martin');
    expect(text).toContain('#42');
    expect(text).toContain('Refonte homepage');
    expect(text).toContain('Site corporate');
    expect(text).toContain('Acme Corp');
    expect(text).toContain('Bonjour, voici mes remarques.');
    expect(text).toContain('https://nexushub.app/projects/p1?card=c1');
  });

  it('html escapes < and > in dynamic strings', () => {
    const { htmlSanitized } = renderCommentNotificationEmail({
      ...base,
      authorDisplayName: 'Bob <script>',
      cardTitle: 'Refonte <img>',
    });
    expect(htmlSanitized).not.toContain('<script>');
    expect(htmlSanitized).not.toMatch(/<img\b/);
    expect(htmlSanitized).toContain('&lt;script&gt;');
    expect(htmlSanitized).toContain('&lt;img&gt;');
  });

  it('html includes the CTA url verbatim', () => {
    const { htmlSanitized } = renderCommentNotificationEmail(base);
    expect(htmlSanitized).toContain('https://nexushub.app/projects/p1?card=c1');
  });

  it('html includes the assignee-footer disclaimer', () => {
    const { htmlSanitized } = renderCommentNotificationEmail(base);
    expect(htmlSanitized).toContain('assigné à cette carte');
  });
});
```

- [ ] **Step 2: Run the test, confirm it fails**

Run:

```bash
pnpm --filter @nexushub/web test -- comment-notification
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `apps/web/features/notifications/email/comment-notification.ts`:

```ts
/**
 * Card-comment email notification.
 *
 * Visual language mirrors the invitation email (table-based layout,
 * inline styles, brand gradient) so users get a consistent NexusHub
 * inbox treatment.
 *
 * SECURITY: every dynamic value passes through `escapeHtml` before
 * being embedded. The comment preview is *plain text* (not markdown
 * HTML) — clients render HTML in unpredictable ways and stripping
 * markdown keeps the email predictable and safer.
 */
import 'server-only';

interface CommentEmailParams {
  readonly recipientFirstName: string;
  readonly authorDisplayName: string;
  readonly cardShortRef: number;
  readonly cardTitle: string;
  readonly projectName: string;
  readonly clientName: string;
  /** Already plain-text, already truncated to ~200 chars. */
  readonly commentBodyPreview: string;
  readonly commentUrl: string;
}

export interface CommentEmail {
  readonly subject: string;
  readonly text: string;
  readonly htmlSanitized: string;
}

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const BRAND_GRADIENT = 'linear-gradient(135deg, #8B2BE2 0%, #FF2A6D 100%)';
const TEXT_MAIN = '#111827';
const TEXT_MUTED = '#6B7280';
const TEXT_GHOST = '#9CA3AF';
const BG_CANVAS = '#F4F6F9';
const BG_CARD = '#FFFFFF';
const BORDER_LIGHT = '#E5E7EB';
const FONT_STACK =
  '"Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export function renderCommentNotificationEmail(params: CommentEmailParams): CommentEmail {
  const {
    recipientFirstName,
    authorDisplayName,
    cardShortRef,
    cardTitle,
    projectName,
    clientName,
    commentBodyPreview,
    commentUrl,
  } = params;

  const subject = `[NexusHub] ${authorDisplayName} a commenté « ${cardTitle} »`;

  const text = [
    `Salut ${recipientFirstName},`,
    ``,
    `${authorDisplayName} vient de commenter la carte #${cardShortRef} · ${cardTitle} dans le projet ${projectName} (${clientName}).`,
    ``,
    `> ${commentBodyPreview}`,
    ``,
    `Voir le commentaire :`,
    commentUrl,
    ``,
    `Tu reçois cet email parce que tu es assigné à cette carte.`,
    `— L'équipe NexusHub`,
  ].join('\n');

  const recipientE = escapeHtml(recipientFirstName);
  const authorE = escapeHtml(authorDisplayName);
  const cardTitleE = escapeHtml(cardTitle);
  const projectE = escapeHtml(projectName);
  const clientE = escapeHtml(clientName);
  const previewE = escapeHtml(commentBodyPreview);
  const urlE = escapeHtml(commentUrl);
  const subjectE = escapeHtml(subject);

  const htmlSanitized = `<!doctype html>
<html lang="fr" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${subjectE}</title>
</head>
<body style="margin:0;padding:0;background:${BG_CANVAS};font-family:${FONT_STACK};">
  <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="background:${BG_CANVAS};padding:32px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" border="0" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:${BG_CARD};border:1px solid ${BORDER_LIGHT};border-radius:16px;">
          <tr>
            <td style="padding:24px 32px 0 32px;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0">
                <tr>
                  <td width="40" height="40" align="center" style="background:${BRAND_GRADIENT};border-radius:10px;color:#ffffff;font-weight:800;font-size:18px;font-family:${FONT_STACK};line-height:40px;">N</td>
                  <td style="padding-left:12px;vertical-align:middle;">
                    <div style="font-weight:800;font-size:16px;color:${TEXT_MAIN};">NexusHub</div>
                    <div style="font-size:10px;letter-spacing:1.2px;text-transform:uppercase;color:${TEXT_MUTED};font-weight:600;">Agency OS</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 32px 8px 32px;">
              <h1 style="margin:0 0 8px 0;font-family:${FONT_STACK};font-weight:800;font-size:22px;line-height:1.25;color:${TEXT_MAIN};">
                Salut ${recipientE},
              </h1>
              <p style="margin:0;font-family:${FONT_STACK};font-size:14px;line-height:1.6;color:${TEXT_MUTED};">
                <strong style="color:${TEXT_MAIN};font-weight:700;">${authorE}</strong> vient de commenter la carte
                <strong style="color:${TEXT_MAIN};font-weight:700;">#${cardShortRef} · ${cardTitleE}</strong>
                dans le projet <strong style="color:${TEXT_MAIN};font-weight:700;">${projectE}</strong> (${clientE}).
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px 0 32px;">
              <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="background:#FAFBFC;border-left:3px solid #8B2BE2;border-radius:6px;">
                <tr>
                  <td style="padding:14px 18px;font-family:${FONT_STACK};font-size:14px;color:${TEXT_MAIN};line-height:1.55;white-space:pre-wrap;">${previewE}</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 32px 8px 32px;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="border-radius:999px;background:${BRAND_GRADIENT};box-shadow:0 8px 24px rgba(139,43,226,0.32);">
                    <a href="${urlE}" style="display:inline-block;padding:12px 28px;font-family:${FONT_STACK};font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:999px;">Voir le commentaire →</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 32px 28px 32px;">
              <hr style="border:0;border-top:1px solid ${BORDER_LIGHT};margin:0 0 16px 0;">
              <p style="margin:0;font-family:${FONT_STACK};font-size:11px;line-height:1.6;color:${TEXT_GHOST};">
                Tu reçois cet email parce que tu es assigné à cette carte.<br>
                — L'équipe NexusHub
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, text, htmlSanitized };
}
```

- [ ] **Step 4: Run the test, expect green**

Run:

```bash
pnpm --filter @nexushub/web test -- comment-notification
```

Expected: PASS — 5/5 cases.

- [ ] **Step 5: Commit**

```bash
git add apps/web/features/notifications/email/comment-notification.ts apps/web/features/notifications/email/comment-notification.test.ts
git commit -m "feat(comm): card-comment email notification template"
```

---

## Task 8: `createComment` server action — TDD

**Files:**

- Create: `apps/web/features/projects/actions/create-comment.test.ts`
- Create: `apps/web/features/projects/actions/create-comment.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/features/projects/actions/create-comment.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  cardFindFirst: vi.fn(),
  commentCreate: vi.fn(),
  notificationCreate: vi.fn(),
  notificationUpdate: vi.fn(),
  userFindUnique: vi.fn(),
  loadUserScope: vi.fn(),
  emailSend: vi.fn(),
  revalidatePath: vi.fn(),
  assertCsrf: vi.fn(),
}));

vi.mock('@nexushub/db', () => ({
  prisma: {
    card: { findFirst: mocks.cardFindFirst },
    comment: { create: mocks.commentCreate },
    notification: { create: mocks.notificationCreate, update: mocks.notificationUpdate },
    user: { findUnique: mocks.userFindUnique },
  },
}));
vi.mock('@/lib/auth', () => ({ requireUser: mocks.requireUser }));
vi.mock('@/lib/auth/scope', () => ({ loadUserScope: mocks.loadUserScope }));
vi.mock('@/lib/csrf', () => ({ assertCsrfFromFormData: mocks.assertCsrf }));
vi.mock('@/lib/email', () => ({ getEmail: () => ({ send: mocks.emailSend }) }));
vi.mock('@/lib/env', () => ({
  getPublicEnv: () => ({ NEXT_PUBLIC_APP_URL: 'https://nexushub.test' }),
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));

import { createComment } from './create-comment';

const CARD = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const PROJECT = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const WS = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const AUTHOR = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const ASSIGNEE_A = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const ASSIGNEE_B = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

function ctx(role: 'admin' | 'user' | 'viewer', userId = AUTHOR) {
  return {
    userId,
    workspaceId: WS,
    role,
    isSuperAdmin: false,
    email: `${role}@test`,
  };
}

beforeEach(() => {
  for (const m of Object.values(mocks)) (m as { mockReset?: () => void }).mockReset?.();
  mocks.requireUser.mockResolvedValue(ctx('user'));
  mocks.loadUserScope.mockResolvedValue({ kind: 'workspace' });
  mocks.assertCsrf.mockResolvedValue(undefined);
  mocks.cardFindFirst.mockResolvedValue({
    id: CARD,
    projectId: PROJECT,
    workspaceId: WS,
    shortRef: 42,
    title: 'Carte de test',
    project: { name: 'Projet X', clientId: 'client-1', client: { name: 'Acme' } },
    assignees: [
      { userId: ASSIGNEE_A, user: { firstName: 'A', lastName: 'A', email: 'a@test' } },
      { userId: AUTHOR, user: { firstName: 'Author', lastName: 'A', email: 'author@test' } },
      { userId: ASSIGNEE_B, user: { firstName: 'B', lastName: 'B', email: 'b@test' } },
    ],
  });
  mocks.userFindUnique.mockResolvedValue({
    firstName: 'Author',
    lastName: 'A',
    email: 'author@test',
  });
  mocks.commentCreate.mockResolvedValue({ id: 'new-comment-id' });
  mocks.notificationCreate.mockResolvedValue({ id: 'notif-id' });
  mocks.emailSend.mockResolvedValue({ id: 'msg-id', delivered: true });
});

function fd(body = 'hello world', cardId = CARD): FormData {
  const f = new FormData();
  f.set('cardId', cardId);
  f.set('body', body);
  f.set('csrf', 'token'); // ignored — mocked
  return f;
}

describe('createComment', () => {
  it('creates the comment and returns ok', async () => {
    const res = await createComment({ status: 'idle' }, fd());
    expect(res.status).toBe('success');
    expect(mocks.commentCreate).toHaveBeenCalledOnce();
    const args = mocks.commentCreate.mock.calls[0]![0];
    expect(args.data.body).toBe('hello world');
    expect(args.data.cardId).toBe(CARD);
    expect(args.data.authorId).toBe(AUTHOR);
  });

  it('accepts Viewer role', async () => {
    mocks.requireUser.mockResolvedValueOnce(ctx('viewer', AUTHOR));
    const res = await createComment({ status: 'idle' }, fd());
    expect(res.status).toBe('success');
  });

  it('refuses empty body', async () => {
    const res = await createComment({ status: 'idle' }, fd('   '));
    expect(res.status).toBe('error');
    expect(mocks.commentCreate).not.toHaveBeenCalled();
  });

  it('refuses body over 10000 chars', async () => {
    const res = await createComment({ status: 'idle' }, fd('x'.repeat(10001)));
    expect(res.status).toBe('error');
    expect(mocks.commentCreate).not.toHaveBeenCalled();
  });

  it('refuses if card not found in workspace', async () => {
    mocks.cardFindFirst.mockResolvedValueOnce(null);
    await expect(createComment({ status: 'idle' }, fd())).rejects.toThrow();
    expect(mocks.commentCreate).not.toHaveBeenCalled();
  });

  it('refuses when card is out of scope (restricted)', async () => {
    mocks.loadUserScope.mockResolvedValueOnce({
      kind: 'restricted',
      clientIds: [],
      projectIds: ['other-project'],
    });
    const res = await createComment({ status: 'idle' }, fd());
    expect(res.status).toBe('error');
    expect(mocks.commentCreate).not.toHaveBeenCalled();
  });

  it('sends an email to each assignee except the author', async () => {
    await createComment({ status: 'idle' }, fd('hi'));
    expect(mocks.emailSend).toHaveBeenCalledTimes(2);
    const recipients = mocks.emailSend.mock.calls.map((c) => (c[0] as { to: string }).to);
    expect(recipients).toContain('a@test');
    expect(recipients).toContain('b@test');
    expect(recipients).not.toContain('author@test');
  });

  it('persists a Notification row per recipient (sentAt set on success)', async () => {
    await createComment({ status: 'idle' }, fd('hi'));
    expect(mocks.notificationCreate).toHaveBeenCalledTimes(2);
    expect(mocks.notificationUpdate).toHaveBeenCalledTimes(2);
    const updateCalls = mocks.notificationUpdate.mock.calls;
    for (const call of updateCalls) {
      const args = call[0] as { data: { sentAt: Date } };
      expect(args.data.sentAt).toBeInstanceOf(Date);
    }
  });

  it('does not block when one email recipient fails (Promise.allSettled)', async () => {
    mocks.emailSend
      .mockRejectedValueOnce(new Error('Resend 500'))
      .mockResolvedValueOnce({ id: 'ok', delivered: true });
    const res = await createComment({ status: 'idle' }, fd('hi'));
    expect(res.status).toBe('success');
    // Only the successful one gets sentAt updated.
    expect(mocks.notificationUpdate).toHaveBeenCalledTimes(1);
  });

  it('does not send email when card has no other assignees', async () => {
    mocks.cardFindFirst.mockResolvedValueOnce({
      id: CARD,
      projectId: PROJECT,
      workspaceId: WS,
      shortRef: 42,
      title: 'solo',
      project: { name: 'P', client: { name: 'C' } },
      assignees: [
        { userId: AUTHOR, user: { firstName: 'A', lastName: 'A', email: 'author@test' } },
      ],
    });
    const res = await createComment({ status: 'idle' }, fd('hi'));
    expect(res.status).toBe('success');
    expect(mocks.emailSend).not.toHaveBeenCalled();
    expect(mocks.notificationCreate).not.toHaveBeenCalled();
  });

  it('revalidates the project path', async () => {
    await createComment({ status: 'idle' }, fd('hi'));
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/projects/${PROJECT}`);
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/projects/${PROJECT}/list`);
  });
});
```

- [ ] **Step 2: Run the test, confirm it fails**

Run:

```bash
pnpm --filter @nexushub/web test -- create-comment
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `apps/web/features/projects/actions/create-comment.ts`:

```ts
'use server';
import 'server-only';
import { revalidatePath } from 'next/cache';
import { prisma, type Prisma } from '@nexushub/db';
import { NotFoundError } from '@nexushub/domain';
import { markdown } from '@nexushub/integrations';
import { requireUser } from '@/lib/auth';
import { loadUserScope } from '@/lib/auth/scope';
import { assertCsrfFromFormData } from '@/lib/csrf';
import { getEmail } from '@/lib/email';
import { getPublicEnv } from '@/lib/env';
import { SCOPE_ERROR_MESSAGE } from '../lib/scope-error';
import { CreateCommentSchema } from '../lib/comment-schemas';
import { renderCommentNotificationEmail } from '@/features/notifications/email/comment-notification';

export type CreateCommentState =
  | { readonly status: 'idle' }
  | { readonly status: 'success'; readonly commentId: string }
  | { readonly status: 'error'; readonly message: string };

const PREVIEW_MAX = 200;

function displayName(u: {
  firstName: string | null;
  lastName: string | null;
  email: string;
}): string {
  const full = `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim();
  return full.length > 0 ? full : u.email;
}

export async function createComment(
  _prev: CreateCommentState,
  formData: FormData,
): Promise<CreateCommentState> {
  await assertCsrfFromFormData(formData);
  const ctx = await requireUser();

  const parsed = CreateCommentSchema.safeParse({
    cardId: formData.get('cardId'),
    body: formData.get('body'),
  });
  if (!parsed.success) {
    return {
      status: 'error',
      message: parsed.error.issues[0]?.message ?? 'Commentaire invalide.',
    };
  }
  const { cardId, body } = parsed.data;

  // Single query for everything we need downstream (scope check, email recipients).
  const card = await prisma.card.findFirst({
    where: { id: cardId, workspaceId: ctx.workspaceId, deletedAt: null },
    select: {
      id: true,
      projectId: true,
      workspaceId: true,
      shortRef: true,
      title: true,
      project: {
        select: { name: true, clientId: true, client: { select: { name: true } } },
      },
      assignees: {
        select: {
          userId: true,
          user: { select: { firstName: true, lastName: true, email: true } },
        },
      },
    },
  });
  if (!card) throw new NotFoundError('Card');

  const scope = await loadUserScope(ctx);
  if (scope.kind === 'restricted') {
    const allowed =
      scope.projectIds.includes(card.projectId) || scope.clientIds.includes(card.project.clientId);
    if (!allowed) return { status: 'error', message: SCOPE_ERROR_MESSAGE };
  }

  const author = await prisma.user.findUnique({
    where: { id: ctx.userId },
    select: { firstName: true, lastName: true, email: true },
  });

  const created = await prisma.comment.create({
    data: { cardId, authorId: ctx.userId, body },
    select: { id: true },
  });

  // ----- Fan out emails to assignees minus the author -----
  const recipients = card.assignees
    .filter((a) => a.userId !== ctx.userId)
    .map((a) => ({ userId: a.userId, user: a.user }));

  if (recipients.length > 0) {
    const env = getPublicEnv();
    const commentUrl = `${env.NEXT_PUBLIC_APP_URL}/projects/${card.projectId}?card=${card.id}`;
    const authorName = author ? displayName(author) : ctx.email;
    const preview = markdown.markdownToPlainText(body, PREVIEW_MAX);

    await Promise.allSettled(
      recipients.map(async (r) => {
        const notif = await prisma.notification.create({
          data: {
            workspaceId: ctx.workspaceId,
            userId: r.userId,
            kind: 'card_commented',
            channel: 'email',
            data: { cardId: card.id, commentId: created.id } as Prisma.InputJsonValue,
          },
          select: { id: true },
        });
        try {
          const tpl = renderCommentNotificationEmail({
            recipientFirstName: r.user.firstName ?? r.user.email.split('@')[0] ?? '',
            authorDisplayName: authorName,
            cardShortRef: card.shortRef,
            cardTitle: card.title,
            projectName: card.project.name,
            clientName: card.project.client.name,
            commentBodyPreview: preview,
            commentUrl,
          });
          await getEmail().send({
            to: r.user.email,
            subject: tpl.subject,
            text: tpl.text,
            htmlSanitized: tpl.htmlSanitized,
            tag: 'notification',
          });
          await prisma.notification.update({
            where: { id: notif.id },
            data: { sentAt: new Date() },
          });
        } catch (err) {
          console.error('[createComment] notification send failed', {
            notificationId: notif.id,
            error: err instanceof Error ? err.message : 'unknown',
          });
        }
      }),
    );
  }

  revalidatePath(`/projects/${card.projectId}`);
  revalidatePath(`/projects/${card.projectId}/list`);

  return { status: 'success', commentId: created.id };
}
```

- [ ] **Step 4: Run the test, expect green**

Run:

```bash
pnpm --filter @nexushub/web test -- create-comment
```

Expected: PASS — all 11 cases.

- [ ] **Step 5: Commit**

```bash
git add apps/web/features/projects/actions/create-comment.ts apps/web/features/projects/actions/create-comment.test.ts
git commit -m "feat(web): createComment server action with assignee email fan-out"
```

---

## Task 9: `updateComment` server action — TDD

**Files:**

- Create: `apps/web/features/projects/actions/update-comment.test.ts`
- Create: `apps/web/features/projects/actions/update-comment.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/features/projects/actions/update-comment.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  commentFindFirst: vi.fn(),
  commentUpdate: vi.fn(),
  assertCsrf: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@nexushub/db', () => ({
  prisma: {
    comment: { findFirst: mocks.commentFindFirst, update: mocks.commentUpdate },
  },
}));
vi.mock('@/lib/auth', () => ({ requireUser: mocks.requireUser }));
vi.mock('@/lib/csrf', () => ({ assertCsrfFromFormData: mocks.assertCsrf }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));

import { updateComment } from './update-comment';

const COMMENT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CARD = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const PROJECT = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const AUTHOR = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const OTHER = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

beforeEach(() => {
  for (const m of Object.values(mocks)) (m as { mockReset?: () => void }).mockReset?.();
  mocks.requireUser.mockResolvedValue({
    userId: AUTHOR,
    workspaceId: 'ws-1',
    role: 'user',
    isSuperAdmin: false,
    email: 'a@test',
  });
  mocks.assertCsrf.mockResolvedValue(undefined);
  mocks.commentFindFirst.mockResolvedValue({
    id: COMMENT,
    authorId: AUTHOR,
    cardId: CARD,
    deletedAt: null,
    card: { projectId: PROJECT, workspaceId: 'ws-1' },
  });
  mocks.commentUpdate.mockResolvedValue({ id: COMMENT });
});

function fd(body = 'updated', commentId = COMMENT): FormData {
  const f = new FormData();
  f.set('commentId', commentId);
  f.set('body', body);
  return f;
}

describe('updateComment', () => {
  it('updates the comment body when the caller is the author', async () => {
    const res = await updateComment({ status: 'idle' }, fd('new body'));
    expect(res.status).toBe('success');
    const args = mocks.commentUpdate.mock.calls[0]![0];
    expect(args.data.body).toBe('new body');
    expect(args.where.id).toBe(COMMENT);
  });

  it('refuses when the caller is NOT the author', async () => {
    mocks.requireUser.mockResolvedValueOnce({
      userId: OTHER,
      workspaceId: 'ws-1',
      role: 'user',
      isSuperAdmin: false,
      email: 'o@test',
    });
    const res = await updateComment({ status: 'idle' }, fd());
    expect(res.status).toBe('error');
    expect(mocks.commentUpdate).not.toHaveBeenCalled();
  });

  it('refuses when the comment has been soft-deleted', async () => {
    mocks.commentFindFirst.mockResolvedValueOnce({
      id: COMMENT,
      authorId: AUTHOR,
      cardId: CARD,
      deletedAt: new Date(),
      card: { projectId: PROJECT, workspaceId: 'ws-1' },
    });
    const res = await updateComment({ status: 'idle' }, fd());
    expect(res.status).toBe('error');
    expect(mocks.commentUpdate).not.toHaveBeenCalled();
  });

  it('refuses empty body', async () => {
    const res = await updateComment({ status: 'idle' }, fd('   '));
    expect(res.status).toBe('error');
    expect(mocks.commentUpdate).not.toHaveBeenCalled();
  });

  it('refuses cross-workspace tampering', async () => {
    mocks.commentFindFirst.mockResolvedValueOnce({
      id: COMMENT,
      authorId: AUTHOR,
      cardId: CARD,
      deletedAt: null,
      card: { projectId: PROJECT, workspaceId: 'other-ws' },
    });
    const res = await updateComment({ status: 'idle' }, fd());
    expect(res.status).toBe('error');
    expect(mocks.commentUpdate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test, confirm it fails**

Run:

```bash
pnpm --filter @nexushub/web test -- update-comment
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `apps/web/features/projects/actions/update-comment.ts`:

```ts
'use server';
import 'server-only';
import { revalidatePath } from 'next/cache';
import { prisma } from '@nexushub/db';
import { requireUser } from '@/lib/auth';
import { assertCsrfFromFormData } from '@/lib/csrf';
import { UpdateCommentSchema } from '../lib/comment-schemas';

export type UpdateCommentState =
  | { readonly status: 'idle' }
  | { readonly status: 'success'; readonly commentId: string }
  | { readonly status: 'error'; readonly message: string };

export async function updateComment(
  _prev: UpdateCommentState,
  formData: FormData,
): Promise<UpdateCommentState> {
  await assertCsrfFromFormData(formData);
  const ctx = await requireUser();

  const parsed = UpdateCommentSchema.safeParse({
    commentId: formData.get('commentId'),
    body: formData.get('body'),
  });
  if (!parsed.success) {
    return {
      status: 'error',
      message: parsed.error.issues[0]?.message ?? 'Commentaire invalide.',
    };
  }
  const { commentId, body } = parsed.data;

  const comment = await prisma.comment.findFirst({
    where: { id: commentId },
    select: {
      id: true,
      authorId: true,
      cardId: true,
      deletedAt: true,
      card: { select: { projectId: true, workspaceId: true } },
    },
  });
  if (!comment) {
    return { status: 'error', message: 'Commentaire introuvable.' };
  }
  if (comment.card.workspaceId !== ctx.workspaceId) {
    return { status: 'error', message: 'Commentaire introuvable.' };
  }
  if (comment.deletedAt !== null) {
    return { status: 'error', message: 'Ce commentaire a été supprimé.' };
  }
  if (comment.authorId !== ctx.userId) {
    return { status: 'error', message: 'Seul l’auteur peut modifier ce commentaire.' };
  }

  await prisma.comment.update({
    where: { id: commentId },
    data: { body },
  });

  revalidatePath(`/projects/${comment.card.projectId}`);
  revalidatePath(`/projects/${comment.card.projectId}/list`);

  return { status: 'success', commentId };
}
```

- [ ] **Step 4: Run the test, expect green**

Run:

```bash
pnpm --filter @nexushub/web test -- update-comment
```

Expected: PASS — 5/5 cases.

- [ ] **Step 5: Commit**

```bash
git add apps/web/features/projects/actions/update-comment.ts apps/web/features/projects/actions/update-comment.test.ts
git commit -m "feat(web): updateComment server action (author-only, overwrite)"
```

---

## Task 10: `deleteComment` server action — TDD

**Files:**

- Create: `apps/web/features/projects/actions/delete-comment.test.ts`
- Create: `apps/web/features/projects/actions/delete-comment.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/features/projects/actions/delete-comment.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  commentFindFirst: vi.fn(),
  commentUpdate: vi.fn(),
  assertCsrf: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@nexushub/db', () => ({
  prisma: {
    comment: { findFirst: mocks.commentFindFirst, update: mocks.commentUpdate },
  },
}));
vi.mock('@/lib/auth', () => ({ requireUser: mocks.requireUser }));
vi.mock('@/lib/csrf', () => ({ assertCsrfFromFormData: mocks.assertCsrf }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));

import { deleteComment } from './delete-comment';

const COMMENT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CARD = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const PROJECT = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const AUTHOR = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const OTHER = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const ADMIN = 'aaaaaaaa-1111-2222-3333-444444444444';

beforeEach(() => {
  for (const m of Object.values(mocks)) (m as { mockReset?: () => void }).mockReset?.();
  mocks.requireUser.mockResolvedValue({
    userId: AUTHOR,
    workspaceId: 'ws-1',
    role: 'user',
    isSuperAdmin: false,
    email: 'a@test',
  });
  mocks.assertCsrf.mockResolvedValue(undefined);
  mocks.commentFindFirst.mockResolvedValue({
    id: COMMENT,
    authorId: AUTHOR,
    cardId: CARD,
    deletedAt: null,
    card: { projectId: PROJECT, workspaceId: 'ws-1' },
  });
  mocks.commentUpdate.mockResolvedValue({ id: COMMENT });
});

function fd(commentId = COMMENT): FormData {
  const f = new FormData();
  f.set('commentId', commentId);
  return f;
}

describe('deleteComment', () => {
  it('soft-deletes when the caller is the author', async () => {
    const res = await deleteComment({ status: 'idle' }, fd());
    expect(res.status).toBe('success');
    const args = mocks.commentUpdate.mock.calls[0]![0];
    expect(args.data.deletedAt).toBeInstanceOf(Date);
  });

  it('soft-deletes when the caller is a workspace Admin', async () => {
    mocks.requireUser.mockResolvedValueOnce({
      userId: ADMIN,
      workspaceId: 'ws-1',
      role: 'admin',
      isSuperAdmin: false,
      email: 'admin@test',
    });
    const res = await deleteComment({ status: 'idle' }, fd());
    expect(res.status).toBe('success');
    expect(mocks.commentUpdate).toHaveBeenCalled();
  });

  it('refuses non-author, non-admin', async () => {
    mocks.requireUser.mockResolvedValueOnce({
      userId: OTHER,
      workspaceId: 'ws-1',
      role: 'user',
      isSuperAdmin: false,
      email: 'o@test',
    });
    const res = await deleteComment({ status: 'idle' }, fd());
    expect(res.status).toBe('error');
    expect(mocks.commentUpdate).not.toHaveBeenCalled();
  });

  it('refuses non-author Viewer', async () => {
    mocks.requireUser.mockResolvedValueOnce({
      userId: OTHER,
      workspaceId: 'ws-1',
      role: 'viewer',
      isSuperAdmin: false,
      email: 'v@test',
    });
    const res = await deleteComment({ status: 'idle' }, fd());
    expect(res.status).toBe('error');
    expect(mocks.commentUpdate).not.toHaveBeenCalled();
  });

  it('refuses cross-workspace deletion even by admin', async () => {
    mocks.requireUser.mockResolvedValueOnce({
      userId: ADMIN,
      workspaceId: 'ws-1',
      role: 'admin',
      isSuperAdmin: false,
      email: 'admin@test',
    });
    mocks.commentFindFirst.mockResolvedValueOnce({
      id: COMMENT,
      authorId: AUTHOR,
      cardId: CARD,
      deletedAt: null,
      card: { projectId: PROJECT, workspaceId: 'other-ws' },
    });
    const res = await deleteComment({ status: 'idle' }, fd());
    expect(res.status).toBe('error');
    expect(mocks.commentUpdate).not.toHaveBeenCalled();
  });

  it('is idempotent on already-deleted rows', async () => {
    mocks.commentFindFirst.mockResolvedValueOnce({
      id: COMMENT,
      authorId: AUTHOR,
      cardId: CARD,
      deletedAt: new Date(),
      card: { projectId: PROJECT, workspaceId: 'ws-1' },
    });
    const res = await deleteComment({ status: 'idle' }, fd());
    expect(res.status).toBe('success'); // already deleted = success no-op
    expect(mocks.commentUpdate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test, confirm it fails**

Run:

```bash
pnpm --filter @nexushub/web test -- delete-comment
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `apps/web/features/projects/actions/delete-comment.ts`:

```ts
'use server';
import 'server-only';
import { revalidatePath } from 'next/cache';
import { prisma } from '@nexushub/db';
import { Roles } from '@nexushub/domain';
import { requireUser } from '@/lib/auth';
import { assertCsrfFromFormData } from '@/lib/csrf';
import { DeleteCommentSchema } from '../lib/comment-schemas';

export type DeleteCommentState =
  | { readonly status: 'idle' }
  | { readonly status: 'success'; readonly commentId: string }
  | { readonly status: 'error'; readonly message: string };

export async function deleteComment(
  _prev: DeleteCommentState,
  formData: FormData,
): Promise<DeleteCommentState> {
  await assertCsrfFromFormData(formData);
  const ctx = await requireUser();

  const parsed = DeleteCommentSchema.safeParse({
    commentId: formData.get('commentId'),
  });
  if (!parsed.success) {
    return { status: 'error', message: 'Identifiant invalide.' };
  }
  const { commentId } = parsed.data;

  const comment = await prisma.comment.findFirst({
    where: { id: commentId },
    select: {
      id: true,
      authorId: true,
      cardId: true,
      deletedAt: true,
      card: { select: { projectId: true, workspaceId: true } },
    },
  });
  if (!comment) {
    return { status: 'error', message: 'Commentaire introuvable.' };
  }
  if (comment.card.workspaceId !== ctx.workspaceId) {
    return { status: 'error', message: 'Commentaire introuvable.' };
  }

  // Idempotent: already deleted is a no-op success.
  if (comment.deletedAt !== null) {
    return { status: 'success', commentId };
  }

  const isAuthor = comment.authorId === ctx.userId;
  const isAdmin = ctx.role === Roles.Admin;
  if (!isAuthor && !isAdmin) {
    return {
      status: 'error',
      message: 'Seul l’auteur ou un Admin peut supprimer ce commentaire.',
    };
  }

  await prisma.comment.update({
    where: { id: commentId },
    data: { deletedAt: new Date() },
  });

  revalidatePath(`/projects/${comment.card.projectId}`);
  revalidatePath(`/projects/${comment.card.projectId}/list`);

  return { status: 'success', commentId };
}
```

- [ ] **Step 4: Run the test, expect green**

Run:

```bash
pnpm --filter @nexushub/web test -- delete-comment
```

Expected: PASS — 6/6 cases.

- [ ] **Step 5: Commit**

```bash
git add apps/web/features/projects/actions/delete-comment.ts apps/web/features/projects/actions/delete-comment.test.ts
git commit -m "feat(web): deleteComment server action (author or Admin, soft delete)"
```

---

## Task 11: `CardCommentForm` client component

**Files:**

- Create: `apps/web/features/projects/components/card-comment-form.tsx`

- [ ] **Step 1: Write the component**

Create `apps/web/features/projects/components/card-comment-form.tsx`:

```tsx
'use client';
import { useActionState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createComment, type CreateCommentState } from '../actions/create-comment';
import { CSRF_FIELD_NAME } from '@/lib/csrf/field';

export interface CardCommentFormProps {
  readonly cardId: string;
  readonly csrfToken: string;
  /** When true (Viewer out-of-scope, or rare locked card), the form is hidden. */
  readonly disabled?: boolean;
}

const INITIAL: CreateCommentState = { status: 'idle' };

export function CardCommentForm({ cardId, csrfToken, disabled }: CardCommentFormProps) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(createComment, INITIAL);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    if (state.status === 'success' && textareaRef.current) {
      textareaRef.current.value = '';
      router.refresh();
    }
  }, [state, router]);

  if (disabled) return null;

  // Cmd/Ctrl+Enter to submit. We hand off to the form's native submit so
  // useActionState wires through the same flow as a click.
  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      formRef.current?.requestSubmit();
    }
  };

  return (
    <form ref={formRef} action={formAction} className="nx-comment-form">
      <input type="hidden" name={CSRF_FIELD_NAME} value={csrfToken} />
      <input type="hidden" name="cardId" value={cardId} />
      <textarea
        ref={textareaRef}
        name="body"
        placeholder="Écris un commentaire… (markdown supporté · Cmd/Ctrl+Enter pour envoyer)"
        rows={3}
        maxLength={10_000}
        onKeyDown={handleKey}
        aria-label="Nouveau commentaire"
        className="nx-comment-form__textarea"
        disabled={pending}
      />
      <div className="nx-comment-form__footer">
        {state.status === 'error' ? (
          <p className="nx-comment-form__error" role="alert">
            {state.message}
          </p>
        ) : (
          <span className="nx-comment-form__hint">
            Markdown : **gras** · *italique* · `code` · [lien](https://…)
          </span>
        )}
        <button type="submit" className="nx-btn nx-btn--primary" disabled={pending}>
          {pending ? 'Envoi…' : 'Envoyer'}
        </button>
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Typecheck**

Run:

```bash
pnpm --filter @nexushub/web typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/features/projects/components/card-comment-form.tsx
git commit -m "feat(web): CardCommentForm (markdown textarea + Cmd/Ctrl+Enter)"
```

---

## Task 12: `CardCommentItem` client component

**Files:**

- Create: `apps/web/features/projects/components/card-comment-item.tsx`

- [ ] **Step 1: Write the component**

Create `apps/web/features/projects/components/card-comment-item.tsx`:

```tsx
'use client';
import { useActionState, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { updateComment, type UpdateCommentState } from '../actions/update-comment';
import { deleteComment, type DeleteCommentState } from '../actions/delete-comment';
import { CSRF_FIELD_NAME } from '@/lib/csrf/field';
import type { CardCommentDTO } from '../lib/comment-dto';

const UPDATE_INITIAL: UpdateCommentState = { status: 'idle' };
const DELETE_INITIAL: DeleteCommentState = { status: 'idle' };

const dateFmt = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export interface CardCommentItemProps {
  readonly comment: CardCommentDTO;
  readonly csrfToken: string;
}

export function CardCommentItem({ comment, csrfToken }: CardCommentItemProps) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [updateState, updateAction, updatePending] = useActionState(updateComment, UPDATE_INITIAL);
  const [deleteState, deleteAction, deletePending] = useActionState(deleteComment, DELETE_INITIAL);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (updateState.status === 'success') {
      setIsEditing(false);
      router.refresh();
    }
  }, [updateState, router]);

  useEffect(() => {
    if (deleteState.status === 'success') {
      router.refresh();
    }
  }, [deleteState, router]);

  const canEdit = comment.isMine;
  const canDelete = comment.isMine || comment.canModerate;

  return (
    <article className="nx-comment" aria-label={`Commentaire de ${comment.author.displayName}`}>
      <div className="nx-comment__avatar" aria-hidden="true">
        {comment.author.initials}
      </div>
      <div className="nx-comment__body">
        <header className="nx-comment__header">
          <strong className="nx-comment__author">{comment.author.displayName}</strong>
          <time className="nx-comment__date" dateTime={comment.createdAt}>
            {dateFmt.format(new Date(comment.createdAt))}
          </time>
          {comment.isEdited ? <span className="nx-comment__edited">(modifié)</span> : null}
        </header>

        {isEditing ? (
          <form action={updateAction} className="nx-comment__edit-form">
            <input type="hidden" name={CSRF_FIELD_NAME} value={csrfToken} />
            <input type="hidden" name="commentId" value={comment.id} />
            <textarea
              ref={textareaRef}
              name="body"
              defaultValue={comment.body}
              rows={3}
              maxLength={10_000}
              aria-label="Modifier le commentaire"
              className="nx-comment__textarea"
              disabled={updatePending}
            />
            <div className="nx-comment__edit-actions">
              {updateState.status === 'error' ? (
                <p role="alert" className="nx-comment__error">
                  {updateState.message}
                </p>
              ) : null}
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                className="nx-btn nx-btn--ghost"
              >
                Annuler
              </button>
              <button type="submit" disabled={updatePending} className="nx-btn nx-btn--primary">
                {updatePending ? 'Enregistre…' : 'Enregistrer'}
              </button>
            </div>
          </form>
        ) : (
          <div
            className="nx-comment__content"
            // bodyHtml is server-rendered via @nexushub/integrations/markdown
            // (marked → DOMPurify whitelist). Safe to inject.
            dangerouslySetInnerHTML={{ __html: comment.bodyHtml }}
          />
        )}

        {(canEdit || canDelete) && !isEditing ? (
          <div className="nx-comment__actions">
            {canEdit ? (
              <button
                type="button"
                onClick={() => setIsEditing(true)}
                className="nx-btn nx-btn--link"
              >
                Modifier
              </button>
            ) : null}
            {canDelete ? (
              <form action={deleteAction} className="nx-comment__delete-form">
                <input type="hidden" name={CSRF_FIELD_NAME} value={csrfToken} />
                <input type="hidden" name="commentId" value={comment.id} />
                <button
                  type="submit"
                  disabled={deletePending}
                  className="nx-btn nx-btn--link nx-btn--danger"
                  onClick={(e) => {
                    if (!window.confirm('Supprimer ce commentaire ?')) {
                      e.preventDefault();
                    }
                  }}
                >
                  {deletePending ? 'Suppression…' : 'Supprimer'}
                </button>
              </form>
            ) : null}
          </div>
        ) : null}
        {deleteState.status === 'error' ? (
          <p role="alert" className="nx-comment__error">
            {deleteState.message}
          </p>
        ) : null}
      </div>
    </article>
  );
}
```

- [ ] **Step 2: Typecheck**

Run:

```bash
pnpm --filter @nexushub/web typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/features/projects/components/card-comment-item.tsx
git commit -m "feat(web): CardCommentItem (inline edit, author/admin delete)"
```

---

## Task 13: `CardCommentsThread` client component

**Files:**

- Create: `apps/web/features/projects/components/card-comments-thread.tsx`

- [ ] **Step 1: Write the component**

Create `apps/web/features/projects/components/card-comments-thread.tsx`:

```tsx
'use client';
import { CardCommentItem } from './card-comment-item';
import { CardCommentForm } from './card-comment-form';
import type { CardCommentDTO } from '../lib/comment-dto';

export interface CardCommentsThreadProps {
  readonly cardId: string;
  readonly csrfToken: string;
  readonly comments: readonly CardCommentDTO[];
  /** Hide the "post a comment" form when the modal is in read-only mode. */
  readonly canPost?: boolean;
}

export function CardCommentsThread({
  cardId,
  csrfToken,
  comments,
  canPost = true,
}: CardCommentsThreadProps) {
  return (
    <section className="nx-comments" aria-labelledby="nx-comments-title">
      <h3 id="nx-comments-title" className="nx-comments__title">
        Commentaires ({comments.length})
      </h3>
      {comments.length === 0 ? (
        <p className="nx-comments__empty">Aucun commentaire pour l'instant.</p>
      ) : (
        <ol className="nx-comments__list">
          {comments.map((c) => (
            <li key={c.id}>
              <CardCommentItem comment={c} csrfToken={csrfToken} />
            </li>
          ))}
        </ol>
      )}
      <CardCommentForm cardId={cardId} csrfToken={csrfToken} disabled={!canPost} />
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/features/projects/components/card-comments-thread.tsx
git commit -m "feat(web): CardCommentsThread (list + form composition)"
```

---

## Task 14: Wire comments into `getCardModalData` action

**Files:**

- Modify: `apps/web/features/projects/actions/get-card-modal-data.ts`

- [ ] **Step 1: Add the import**

At the top of `apps/web/features/projects/actions/get-card-modal-data.ts`, add (alphabetically inside the existing import block):

```ts
import type { CardCommentDTO } from '../lib/comment-dto';
import { loadCardComments } from '../lib/load-card-comments';
```

- [ ] **Step 2: Extend `CardModalData`**

In the `CardModalData` interface, append after the existing `templateItems` field:

```ts
  readonly comments: readonly CardCommentDTO[];
```

- [ ] **Step 3: Load comments after the existing card query**

In the function body, after the existing `const card = await prisma.card.findFirst({...})` block and the existing scope check (everything that produces the data the action already returns), add:

```ts
const comments = await loadCardComments({
  cardId: card.id,
  currentUserId: ctx.userId,
  currentRole: ctx.role,
});
```

And in the `return { ok: true, data: {...} }` block at the bottom, add `comments,` to the data object.

- [ ] **Step 4: Typecheck**

Run:

```bash
pnpm --filter @nexushub/web typecheck
```

Expected: PASS — including the call sites in `card-modal-controller.tsx` that build a `satisfies CardModalData` skeleton (next task patches them).

- [ ] **Step 5: Commit**

```bash
git add apps/web/features/projects/actions/get-card-modal-data.ts
git commit -m "feat(web): include comments DTO in getCardModalData payload"
```

---

## Task 15: Wire comments into the Kanban page + controller skeleton

**Files:**

- Modify: `apps/web/app/(app)/projects/[id]/page.tsx`
- Modify: `apps/web/features/projects/components/card-modal-controller.tsx`

Comments now ride inside `CardModalData` (Task 14), so no new props on the controller are needed — the data flows through both `initialCard` and the on-click `getCardModalData` path automatically. Two small edits:

- [ ] **Step 1: Populate `initialCard.comments` in the page's RSC payload**

In `apps/web/app/(app)/projects/[id]/page.tsx`, locate the block that maps `openCard` into the `initialCard` object that gets passed to `<CardModalController>` (look for `id: openCard.id, title: openCard.title, …`). Two changes:

(a) After the existing `openCard` fetch, add a parallel comments load. Place it inside the `if (openCard) { … }` branch:

```ts
import { loadCardComments } from '@/features/projects/lib/load-card-comments';
// …inside the openCard branch, after computing nextColumnName, etc.:
const initialCardComments = openCard
  ? await loadCardComments({
      cardId: openCard.id,
      currentUserId: ctx.userId,
      currentRole: ctx.role,
    })
  : [];
```

(b) In the `initialCard` object literal (the one matching `satisfies CardModalData` or `<CardModalController initialCard={{ ... }} />`), append:

```ts
comments: initialCardComments,
```

- [ ] **Step 2: Add `comments: []` to the loading-skeleton CardModalData in the controller**

In `apps/web/features/projects/components/card-modal-controller.tsx`, locate the `cardForModal = state.data ?? ({ … } satisfies CardModalData)` block (around line ~245). The skeleton object must satisfy the updated `CardModalData` shape, so add inside the literal (after `fieldValues: {},`):

```ts
comments: [],
```

That keeps the modal happy during the brief load between click and `getCardModalData` resolving.

- [ ] **Step 3: Typecheck**

Run:

```bash
pnpm --filter @nexushub/web typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/\(app\)/projects/\[id\]/page.tsx apps/web/features/projects/components/card-modal-controller.tsx
git commit -m "feat(web): plumb comments through initialCard + loading skeleton"
```

---

## Task 16: Wire comments into the list-view page

**Files:**

- Modify: `apps/web/app/(app)/projects/[id]/list/page.tsx`

- [ ] **Step 1: Add the loader import + the fetch**

In `apps/web/app/(app)/projects/[id]/list/page.tsx`, add the import alongside the existing ones:

```ts
import { loadCardComments } from '@/features/projects/lib/load-card-comments';
```

Then locate the `openCard` resolution block (mirrors the Kanban page from Task 15). Inside it, add:

```ts
const initialCardComments = openCard
  ? await loadCardComments({
      cardId: openCard.id,
      currentUserId: ctx.userId,
      currentRole: ctx.role,
    })
  : [];
```

- [ ] **Step 2: Add `comments: initialCardComments` to the `initialCard` object literal**

In the same file, find the `initialCard={{ … }}` (or equivalent assignment passed to `<CardModalController>`) and append the new field:

```ts
comments: initialCardComments,
```

- [ ] **Step 3: Typecheck**

Run:

```bash
pnpm --filter @nexushub/web typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/\(app\)/projects/\[id\]/list/page.tsx
git commit -m "feat(web): plumb comments through list-view's initialCard"
```

---

## Task 17: Render `<CardCommentsThread>` inside `CardModal`

**Files:**

- Modify: `apps/web/features/projects/components/card-modal.tsx`

The `card` prop on `CardModal` is a structural type local to that file (it doesn't currently `import CardModalData`). We extend that inline `card` shape with the `comments` field so the prop chain stays statically typed without requiring importers to import a new type.

- [ ] **Step 1: Import the thread + DTO**

At the top of `apps/web/features/projects/components/card-modal.tsx`, add:

```ts
import { CardCommentsThread } from './card-comments-thread';
import type { CardCommentDTO } from '../lib/comment-dto';
```

- [ ] **Step 2: Extend the `card` shape in `CardModalProps`**

In the `card: { … }` field of `CardModalProps`, append after the existing `fieldValues: Record<string, string>;` line:

```ts
    readonly comments: readonly CardCommentDTO[];
```

- [ ] **Step 3: Render the thread**

Inside the main scrollable column of the modal — after the existing checklist section and before the closing `</div>` of that column — insert:

```tsx
<CardCommentsThread
  cardId={card.id}
  csrfToken={csrfToken}
  comments={card.comments}
  canPost={!isReadOnly}
/>
```

> Locate the right slot by searching for the checklist render (probably a JSX block containing `card.checklist.map` or the `<ChecklistList>` component). Insert directly below it.

> **Behaviour note:** `isReadOnly` is set only for the explicit Viewer-out-of-scope or super-admin-snoop flows; in-scope Viewers receive `isReadOnly={false}` so they can post comments (matches the spec headline "all users including Viewer").

- [ ] **Step 4: Typecheck**

Run:

```bash
pnpm --filter @nexushub/web typecheck
```

Expected: PASS. (If a callsite of `<CardModal card={…}/>` complains about a missing `comments`, that means a `card` object literal somewhere needs `comments: []` — the controller skeleton (Task 15 step 2) and the `getCardModalData` payload (Task 14) should both already provide it; the page-rsc `initialCard` objects too (Tasks 15 step 1, 16 step 2). Fix any remaining hole by adding `comments: []` or the loaded array.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/features/projects/components/card-modal.tsx
git commit -m "feat(web): mount comments thread inside CardModal"
```

---

## Task 18: Style the comments pane

**Files:**

- Modify: the existing styles file that holds `nx-card-*` / `nx-comment-*` selectors (locate first)

- [ ] **Step 1: Locate the modal styles file**

Run:

```bash
grep -rn "nx-card-advance\|nx-card-modal\|nx-card__" apps/web --include="*.css" -l
```

Use the first match.

- [ ] **Step 2: Append a comments stylesheet block aligned with `mockups/styles.css`**

Append at the bottom of that CSS file (substitute the exact path):

```css
/* ===== Card comments ===== */
.nx-comments {
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid var(--nx-border-light, #e5e7eb);
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.nx-comments__title {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  color: var(--nx-text-muted, #6b7280);
  margin: 0;
}
.nx-comments__empty {
  font-size: 13px;
  color: var(--nx-text-muted, #6b7280);
  margin: 0;
}
.nx-comments__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.nx-comment {
  display: flex;
  gap: 12px;
}
.nx-comment__avatar {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  border-radius: 999px;
  background: linear-gradient(135deg, #8b2be2 0%, #ff2a6d 100%);
  color: #fff;
  font-weight: 700;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.nx-comment__body {
  flex: 1;
  min-width: 0;
}
.nx-comment__header {
  display: flex;
  gap: 8px;
  align-items: baseline;
  font-size: 12px;
  color: var(--nx-text-muted, #6b7280);
}
.nx-comment__author {
  color: var(--nx-text-main, #111827);
  font-weight: 700;
  font-size: 13px;
}
.nx-comment__edited {
  font-style: italic;
  font-size: 11px;
}
.nx-comment__content {
  font-size: 14px;
  line-height: 1.55;
  color: var(--nx-text-main, #111827);
  margin-top: 4px;
  word-break: break-word;
}
.nx-comment__content p {
  margin: 0 0 6px 0;
}
.nx-comment__content code {
  background: rgba(139, 43, 226, 0.08);
  padding: 1px 4px;
  border-radius: 4px;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 13px;
}
.nx-comment__content pre {
  background: #0f172a;
  color: #e2e8f0;
  padding: 10px 12px;
  border-radius: 8px;
  overflow-x: auto;
}
.nx-comment__content a {
  color: #8b2be2;
  text-decoration: underline;
}
.nx-comment__actions {
  display: flex;
  gap: 12px;
  margin-top: 6px;
}
.nx-comment__textarea,
.nx-comment-form__textarea {
  width: 100%;
  min-height: 72px;
  padding: 10px 12px;
  border: 1px solid var(--nx-border-light, #e5e7eb);
  border-radius: 8px;
  font-family: inherit;
  font-size: 14px;
  resize: vertical;
  background: #fff;
}
.nx-comment__textarea:focus,
.nx-comment-form__textarea:focus {
  outline: none;
  border-color: #8b2be2;
  box-shadow: 0 0 0 3px rgba(139, 43, 226, 0.18);
}
.nx-comment-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.nx-comment-form__footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.nx-comment-form__hint {
  font-size: 11px;
  color: var(--nx-text-ghost, #9ca3af);
}
.nx-comment-form__error,
.nx-comment__error {
  color: #b91c1c;
  font-size: 12px;
  margin: 0;
}
```

- [ ] **Step 3: Commit**

```bash
git add <the css file path used above>
git commit -m "feat(web): styles for the comments thread (matches mockups palette)"
```

---

## Task 19: Manual smoke test

**Files:** none changed.

- [ ] **Step 1: Boot the dev server**

Run from the worktree:

```bash
pnpm --filter @nexushub/web dev
```

Open `http://localhost:3000`, sign in as an Admin in a workspace that already has a project with two members assigned to a card.

- [ ] **Step 2: Verify the golden path**

1. Open any card with at least two assignees (including yourself + someone else).
2. Scroll to the new "Commentaires (0)" section.
3. Post a comment with markdown: `**hi** there [link](https://example.com)`.
4. The thread updates in place; the comment renders with `<strong>hi</strong>` + a styled link.
5. Switch to the other assignee's mailbox: a "[NexusHub] Admin Name a commenté…" email arrived (check spam if needed — see `docs/runbooks/resend-domain-setup.md`).

- [ ] **Step 3: Verify the edit/delete flow**

1. Click "Modifier" on your own comment; the textarea pre-fills with the raw markdown.
2. Save with new content; the comment shows `(modifié)`.
3. Click "Supprimer", confirm; the comment disappears.

- [ ] **Step 4: Verify Viewer can post (the headline of the feature)**

1. Log out, log back in as a Viewer who is in-scope for that card.
2. Open the same card; the "Commentaires" form is visible.
3. Post a comment; same UX as Admin.
4. Confirm Viewer cannot edit/delete somebody else's comment (no "Modifier" or "Supprimer" button on others' rows).

- [ ] **Step 5: Verify out-of-scope blocks the action**

1. Open a card the Viewer should NOT see (URL-bash with `?card=<other-card-id>`).
2. The page should `notFound()` or refuse access as it already does for other scope flows.

- [ ] **Step 6: No commit; just confirm with the user that smoke succeeded.**

---

## Task 20: Clean up the "deferred" memory note

**Files:**

- Modify: `/Users/angelogeraci/.claude/projects/-Users-angelogeraci-Documents-Application-BND-OS/memory/MEMORY.md`
- Delete: `/Users/angelogeraci/.claude/projects/-Users-angelogeraci-Documents-Application-BND-OS/memory/project_comments_deferred.md`

- [ ] **Step 1: Remove the `project_comments_deferred.md` entry from `MEMORY.md`**

In `MEMORY.md`, delete the line:

```
- [Card comments deferred](project_comments_deferred.md) — DB model exists, UI/actions/RLS not wired; planned follow-up to complete Viewer experience
```

- [ ] **Step 2: Delete the memory file**

Run:

```bash
rm "/Users/angelogeraci/.claude/projects/-Users-angelogeraci-Documents-Application-BND-OS/memory/project_comments_deferred.md"
```

> Note: This is the user's local memory store outside the repo — do not commit. The change is local only.

---

## Task 21: Final repo-wide checks before PR

**Files:** none.

- [ ] **Step 1: Full lint + typecheck + test pass**

Run:

```bash
pnpm -w lint
pnpm -w typecheck
pnpm -w test
```

Expected: all green. If lint complains about unused imports introduced by earlier tasks, clean them up and amend the corresponding commit (or stage a small follow-up commit titled `chore: tidy imports for card-comments`).

- [ ] **Step 2: Inspect the diff for any forgotten console.log / TODO**

Run:

```bash
git diff main...HEAD -- '*.ts' '*.tsx' | grep -E "^\+.*(console\.log|TODO|FIXME)" || echo "clean"
```

Expected: `clean`. The `console.error` in `create-comment.ts` is intentional (notification failure logging) and is allowed.

- [ ] **Step 3: Hand off to `superpowers:finishing-a-development-branch`**

Invoke the finishing-a-development-branch skill with `branch: feature/card-comments` to either merge locally or open a PR per user preference.

---

## Notes for the implementer

- **TDD per task** — every server action and every email/markdown helper has a failing test written _before_ the implementation. Do not deviate.
- **Use `getEmail()` from `@/lib/email`** — not Resend directly. The dev fallback (console preview) means you can iterate without a real Resend key.
- **Markdown body stays raw in DB** — we always sanitise at render. If a future XSS finding lands in DOMPurify, a single bump to the dep fixes the entire history.
- **`Promise.allSettled` for email fan-out** — one slow / failing recipient must never block the comment from being posted.
- **Don't add `card_commented` ActivityEvent** — it already exists in the schema (`ActivityKind.comment_added`) but the spec explicitly says "no audit log dedicated" for V1 because the Comment row itself is the trail. Do _not_ sprinkle in `ActivityEvent.create()` calls.
- **Existing RLS** — service-role bypasses RLS so all server actions just work. The migration tightens defensive posture by refusing direct PostgREST writes; nothing else changes.
- **Internationalisation** — strings are FR-only for V1 (matches the rest of the project). When EN lands, the templates move under `next-intl` like other UI strings.
