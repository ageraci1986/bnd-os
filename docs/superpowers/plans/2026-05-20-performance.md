# Performance Implementation Plan (project section)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the project-section actions feel instant by removing the per-action network auth call, the full-page refetch after every mutation, and the reconcile-on-every-render overhead.

**Architecture:** Verify the Supabase JWT **locally** (signature check, no network) in both `lib/auth` and the middleware, keeping the existing DB existence check and a network `getUser()` only for destructive actions. Drop `revalidatePath` / `router.refresh()` from frequent mutations, relying on the optimistic client state + the board's existing event system. Make comments optimistic and throttle `reconcileBeforeRead`.

**Tech Stack:** Next.js 15 (App Router, middleware, Server Actions) · React 19 (`useOptimistic`) · `@supabase/ssr` · `jose` (local JWT verify) · Prisma 6 · Vitest.

**Worktree:** `/Users/angelogeraci/Documents/Application/BND-OS/.worktrees/performance` · **Branch:** `performance` · **Base:** `5e29630`.

**No DB migration in this branch.**

---

## File structure (locked-in)

### Created

- `apps/web/lib/auth/verify-jwt.ts` — `verifyAccessToken(token)`: local signature verification (HS256 via secret, or ES256/RS256 via JWKS)
- `apps/web/lib/auth/verify-jwt.test.ts` — valid / expired / tampered / wrong-secret
- `apps/web/lib/perf/timing.ts` — dev-only `timed()` helper to log action durations

### Modified

- `apps/web/package.json` — add `jose`
- `apps/web/lib/auth/index.ts` — `getAuthContext` local verify; add `requireUserVerified()`
- `apps/web/middleware.ts` — local verify for gating (keep session refresh)
- Destructive actions → `requireUserVerified`: `features/super-admin/actions/delete-workspace.ts`, `features/team/actions/change-member-role.ts`, `features/team/actions/remove-member.ts`, `features/projects/actions/delete-project.ts`, `features/clients/actions/delete-client.ts`
- Frequent project actions → drop `revalidatePath`: `update-card.ts`, `update-card-due-date.ts`, `checklist.ts`, `advance-card.ts`, `uncomplete-card.ts`, `card-assignees.ts`, `create-comment.ts`, `update-comment.ts`, `delete-comment.ts` (+ their `.test.ts`)
- Components → drop `router.refresh()`: `card-comment-form.tsx`, `card-comment-item.tsx`, `card-comments-thread.tsx`, `card-advance-checkbox.tsx`, `card-completed-badge.tsx`, `card-modal.tsx`, `kanban-board.tsx`, `list-view.tsx`
- `apps/web/features/projects/lib/reconcile.ts` — throttle `reconcileBeforeRead`

---

## Task 1: Add `jose`

**Files:** `apps/web/package.json`

- [ ] **Step 1: Context7 version check**

Query Context7 MCP for `jose`. Note the latest stable v5 line + that it's Edge/runtime-agnostic (works in Next middleware). Record the version in the commit.

- [ ] **Step 2: Install**

```bash
pnpm --filter @nexushub/web add jose
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml
git commit -m "chore(web): add jose for local JWT verification"
```

---

## Task 2: `verifyAccessToken` helper — TDD

**Files:**

- Create: `apps/web/lib/auth/verify-jwt.test.ts`
- Create: `apps/web/lib/auth/verify-jwt.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/auth/verify-jwt.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { SignJWT } from 'jose';

const TEST_SECRET = 'test-secret-at-least-32-bytes-long-xxxxx';

vi.mock('../env', () => ({
  getServerEnv: () => ({ SUPABASE_JWT_SECRET: TEST_SECRET }),
  getPublicEnv: () => ({ NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co' }),
}));

import { verifyAccessToken } from './verify-jwt';

const key = new TextEncoder().encode(TEST_SECRET);

async function makeToken(opts: { sub?: string; email?: string; expSecondsFromNow?: number } = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ email: opts.email ?? 'u@test' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(opts.sub ?? 'user-123')
    .setIssuedAt(now)
    .setExpirationTime(now + (opts.expSecondsFromNow ?? 3600))
    .sign(key);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('verifyAccessToken', () => {
  it('accepts a valid HS256 token and returns sub + email', async () => {
    const token = await makeToken({ sub: 'abc', email: 'a@b.c' });
    const res = await verifyAccessToken(token);
    expect(res).toEqual({ sub: 'abc', email: 'a@b.c' });
  });

  it('rejects an expired token', async () => {
    const token = await makeToken({ expSecondsFromNow: -10 });
    expect(await verifyAccessToken(token)).toBeNull();
  });

  it('rejects a token signed with the wrong secret', async () => {
    const wrong = new TextEncoder().encode('another-secret-that-is-also-32-bytes-xx');
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ email: 'x@y.z' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('abc')
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(wrong);
    expect(await verifyAccessToken(token)).toBeNull();
  });

  it('rejects a tampered token', async () => {
    const token = await makeToken({ sub: 'abc' });
    const tampered = `${token.slice(0, -3)}xyz`;
    expect(await verifyAccessToken(tampered)).toBeNull();
  });

  it('rejects garbage', async () => {
    expect(await verifyAccessToken('not.a.jwt')).toBeNull();
    expect(await verifyAccessToken('')).toBeNull();
  });

  it('returns null email when the claim is absent', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('abc')
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(key);
    expect(await verifyAccessToken(token)).toEqual({ sub: 'abc', email: null });
  });
});
```

- [ ] **Step 2: Run, confirm fail**

Run: `pnpm --filter @nexushub/web test -- verify-jwt`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `apps/web/lib/auth/verify-jwt.ts`:

```ts
import 'server-only';
import { jwtVerify, createRemoteJWKSet, decodeProtectedHeader, type JWTPayload } from 'jose';
import { getPublicEnv, getServerEnv } from '../env';

export interface VerifiedToken {
  readonly sub: string;
  readonly email: string | null;
}

// JWKS set is created lazily and cached across calls (createRemoteJWKSet
// memoises the fetched keys internally, refetching only on key rotation).
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function getJwks(): ReturnType<typeof createRemoteJWKSet> {
  if (!jwks) {
    const { NEXT_PUBLIC_SUPABASE_URL } = getPublicEnv();
    jwks = createRemoteJWKSet(new URL(`${NEXT_PUBLIC_SUPABASE_URL}/auth/v1/.well-known/jwks.json`));
  }
  return jwks;
}

/**
 * Verify a Supabase access token's signature LOCALLY (no network round-trip
 * for the common, non-expired case). Supports both signing schemes:
 *  - HS256 (legacy symmetric) → verified with SUPABASE_JWT_SECRET.
 *  - ES256/RS256 (asymmetric) → verified with the project's JWKS (cached).
 *
 * `jwtVerify` also enforces `exp`. Any failure (expired, tampered, wrong
 * key, malformed) resolves to `null`.
 *
 * SECURITY: this checks the cryptographic signature — it is NOT the same as
 * decoding the cookie. Conforms to CLAUDE.md §4.3.8.
 */
export async function verifyAccessToken(token: string): Promise<VerifiedToken | null> {
  if (!token) return null;
  try {
    const header = decodeProtectedHeader(token);
    let payload: JWTPayload;
    if (header.alg === 'HS256') {
      const secret = new TextEncoder().encode(getServerEnv().SUPABASE_JWT_SECRET);
      ({ payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] }));
    } else {
      ({ payload } = await jwtVerify(token, getJwks(), { algorithms: ['ES256', 'RS256'] }));
    }
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) return null;
    const email = typeof payload['email'] === 'string' ? (payload['email'] as string) : null;
    return { sub: payload.sub, email };
  } catch {
    return null;
  }
}
```

> **Confirm the signing scheme at this point:** decode a real session token (the `alg` in its header) — log in locally, read the `sb-…-auth-token` cookie, base64-decode the JWT header. If `alg` is `HS256`, the secret path is used (ensure `SUPABASE_JWT_SECRET` in `lib/env.ts` server schema). If it's `ES256`/`RS256`, the JWKS path is used (no secret needed). The dual implementation above handles either; this check just confirms which branch runs.

- [ ] **Step 4: Confirm `SUPABASE_JWT_SECRET` is in the env schema**

Run: `grep -n "SUPABASE_JWT_SECRET" apps/web/lib/env.ts`
Expected: present in the server env schema. If not, add it to the server schema (it's referenced already per the spec).

- [ ] **Step 5: Run tests, expect green**

Run: `pnpm --filter @nexushub/web test -- verify-jwt`
Expected: PASS (6 cases).

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/auth/verify-jwt.ts apps/web/lib/auth/verify-jwt.test.ts
git commit -m "feat(auth): local JWT verification helper (HS256 + JWKS)"
```

---

## Task 3: `getAuthContext` local verify + `requireUserVerified`

**Files:** `apps/web/lib/auth/index.ts`

- [ ] **Step 1: Rewrite `getAuthContext` to verify locally**

In `apps/web/lib/auth/index.ts`, add the import:

```ts
import { verifyAccessToken } from './verify-jwt';
```

Replace the body of `getAuthContext` (keep the `cache()` wrapper + the `prisma.user.findUnique` block unchanged) so the user id comes from a **locally-verified** token instead of the network `getUser()`:

```ts
export const getAuthContext = cache(async (): Promise<AuthContext | null> => {
  const supabase = await createSupabaseServer();
  // getSession() reads the token from cookies locally (and refreshes only
  // when expired). It does NOT verify the signature — so we verify it
  // ourselves below. This removes the per-request network getUser() call.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) return null;

  const verified = await verifyAccessToken(session.access_token);
  if (!verified) return null;

  const user = await prisma.user.findUnique({
    where: { id: verified.sub },
    select: {
      isSuperAdmin: true,
      memberships: {
        select: { workspaceId: true, role: true },
        orderBy: { createdAt: 'asc' },
        take: 1,
      },
    },
  });

  if (!user) return null;
  const membership = user.memberships[0];
  if (!membership) return null;
  if (!isRole(membership.role)) return null;

  return {
    userId: verified.sub,
    email: verified.email ?? '',
    workspaceId: membership.workspaceId,
    role: membership.role,
    isSuperAdmin: user.isSuperAdmin,
  };
});
```

Update the file header comment: replace the "`getUser()` … (network call)" note with a note that the JWT signature is verified locally (`verify-jwt.ts`), DB existence still confirmed via Prisma, and revocation latency is bounded by token lifetime.

- [ ] **Step 2: Add `requireUserVerified` for destructive actions**

Append to `apps/web/lib/auth/index.ts`:

```ts
/**
 * Stronger guard for DESTRUCTIVE / privilege-changing actions. Adds a
 * network `getUser()` call on top of the local-verified context so a
 * revoked/banned Supabase session is rejected immediately (no ≤1h window).
 * Use for: delete workspace, change member role, remove member, delete
 * project, delete client.
 */
export async function requireUserVerified(): Promise<AuthContext> {
  const ctx = await requireUser();
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user || data.user.id !== ctx.userId) {
    redirect('/login');
  }
  return ctx;
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @nexushub/web typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/auth/index.ts
git commit -m "feat(auth): local-verify getAuthContext + requireUserVerified for destructive ops"
```

---

## Task 4: Middleware local verify (keep session refresh)

**Files:** `apps/web/middleware.ts`

> **Highest-risk change** — auth gating. Test the login/gating/refresh flow carefully in the smoke test.

- [ ] **Step 1: Replace the network `getUser()` gating with local verify**

In `apps/web/middleware.ts`, add the import at the top:

```ts
import { verifyAccessToken } from '@/lib/auth/verify-jwt';
```

Replace the `// IMPORTANT: getUser()` block:

```ts
// IMPORTANT: getUser() (not getSession) — validates JWT against Supabase.
const { data } = await supabase.auth.getUser();
isAuthenticated = data.user !== null;
```

with:

```ts
// getSession() reads the token from cookies and refreshes it only when
// expired (network at most ~hourly), persisting the new cookie via the
// setAll handler above. We verify the signature locally — no per-request
// network validation.
const {
  data: { session },
} = await supabase.auth.getSession();
isAuthenticated = session?.access_token
  ? (await verifyAccessToken(session.access_token)) !== null
  : false;
```

- [ ] **Step 2: Update the file header note**

Replace the comment block that says "Use `getUser()` (which validates the JWT against Supabase) in `lib/auth/index.ts`" with a note that gating uses a local signature check (`verify-jwt.ts`) and that the session is still refreshed via `getSession()`.

- [ ] **Step 3: Typecheck + ensure `@/lib/auth/verify-jwt` resolves from middleware**

Run: `pnpm --filter @nexushub/web typecheck`
Expected: PASS. (`verify-jwt.ts` imports `server-only`; middleware is server-side so this is fine. If the build complains about `server-only` in middleware, drop the `import 'server-only'` line from `verify-jwt.ts` — it's defence-in-depth, not load-bearing.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/middleware.ts
git commit -m "perf(web): local JWT verify in middleware gating (drop per-request network getUser)"
```

---

## Task 5: Wire `requireUserVerified` into destructive actions

**Files:** `delete-workspace.ts`, `change-member-role.ts`, `remove-member.ts`, `delete-project.ts`, `delete-client.ts`

- [ ] **Step 1: Swap the guard in each destructive action**

For each file, find its current guard call (`requireUser()` / `requireAdmin()` / `requireSuperAdmin()`) at the top of the action. Keep the role check, but source the base context from `requireUserVerified()`.

Pattern — where a file does:

```ts
const ctx = await requireUser();
```

change to:

```ts
const ctx = await requireUserVerified();
```

And where it does `requireAdmin()` / `requireSuperAdmin()`, keep those (they already call `requireUser` internally); instead add the network re-check by replacing the internal call is overkill — simplest: at the top of these specific actions, after the existing admin/super-admin guard, add one line:

```ts
await requireUserVerified();
```

(That performs the network revoke check; the role was already enforced by `requireAdmin`/`requireSuperAdmin`. The double `requireUser` is cache-deduped so it costs nothing extra beyond the single `getUser()`.)

Update the import in each file to include `requireUserVerified` from `@/lib/auth`.

- [ ] **Step 2: Update affected tests**

These actions have tests that mock `@/lib/auth`. Add `requireUserVerified` to the mock (resolving to the same admin/user context the test already uses). Run:

```bash
pnpm --filter @nexushub/web test -- delete-workspace change-member-role delete-project delete-client
```

Expected: PASS (after adding the mock export).

- [ ] **Step 3: Typecheck + commit**

```bash
pnpm --filter @nexushub/web typecheck
git add apps/web/features/super-admin/actions/delete-workspace.ts apps/web/features/team/actions/change-member-role.ts apps/web/features/team/actions/remove-member.ts apps/web/features/projects/actions/delete-project.ts apps/web/features/clients/actions/delete-client.ts apps/web/features/**/*.test.ts
git commit -m "feat(auth): network revoke-check on destructive actions via requireUserVerified"
```

---

## Task 6: Drop `revalidatePath` from frequent project mutations

**Files:** `update-card.ts`, `update-card-due-date.ts`, `checklist.ts`, `advance-card.ts`, `uncomplete-card.ts`, `card-assignees.ts`, `create-comment.ts`, `update-comment.ts`, `delete-comment.ts` (+ their tests)

> These mutations are already reflected client-side (optimistic state for title/desc/fields/checklist, board events for advance/uncomplete, optimistic comments after Task 7). A full-page `revalidatePath` after each is the main source of background churn.

> **Accepted minor staleness:** removing `revalidatePath` from `create-comment`/`delete-comment` means the card's comment-count badge on the board/list (`_count.comments`) won't update until the next navigation or reconcile window. This is cosmetic and acceptable; the modal thread itself is optimistic (Task 7).

- [ ] **Step 1: Remove the `revalidatePath` calls**

In each action file, delete the `revalidatePath(...)` call(s) and the now-unused `import { revalidatePath } from 'next/cache';`. Leave the rest of the action (auth, scope, the DB write, the return value) unchanged.

> **Keep `revalidatePath`** in: `create-project.ts`, `delete-project.ts`, `share-project-with-viewer.ts`. For `create-card.ts` / `delete-card.ts`, the board already updates via `CARD_CREATED_EVENT` / `CARD_REMOVED_EVENT` — remove their `revalidatePath` too **only if** Step 3's smoke shows the board stays correct; otherwise leave them. Default: leave create-card/delete-card untouched in this task (handled by their events already; do not risk it).

- [ ] **Step 2: Update tests that assert `revalidatePath`**

Several `*.test.ts` assert `revalidatePath` was called. For each action you changed, remove those assertions (and the `revalidatePath` mock if now unused). Run:

```bash
pnpm --filter @nexushub/web test -- uncomplete-card update-card-due-date create-comment update-comment delete-comment
```

Expected: PASS after removing the stale assertions.

- [ ] **Step 3: Typecheck + commit**

```bash
pnpm --filter @nexushub/web typecheck
git add apps/web/features/projects/actions
git commit -m "perf(web): drop full-page revalidate from frequent card/comment mutations"
```

---

## Task 7: Optimistic comments + drop `router.refresh()`

**Files:** `card-comments-thread.tsx`, `card-comment-form.tsx`, `card-comment-item.tsx`

- [ ] **Step 1: Make the thread own an optimistic list**

In `card-comments-thread.tsx`, hold the comments in `useOptimistic` so a new/edited/deleted comment shows instantly. Sketch:

```tsx
'use client';
import { useOptimistic, startTransition } from 'react';
import { CardCommentItem } from './card-comment-item';
import { CardCommentForm } from './card-comment-form';
import type { CardCommentDTO } from '../lib/comment-dto';

type OptimisticAction =
  | { type: 'add'; comment: CardCommentDTO }
  | { type: 'update'; id: string; bodyHtml: string; body: string }
  | { type: 'delete'; id: string };

export function CardCommentsThread({
  cardId,
  csrfToken,
  comments,
  canPost = true,
}: CardCommentsThreadProps) {
  const [optimistic, applyOptimistic] = useOptimistic(
    comments,
    (state, action: OptimisticAction) => {
      switch (action.type) {
        case 'add':
          return [...state, action.comment];
        case 'update':
          return state.map((c) =>
            c.id === action.id
              ? { ...c, body: action.body, bodyHtml: action.bodyHtml, isEdited: true }
              : c,
          );
        case 'delete':
          return state.filter((c) => c.id !== action.id);
      }
    },
  );
  // pass applyOptimistic + startTransition down to form/item
  // ...
}
```

The form, on submit, wraps the action call in `startTransition` and calls `applyOptimistic({ type: 'add', comment: <locally-built DTO> })` before awaiting; the item does the same for update/delete. Build the optimistic DTO from the current user info already present on existing comments (or pass `currentUser` down from the page — check what `card-comments-thread` receives; if author identity isn't available, pass it as a new prop from the modal which has `currentUserId`).

> Keep it pragmatic: if building a fully-faithful optimistic comment DTO is awkward (avatar/initials), the minimum win is to **remove `router.refresh()`** and instead append the server-returned comment to local state. Prefer `useOptimistic` for the form (instant echo), and for delete just filter locally on success. Do not leave any `router.refresh()` in these three files.

- [ ] **Step 2: Remove `router.refresh()` from the three comment files**

Replace each `router.refresh()` with the local-state update path above.

- [ ] **Step 3: Typecheck + lint**

Run:

```bash
pnpm --filter @nexushub/web typecheck
pnpm --filter @nexushub/web lint
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/features/projects/components/card-comments-thread.tsx apps/web/features/projects/components/card-comment-form.tsx apps/web/features/projects/components/card-comment-item.tsx
git commit -m "perf(web): optimistic comments (drop router.refresh)"
```

---

## Task 8: Drop `router.refresh()` from the remaining board/modal components

**Files:** `card-advance-checkbox.tsx`, `card-completed-badge.tsx`, `card-modal.tsx`, `kanban-board.tsx`, `list-view.tsx`

- [ ] **Step 1: Replace each `router.refresh()` with the existing event / local state**

For each file, locate the `router.refresh()` call (typically after a successful advance/uncomplete/move). Replace it:

- Where a board-level event already exists (`CARD_ADVANCED_EVENT`, `CARD_CREATED_EVENT`, `CARD_REMOVED_EVENT`), dispatch/handle that event for cross-component sync instead of refreshing.
- Where the change is local to the component's own state, update that state directly.
- Remove the now-unused `useRouter`/`router` import if nothing else uses it.

> **Garde-fou:** after removing each `router.refresh()`, confirm (Step 3 smoke) the affected view stays correct without a manual reload. If a specific case genuinely needs server data the client doesn't have, dispatch a targeted event or, as a last resort, keep that single refresh — note it in the report. The goal is zero refresh on the hot path (advance, complete/uncomplete, field edits).

- [ ] **Step 2: Typecheck + lint**

```bash
pnpm --filter @nexushub/web typecheck
pnpm --filter @nexushub/web lint
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/features/projects/components/card-advance-checkbox.tsx apps/web/features/projects/components/card-completed-badge.tsx apps/web/features/projects/components/card-modal.tsx apps/web/features/projects/components/kanban-board.tsx apps/web/features/projects/components/list-view.tsx
git commit -m "perf(web): drop router.refresh from board/modal hot paths"
```

---

## Task 9: Throttle `reconcileBeforeRead`

**Files:** `apps/web/features/projects/lib/reconcile.ts` + `apps/web/features/projects/lib/reconcile.test.ts` (new, or extend existing)

- [ ] **Step 1: Write the throttle test**

Create `apps/web/features/projects/lib/reconcile-throttle.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  reconcileOverdueRouting: vi.fn(),
  applyAutoArchive: vi.fn(),
}));

// We test the throttle wrapper in isolation by mocking the two inner passes.
vi.mock('@nexushub/db', () => ({ prisma: {} }));

import { __setReconcileNowForTest, shouldRunReconcile } from './reconcile-throttle';

beforeEach(() => {
  __setReconcileNowForTest(0);
});

describe('shouldRunReconcile (per-workspace throttle)', () => {
  it('runs the first time for a workspace', () => {
    expect(shouldRunReconcile('ws-1')).toBe(true);
  });

  it('skips a second call within the window', () => {
    __setReconcileNowForTest(1000);
    expect(shouldRunReconcile('ws-1')).toBe(true);
    __setReconcileNowForTest(1000 + 30_000); // 30s later, < 60s window
    expect(shouldRunReconcile('ws-1')).toBe(false);
  });

  it('runs again after the window elapses', () => {
    __setReconcileNowForTest(2000);
    expect(shouldRunReconcile('ws-1')).toBe(true);
    __setReconcileNowForTest(2000 + 61_000);
    expect(shouldRunReconcile('ws-1')).toBe(true);
  });

  it('tracks workspaces independently', () => {
    __setReconcileNowForTest(5000);
    expect(shouldRunReconcile('ws-1')).toBe(true);
    expect(shouldRunReconcile('ws-2')).toBe(true);
  });
});
```

- [ ] **Step 2: Run, confirm fail**

Run: `pnpm --filter @nexushub/web test -- reconcile-throttle`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the throttle**

Create `apps/web/features/projects/lib/reconcile-throttle.ts`:

```ts
import 'server-only';

const WINDOW_MS = 60_000;
const lastRun = new Map<string, number>();

// Indirection so tests can control "now" deterministically.
let nowFn: () => number = () => Date.now();
export function __setReconcileNowForTest(ms: number): void {
  nowFn = () => ms;
}

/**
 * Per-workspace throttle: returns true at most once per WINDOW_MS. Reconcile
 * is idempotent, so skipping rapid repeat calls (navigations, residual
 * refetches) is safe — the next window converges the state.
 *
 * Process-local memory (per serverless instance). Good enough: each instance
 * still reconciles within the window; correctness is unaffected by misses.
 */
export function shouldRunReconcile(workspaceId: string): boolean {
  const now = nowFn();
  const prev = lastRun.get(workspaceId);
  if (prev !== undefined && now - prev < WINDOW_MS) return false;
  lastRun.set(workspaceId, now);
  return true;
}
```

- [ ] **Step 4: Gate `reconcileBeforeRead` with the throttle**

In `apps/web/features/projects/lib/reconcile.ts`, import the throttle and short-circuit at the top of `reconcileBeforeRead`:

```ts
import { shouldRunReconcile } from './reconcile-throttle';
// ...
export async function reconcileBeforeRead(
  workspaceId: string,
  options: { readonly projectIds?: readonly string[]; readonly now?: Date } = {},
): Promise<{ readonly blocked: number; readonly restored: number; readonly archived: number }> {
  if (!shouldRunReconcile(workspaceId)) {
    return { blocked: 0, restored: 0, archived: 0 };
  }
  const [routing, archive] = await Promise.all([
    reconcileOverdueRouting(workspaceId, options),
    applyAutoArchive(workspaceId, options),
  ]);
  return { ...routing, ...archive };
}
```

> Note: when a specific `projectIds` filter is passed, the throttle is keyed only on `workspaceId` — acceptable, since reconcile is whole-workspace-safe and a skipped project still reconciles next window. If finer behavior is wanted later, key on `workspaceId + projectIds`, but keep it simple now.

- [ ] **Step 5: Run tests, expect green**

Run: `pnpm --filter @nexushub/web test -- reconcile-throttle`
Expected: PASS (4 cases).

- [ ] **Step 6: Commit**

```bash
git add apps/web/features/projects/lib/reconcile-throttle.ts apps/web/features/projects/lib/reconcile-throttle.test.ts apps/web/features/projects/lib/reconcile.ts
git commit -m "perf(web): throttle reconcile-on-read to once per workspace per 60s"
```

---

## Task 10: Dev-only timing util (optional measurement)

**Files:** `apps/web/lib/perf/timing.ts`

- [ ] **Step 1: Add the helper**

Create `apps/web/lib/perf/timing.ts`:

```ts
import 'server-only';

/**
 * Wrap a server-side async block to log its duration in development only.
 * No-op in production. Use to objectivise before/after on hot actions.
 */
export async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (process.env['NODE_ENV'] === 'production') return fn();
  const start = performance.now();
  try {
    return await fn();
  } finally {
    // eslint-disable-next-line no-console -- dev-only diagnostic
    console.debug(`[perf] ${label}: ${(performance.now() - start).toFixed(0)}ms`);
  }
}
```

- [ ] **Step 2: Wrap 2-3 representative actions (temporary measurement)**

Optionally wrap the core of `updateCard`, `createComment`, and `advanceCard` bodies in `timed('updateCard', async () => { ... })` to compare before/after. This is for local measurement; you may leave the helper in place (it's a prod no-op) but remove the wrapping calls before finishing if they add noise. Keep the helper file.

- [ ] **Step 3: Typecheck + commit**

```bash
pnpm --filter @nexushub/web typecheck
git add apps/web/lib/perf/timing.ts
git commit -m "chore(web): dev-only timing helper for perf measurement"
```

---

## Task 11: Full verification

- [ ] **Step 1: typecheck + lint + test + build**

Run:

```bash
pnpm -w typecheck
pnpm -w lint
pnpm -w test
pnpm --filter @nexushub/web build
```

Expected: all green; build reaches "Compiled successfully" + static generation (the worktree needs `.env.local`; copy from repo root as done previously if missing).

---

## Task 12: Manual smoke test (user)

- [ ] **Step 1: Boot dev** (`cd apps/web && ./node_modules/.bin/next dev --turbo --port 3001`, ensure `.env.local` present).

- [ ] **Step 2: Verify**

1. **Auth still works**: log out → `/projects` redirects to `/login`. Log in → reaches the app. Reload a project page repeatedly — should feel faster (no per-render network auth).
2. **Latency**: edit a card title, edit a field, toggle a checklist item, advance a card, post/edit/delete a comment — each should feel **instant**, no visible lag/refetch flash.
3. **Consistency**: after each action, the board/list/modal shows the right state without a manual reload. Navigate away and back — state is correct (canonical from server).
4. **Deadline → Bloqué** still works within ~60s (reconcile throttle).
5. **Destructive action** (e.g. delete a project) still works and still enforces auth.
6. (Optional) Watch the dev console `[perf]` logs to confirm action durations dropped.

- [ ] **Step 3: No commit — confirm with the user.**

---

## Task 13: Finish

- [ ] Hand off to `superpowers:finishing-a-development-branch` (`branch: performance`). No DB migration → no migrate-before-deploy concern.

---

## Notes for the implementer

- **Security is the priority on Tasks 2-5.** The local verify MUST check the signature (never trust `getSession()` alone). Keep the DB existence check. Keep a network `getUser()` on destructive actions.
- **Middleware (Task 4) is the riskiest** — a wrong gating decision locks users out or lets them in. Smoke the login/gating/refresh flow thoroughly.
- **Removing refetch (Tasks 6-8) is incremental and reversible** — proceed file by file; if a view goes stale without a refresh and no event covers it, prefer adding a targeted event over restoring a global refresh. Note any case where you had to keep a refresh.
- **No DB migration** in this branch.
- **`jose` works in the Edge middleware runtime** — no Node-only APIs used.
- **Workstream E (fewer Prisma round-trips) is intentionally deferred** — it's secondary per the spec ("only if measurable after A-D"). Use the Task 10 `[perf]` logs to decide whether it's worth a follow-up; do not do it speculatively in this branch.
