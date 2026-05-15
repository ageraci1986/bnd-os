# User Management — Phase B.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the `WorkspaceAccess` foundation (DB + domain + scope helpers) and apply it across the read + write paths so an Admin can restrict a User to specific clients/projects within their workspace. Viewer role remains gated at the invitation layer — Plan B.2 unlocks it with its own UX (`/my-projects`, sidebar, share modal). Three Phase A follow-ups land first as Task 0.

**Architecture:** A single new table `workspace_access` with optional `client_id` xor `project_id` rows that **restrict** a Membership. Domain layer exposes `loadUserScope(ctx)` which returns either `{ kind: 'workspace' }` (no rows → full access, the common case) or `{ kind: 'restricted', clientIds, projectIds }`. Three Prisma where-builders (`scopedClientWhere`, `scopedProjectWhere`, `scopedCardWhere`) spread cleanly into every list query — they short-circuit to `{}` for full-workspace so non-scoped Admins/Users see zero overhead. Single-resource pages guard with `notFound()` when the requested id is out of scope. Mutating server actions perform the same scope check before any write.

**Tech Stack:** Prisma 6 + Postgres 17 (Supabase), TypeScript strict, Next.js 15 App Router, Vitest.

**Scope guardrails (out of this plan):** No Viewer-facing UX (Plan B.2). No `/super-admin` route (Phase C). No impersonation (V1.5). `shareProjectWithViewer` action ships in B.2. The Viewer invitation rejection from Phase A stays in place — B.1 does not unblock it.

---

## File Structure

**New files:**

- `packages/db/prisma/migrations/20260516100001_workspace_access/migration.sql` — `workspace_access` table + RLS policies + audit kinds.
- `packages/domain/src/permissions/is-role.ts` — `isRole` type predicate (split out for testability).
- `packages/domain/src/permissions/is-role.test.ts` — predicate tests.
- `packages/domain/src/scope/index.ts` — `loadUserScope`, `scopedClientWhere`, `scopedProjectWhere`, `scopedCardWhere`, `evaluateScopeMatch` (pure domain function).
- `packages/domain/src/scope/scope.test.ts` — combinatorial tests for the pure helpers.
- `apps/web/app/(app)/not-found.tsx` — friendly 404 page used by `notFound()` after `requireAdmin` / `requireSuperAdmin` rejection.
- `apps/web/lib/auth/scope.ts` — thin app-side wrapper that loads scope from the request, caches per-request, and forwards to the domain helpers.
- `apps/web/features/team/actions/set-user-scope.ts` — Admin-only server action that adds/removes `WorkspaceAccess` rows for a given Membership.
- `apps/web/features/team/actions/set-user-scope.test.ts` — integration test.
- `apps/web/features/team/components/scope-modal.tsx` — modal to edit a member's scope (Admin only).
- `apps/web/features/team/components/scope-chip.tsx` — small chip rendered in member rows summarising current scope.
- `apps/web/features/invitations/actions/create-invitation.test.ts` — integration test covering Viewer rejection, last-Admin guard surface, workspace isolation.
- `apps/web/features/team/actions/change-member-role.test.ts` — same scope of integration tests.

**Modified files:**

- `packages/db/prisma/schema.prisma` — add `WorkspaceAccess` model + `AuditAction.workspace_access_granted` / `workspace_access_revoked`.
- `packages/domain/src/permissions/index.ts` — re-export `isRole` from the new file.
- `apps/web/lib/auth/index.ts` — replace `throw new Response('Forbidden', { status: 403 })` with `notFound()`; replace `as Role` cast with `isRole` guard.
- `apps/web/app/(app)/projects/page.tsx`, `apps/web/app/(app)/clients/page.tsx`, `apps/web/app/(app)/overview/page.tsx` — spread scoped where into list queries.
- `apps/web/app/(app)/projects/[id]/page.tsx` + `[id]/list/page.tsx` + `[id]/calendar/page.tsx` — single-resource guard.
- `apps/web/features/clients/lib/index.ts` (and friends) — accept optional scope on `listClients`.
- `apps/web/features/projects/actions/create-project.ts` + `delete-project.ts` — scope check on the target client/project before mutation.
- `apps/web/features/clients/actions/create-client.ts` + `update-client.ts` + `delete-client.ts` + `create-contact.ts` + `delete-contact.ts` — scope check before mutation.
- `apps/web/features/projects/actions/create-card.ts` + `move-card.ts` + `update-card.ts` + `update-card-due-date.ts` + `delete-card.ts` + `change-card-template.ts` + `skip-card-to-next-column.ts` + `card-assignees.ts` + `checklist.ts` + `advance-card.ts` — scope check on the card's parent project.
- `apps/web/app/(app)/team/page.tsx` — fetch each member's `workspaceAccess` rows + display scope chip + wire the scope modal.
- `apps/web/features/team/components/member-row.tsx` — render scope chip; trigger modal.
- `apps/web/features/team/components/invitation-form.tsx` — scope picker (radio "Tout le workspace" / "Restreindre", with multi-select panel when restricted). Optional for User role. Viewer stays disabled in this plan.
- `progress.md` — Phase 9.6 section.

---

## Task 0: Phase A follow-ups (3 sub-commits)

Three small fixes flagged by the Phase A final reviewer. Each is independent and ships as its own commit at the top of this branch.

### 0.1 — `isRole` type predicate + drop the `as Role` cast

**Why:** `getAuthContext` currently does `role: membership.role as Role`. This cast is safe today but will silently bridge a future DB/domain mismatch. Phase B writes will be the first runtime paths where a `Role` value flows back from Prisma into typed code that branches on it — the guard must land first.

**Files:**

- Create: `packages/domain/src/permissions/is-role.ts`
- Create: `packages/domain/src/permissions/is-role.test.ts`
- Modify: `packages/domain/src/permissions/index.ts` (re-export)
- Modify: `apps/web/lib/auth/index.ts` (use the guard)

- [ ] **Step 1: Write the failing test**

File: `packages/domain/src/permissions/is-role.test.ts`

```typescript
import { describe, expect, it } from 'vitest';
import { isRole } from './is-role';

describe('isRole', () => {
  it('accepts the three valid role strings', () => {
    expect(isRole('admin')).toBe(true);
    expect(isRole('user')).toBe(true);
    expect(isRole('viewer')).toBe(true);
  });
  it('rejects legacy or unknown values', () => {
    expect(isRole('member')).toBe(false);
    expect(isRole('owner')).toBe(false);
    expect(isRole('')).toBe(false);
  });
  it('rejects non-strings', () => {
    expect(isRole(null)).toBe(false);
    expect(isRole(undefined)).toBe(false);
    expect(isRole(42)).toBe(false);
    expect(isRole({})).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @nexushub/domain test -- src/permissions/is-role.test.ts`

Expected: FAIL with "Cannot find module './is-role'".

- [ ] **Step 3: Implement the predicate**

File: `packages/domain/src/permissions/is-role.ts`

```typescript
import { Roles, type Role } from './index';

const KNOWN: ReadonlySet<string> = new Set([Roles.Admin, Roles.User, Roles.Viewer]);

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && KNOWN.has(value);
}
```

- [ ] **Step 4: Re-export from the package entry**

Add to `packages/domain/src/permissions/index.ts` at the very bottom of the file:

```typescript
export { isRole } from './is-role';
```

- [ ] **Step 5: Use the guard in `getAuthContext`**

File: `apps/web/lib/auth/index.ts`

Replace the import line:

```typescript
import { Roles, type Role } from '@nexushub/domain';
```

with:

```typescript
import { isRole, Roles, type Role } from '@nexushub/domain';
```

Replace the return statement at the bottom of `getAuthContext` (the `return { userId: ..., role: membership.role as Role, ... }`):

Find:

```typescript
return {
  userId: data.user.id,
  email: data.user.email ?? '',
  workspaceId: membership.workspaceId,
  role: membership.role as Role,
  isSuperAdmin: user.isSuperAdmin,
};
```

Replace with:

```typescript
if (!isRole(membership.role)) {
  // DB has a value we don't recognise (e.g. enum extended without code
  // update). Treat as not-signed-in so we redirect to /login rather than
  // hand back an unsafe context.
  return null;
}
return {
  userId: data.user.id,
  email: data.user.email ?? '',
  workspaceId: membership.workspaceId,
  role: membership.role,
  isSuperAdmin: user.isSuperAdmin,
};
```

- [ ] **Step 6: Run tests + typecheck + lint**

```bash
pnpm --filter @nexushub/domain test -- src/permissions/is-role.test.ts
pnpm --filter @nexushub/web typecheck
pnpm --filter @nexushub/web lint
```

Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add packages/domain/src/permissions/is-role.ts packages/domain/src/permissions/is-role.test.ts packages/domain/src/permissions/index.ts apps/web/lib/auth/index.ts
git commit -m "feat(domain): isRole type predicate; drop unsafe Role cast in getAuthContext"
```

---

### 0.2 — Replace `throw new Response(403)` with `notFound()`

**Why:** Turbopack dev renders the thrown Response as "Runtime Error: Response" instead of a graceful page. In production it would render a generic error. Using Next.js's `notFound()` renders the standard 404 page (also hides the existence of restricted routes from unauthenticated/under-privileged users — defensible default).

**Files:**

- Modify: `apps/web/lib/auth/index.ts`
- Create: `apps/web/app/(app)/not-found.tsx` (Next.js auto-renders this when `notFound()` is called inside the `(app)` segment)

- [ ] **Step 1: Create the friendly 404 page**

File: `apps/web/app/(app)/not-found.tsx`

```tsx
import Link from 'next/link';

export default function AppNotFound() {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-[28px] font-extrabold tracking-tight">Page introuvable</h1>
      <p className="mt-3 text-sm text-[color:var(--color-text-muted)]">
        Cette page n&apos;existe pas, ou tu n&apos;y as pas accès depuis ce workspace.
      </p>
      <Link href="/overview" className="btn btn-primary btn-sm mt-6 inline-block">
        Retour à l&apos;Overview
      </Link>
    </div>
  );
}
```

- [ ] **Step 2: Update the auth helpers**

File: `apps/web/lib/auth/index.ts`

Replace the import line to add `notFound`:

```typescript
import { notFound, redirect } from 'next/navigation';
```

Find the `requireAdmin` body:

```typescript
export async function requireAdmin(): Promise<AuthContext> {
  const ctx = await requireUser();
  if (ctx.role !== Roles.Admin && !ctx.isSuperAdmin) {
    throw new Response('Forbidden', { status: 403 });
  }
  return ctx;
}
```

Replace with:

```typescript
export async function requireAdmin(): Promise<AuthContext> {
  const ctx = await requireUser();
  if (ctx.role !== Roles.Admin && !ctx.isSuperAdmin) {
    notFound();
  }
  return ctx;
}
```

Same for `requireSuperAdmin`:

```typescript
export async function requireSuperAdmin(): Promise<AuthContext> {
  const ctx = await requireUser();
  if (!ctx.isSuperAdmin) {
    notFound();
  }
  return ctx;
}
```

- [ ] **Step 3: Typecheck + lint + tests**

```bash
pnpm --filter @nexushub/web typecheck
pnpm --filter @nexushub/web lint
pnpm test
```

Expected: all green. (The four updated test files from Phase A still mock `requireAdmin` to return a context — they don't exercise the rejection path, so no test change is needed.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/\(app\)/not-found.tsx apps/web/lib/auth/index.ts
git commit -m "feat(auth): render 404 instead of throwing Response on forbidden access"
```

---

### 0.3 — Integration tests for `createInvitation` + `changeMemberRole`

**Why:** Phase A added a defence-in-depth Viewer rejection in both server actions but there are no tests covering it. The Phase B picker UI may move/adjust the guard; a regression that re-opens Viewer invites pre-B.2 would be silent.

**Files:**

- Create: `apps/web/features/invitations/actions/create-invitation.test.ts`
- Create: `apps/web/features/team/actions/change-member-role.test.ts`

**Pattern reference:** mirror `apps/web/features/clients/actions/create-client.test.ts` (vi.hoisted + vi.mock patterns for `@nexushub/db`, `@/lib/auth`, `@/lib/csrf`, `next/cache`).

- [ ] **Step 1: Write `create-invitation.test.ts`**

File: `apps/web/features/invitations/actions/create-invitation.test.ts`

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  workspaceFindUniqueOrThrow: vi.fn(),
  invitationUpdateMany: vi.fn(),
  invitationCreate: vi.fn(),
  requireAdmin: vi.fn(),
  assertCsrf: vi.fn(),
  recordAudit: vi.fn(),
  rateLimitCheck: vi.fn(),
  emailSend: vi.fn(),
  getClientIp: vi.fn(() => '127.0.0.1'),
}));

vi.mock('@nexushub/db', () => ({
  prisma: {
    user: { findUnique: mocks.userFindUnique, findUniqueOrThrow: mocks.userFindUnique },
    workspace: { findUniqueOrThrow: mocks.workspaceFindUniqueOrThrow },
    invitation: { updateMany: mocks.invitationUpdateMany, create: mocks.invitationCreate },
  },
}));
vi.mock('@/lib/auth', () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock('@/lib/csrf', () => ({ assertCsrfFromFormData: mocks.assertCsrf }));
vi.mock('@/lib/audit', () => ({ recordAudit: mocks.recordAudit }));
vi.mock('@/lib/rate-limit', () => ({
  getRateLimiter: () => ({ check: mocks.rateLimitCheck }),
  getClientIp: mocks.getClientIp,
}));
vi.mock('@/lib/email', () => ({ getEmail: () => ({ send: mocks.emailSend }) }));
vi.mock('@/lib/env', () => ({
  getServerEnv: () => ({ INVITATION_SECRET: 'test-secret-must-be-long-enough-for-hmac' }),
  getPublicEnv: () => ({ NEXT_PUBLIC_APP_URL: 'http://localhost:3000' }),
}));
vi.mock('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));
vi.mock('../email/templates', () => ({
  renderInvitationEmail: () => ({ subject: 's', text: 't', htmlSanitized: '<p>h</p>' }),
}));

import { createInvitation } from './create-invitation';

function fd(role: string, email = 'new@example.com'): FormData {
  const f = new FormData();
  f.set('email', email);
  f.set('role', role);
  return f;
}

beforeEach(() => {
  for (const m of Object.values(mocks)) (m as { mockReset?: () => void }).mockReset?.();
  mocks.requireAdmin.mockResolvedValue({
    userId: 'admin-user',
    workspaceId: 'ws-1',
    role: 'admin',
    isSuperAdmin: false,
    email: 'admin@ws-1.test',
  });
  mocks.rateLimitCheck.mockResolvedValue({ success: true });
  mocks.userFindUnique.mockResolvedValue({
    memberships: [],
    firstName: 'A',
    lastName: 'D',
    email: 'admin@ws-1.test',
  });
  mocks.workspaceFindUniqueOrThrow.mockResolvedValue({ name: 'WS 1' });
  mocks.invitationCreate.mockResolvedValue({ id: 'inv-1' });
});

describe('createInvitation', () => {
  it('rejects role=viewer in Phase A (Phase B.2 unlocks it)', async () => {
    const res = await createInvitation({ status: 'idle' }, fd('viewer'));
    expect(res).toEqual({
      status: 'error',
      message: 'Le rôle Viewer sera disponible dans une prochaine mise à jour.',
    });
    expect(mocks.invitationCreate).not.toHaveBeenCalled();
  });

  it('accepts role=user and writes the invitation', async () => {
    const res = await createInvitation({ status: 'idle' }, fd('user'));
    expect(res.status).toBe('success');
    expect(mocks.invitationCreate).toHaveBeenCalledOnce();
    const args = mocks.invitationCreate.mock.calls[0][0];
    expect(args.data.role).toBe('user');
    expect(args.data.workspaceId).toBe('ws-1');
  });

  it('accepts role=admin', async () => {
    const res = await createInvitation({ status: 'idle' }, fd('admin'));
    expect(res.status).toBe('success');
    const args = mocks.invitationCreate.mock.calls[0][0];
    expect(args.data.role).toBe('admin');
  });

  it('rejects unknown roles via Zod', async () => {
    const res = await createInvitation({ status: 'idle' }, fd('owner'));
    expect(res.status).toBe('error');
    expect(mocks.invitationCreate).not.toHaveBeenCalled();
  });

  it('rejects duplicate workspace membership', async () => {
    mocks.userFindUnique.mockResolvedValueOnce({ memberships: [{ id: 'm-existing' }] });
    const res = await createInvitation({ status: 'idle' }, fd('user'));
    expect(res).toMatchObject({ status: 'error' });
    expect(mocks.invitationCreate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Write `change-member-role.test.ts`**

File: `apps/web/features/team/actions/change-member-role.test.ts`

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  membershipFindUnique: vi.fn(),
  membershipUpdate: vi.fn(),
  requireAdmin: vi.fn(),
  assertCsrf: vi.fn(),
  recordAudit: vi.fn(),
  revalidatePath: vi.fn(),
  getClientIp: vi.fn(() => '127.0.0.1'),
  PrismaP0001: class extends Error {
    override readonly name = 'PrismaClientKnownRequestError';
    constructor() {
      super('LAST_ADMIN_PROTECTED: cannot remove or downgrade the last admin');
    }
  },
}));

vi.mock('@nexushub/db', () => ({
  prisma: {
    membership: { findUnique: mocks.membershipFindUnique, update: mocks.membershipUpdate },
  },
  Prisma: { PrismaClientKnownRequestError: mocks.PrismaP0001 },
}));
vi.mock('@/lib/auth', () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock('@/lib/csrf', () => ({ assertCsrfFromFormData: mocks.assertCsrf }));
vi.mock('@/lib/audit', () => ({ recordAudit: mocks.recordAudit }));
vi.mock('@/lib/rate-limit', () => ({ getClientIp: mocks.getClientIp }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));

import { changeMemberRole } from './change-member-role';

function fd(membershipId: string, role: string): FormData {
  const f = new FormData();
  f.set('membershipId', membershipId);
  f.set('role', role);
  return f;
}

beforeEach(() => {
  for (const m of Object.values(mocks)) (m as { mockReset?: () => void }).mockReset?.();
  mocks.requireAdmin.mockResolvedValue({
    userId: 'admin-user',
    workspaceId: 'ws-1',
    role: 'admin',
    isSuperAdmin: false,
    email: 'admin@ws-1.test',
  });
  mocks.membershipFindUnique.mockResolvedValue({
    workspaceId: 'ws-1',
    role: 'user',
    userId: 'other-user',
  });
});

describe('changeMemberRole', () => {
  it('rejects role=viewer in Phase A', async () => {
    const res = await changeMemberRole(
      { status: 'idle' },
      fd('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'viewer'),
    );
    expect(res).toEqual({
      status: 'error',
      message: 'Le rôle Viewer sera disponible dans une prochaine mise à jour.',
    });
    expect(mocks.membershipUpdate).not.toHaveBeenCalled();
  });

  it('updates role=admin for a member in the same workspace', async () => {
    const res = await changeMemberRole(
      { status: 'idle' },
      fd('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'admin'),
    );
    expect(res.status).toBe('success');
    expect(mocks.membershipUpdate).toHaveBeenCalledOnce();
  });

  it('refuses to operate on a membership belonging to a different workspace', async () => {
    mocks.membershipFindUnique.mockResolvedValueOnce({
      workspaceId: 'ws-other',
      role: 'admin',
      userId: 'x',
    });
    const res = await changeMemberRole(
      { status: 'idle' },
      fd('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'admin'),
    );
    expect(res).toMatchObject({ status: 'error' });
    expect(mocks.membershipUpdate).not.toHaveBeenCalled();
  });

  it('surfaces LAST_ADMIN_PROTECTED as a friendly message', async () => {
    mocks.membershipUpdate.mockRejectedValueOnce(new mocks.PrismaP0001());
    const res = await changeMemberRole(
      { status: 'idle' },
      fd('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'user'),
    );
    expect(res).toEqual({
      status: 'error',
      message: "Impossible : ce membre est le dernier Admin de l'espace.",
    });
  });
});
```

- [ ] **Step 3: Run the new tests**

```bash
pnpm --filter @nexushub/web test -- features/invitations/actions/create-invitation.test.ts features/team/actions/change-member-role.test.ts
```

Expected: 9 specs pass (5 + 4).

- [ ] **Step 4: Full test suite + lint**

```bash
pnpm test
pnpm --filter @nexushub/web lint
```

Expected: both green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/features/invitations/actions/create-invitation.test.ts apps/web/features/team/actions/change-member-role.test.ts
git commit -m "test(team): integration tests for createInvitation + changeMemberRole"
```

---

## Task 1: DB migration — `workspace_access` table + RLS + audit kinds

**Files:**

- Create: `packages/db/prisma/migrations/20260516100001_workspace_access/migration.sql`

- [ ] **Step 1: Create the migration directory**

```bash
mkdir -p packages/db/prisma/migrations/20260516100001_workspace_access
```

- [ ] **Step 2: Write the migration SQL**

File: `packages/db/prisma/migrations/20260516100001_workspace_access/migration.sql`

```sql
-- Phase B.1 — WorkspaceAccess: optional rows that RESTRICT a Membership
-- to specific clients or projects within their workspace. Absence of rows
-- = full workspace access (the default for User; Admin is never scoped).
-- Phase B.2 will use the same table for Viewer-shared projects.

-- Audit kinds first (separate statement so the enum is committed before
-- the table's @check uses it indirectly via Prisma client codegen).
ALTER TYPE "public"."AuditAction" ADD VALUE IF NOT EXISTS 'workspace_access_granted';
ALTER TYPE "public"."AuditAction" ADD VALUE IF NOT EXISTS 'workspace_access_revoked';

CREATE TABLE "public"."workspace_access" (
  "id"             UUID        NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id"   UUID        NOT NULL,
  "membership_id"  UUID        NOT NULL,
  "client_id"      UUID,
  "project_id"     UUID,
  "created_by_id"  UUID        NOT NULL,
  "created_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "workspace_access_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workspace_access_workspace_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE,
  CONSTRAINT "workspace_access_membership_fkey"
    FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE CASCADE,
  CONSTRAINT "workspace_access_client_fkey"
    FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE,
  CONSTRAINT "workspace_access_project_fkey"
    FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE,
  CONSTRAINT "workspace_access_created_by_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT,
  -- Exactly one of client_id / project_id is non-null.
  CONSTRAINT "workspace_access_exactly_one_scope_chk" CHECK (
    (client_id IS NOT NULL AND project_id IS NULL) OR
    (client_id IS NULL AND project_id IS NOT NULL)
  )
);

-- Membership × client uniqueness, NULLs are distinct so each membership
-- can have many project-only rows alongside client-only rows.
CREATE UNIQUE INDEX "workspace_access_membership_client_uniq"
  ON "public"."workspace_access" ("membership_id", "client_id")
  WHERE "client_id" IS NOT NULL;

CREATE UNIQUE INDEX "workspace_access_membership_project_uniq"
  ON "public"."workspace_access" ("membership_id", "project_id")
  WHERE "project_id" IS NOT NULL;

CREATE INDEX "workspace_access_workspace_idx" ON "public"."workspace_access" ("workspace_id");
CREATE INDEX "workspace_access_membership_idx" ON "public"."workspace_access" ("membership_id");

-- Same-workspace integrity: the referenced client / project must live in
-- the same workspace as the Membership. We enforce via trigger because
-- Postgres CHECK can't span tables.
CREATE OR REPLACE FUNCTION public.workspace_access_same_workspace()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  m_ws uuid;
  res_ws uuid;
BEGIN
  SELECT workspace_id INTO m_ws FROM public.memberships WHERE id = NEW.membership_id;
  IF m_ws IS NULL OR m_ws <> NEW.workspace_id THEN
    RAISE EXCEPTION 'WORKSPACE_ACCESS_INVALID: membership belongs to a different workspace'
      USING ERRCODE = 'P0001';
  END IF;
  IF NEW.client_id IS NOT NULL THEN
    SELECT workspace_id INTO res_ws FROM public.clients WHERE id = NEW.client_id;
    IF res_ws IS NULL OR res_ws <> NEW.workspace_id THEN
      RAISE EXCEPTION 'WORKSPACE_ACCESS_INVALID: client belongs to a different workspace'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF NEW.project_id IS NOT NULL THEN
    SELECT workspace_id INTO res_ws FROM public.projects WHERE id = NEW.project_id;
    IF res_ws IS NULL OR res_ws <> NEW.workspace_id THEN
      RAISE EXCEPTION 'WORKSPACE_ACCESS_INVALID: project belongs to a different workspace'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_workspace_access_same_workspace ON public.workspace_access;
CREATE TRIGGER trg_workspace_access_same_workspace
  BEFORE INSERT OR UPDATE ON public.workspace_access
  FOR EACH ROW EXECUTE FUNCTION public.workspace_access_same_workspace();

-- Forbid Admin memberships from carrying scope rows (defence-in-depth;
-- the app guards this too).
CREATE OR REPLACE FUNCTION public.workspace_access_forbid_admin()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  m_role public."Role";
BEGIN
  SELECT role INTO m_role FROM public.memberships WHERE id = NEW.membership_id;
  IF m_role = 'admin'::public."Role" THEN
    RAISE EXCEPTION 'WORKSPACE_ACCESS_ADMIN_SCOPED: admin memberships cannot be scope-restricted'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_workspace_access_forbid_admin ON public.workspace_access;
CREATE TRIGGER trg_workspace_access_forbid_admin
  BEFORE INSERT OR UPDATE ON public.workspace_access
  FOR EACH ROW EXECUTE FUNCTION public.workspace_access_forbid_admin();

-- RLS: workspace-scoped reads + admin-only writes (matches integrations/audit).
ALTER TABLE "public"."workspace_access" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace_access_select" ON "public"."workspace_access"
  FOR SELECT USING (workspace_id = ANY (public.workspace_ids_for_current_user()));

CREATE POLICY "workspace_access_admin_insert" ON "public"."workspace_access"
  FOR INSERT WITH CHECK (public.is_workspace_admin(workspace_id));

CREATE POLICY "workspace_access_admin_update" ON "public"."workspace_access"
  FOR UPDATE USING (public.is_workspace_admin(workspace_id))
           WITH CHECK (public.is_workspace_admin(workspace_id));

CREATE POLICY "workspace_access_admin_delete" ON "public"."workspace_access"
  FOR DELETE USING (public.is_workspace_admin(workspace_id));
```

- [ ] **Step 3: Apply the migration**

Run: `pnpm --filter @nexushub/db prisma migrate deploy`

Expected: `Applying migration "20260516100001_workspace_access"` and `All migrations have been successfully applied.`

- [ ] **Step 4: Verify the table + triggers**

Run:

```bash
pnpm --filter @nexushub/db prisma db execute --stdin <<'SQL'
SELECT relname FROM pg_class WHERE relname = 'workspace_access';
SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.workspace_access'::regclass;
SELECT enumlabel FROM pg_enum WHERE enumtypid = '"public"."AuditAction"'::regtype AND enumlabel LIKE 'workspace_access%' ORDER BY enumlabel;
SQL
```

Expected output includes:

- `workspace_access`
- `trg_workspace_access_same_workspace`, `trg_workspace_access_forbid_admin`
- `workspace_access_granted`, `workspace_access_revoked`

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/migrations/20260516100001_workspace_access/
git commit -m "feat(db): workspace_access table + triggers + RLS + audit kinds"
```

---

## Task 2: `schema.prisma` + Prisma generate + domain scope module

This task is atomic: schema.prisma change + Prisma client regeneration + domain scope helpers + tests, all in one commit. The domain helpers have zero consumers yet, so no breaking type changes ripple out.

**Files:**

- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/domain/src/scope/index.ts`
- Create: `packages/domain/src/scope/scope.test.ts`

### Step 1: Add `WorkspaceAccess` to schema.prisma

- [ ] **Sub-step 1.1: Extend the `AuditAction` enum**

Find the `enum AuditAction { ... }` block (around line 110). Add the two new values **at the end** of the enum so existing positions don't shift:

```prisma
enum AuditAction {
  login_success
  login_failed
  password_reset
  invitation_created
  invitation_accepted
  invitation_revoked
  member_removed
  member_role_changed
  integration_connected
  integration_disconnected
  client_deleted
  project_deleted
  project_restored
  card_deleted
  encryption_key_rotated
  workspace_access_granted
  workspace_access_revoked
}
```

- [ ] **Sub-step 1.2: Add the `WorkspaceAccess` model**

Insert after the `Membership` model block (around line 203). Pick a stable location — directly after Membership keeps it visually grouped with workspace memberships.

```prisma
model WorkspaceAccess {
  id           String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  workspaceId  String   @map("workspace_id") @db.Uuid
  membershipId String   @map("membership_id") @db.Uuid
  clientId     String?  @map("client_id") @db.Uuid
  projectId    String?  @map("project_id") @db.Uuid
  createdById  String   @map("created_by_id") @db.Uuid
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  workspace  Workspace  @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  membership Membership @relation(fields: [membershipId], references: [id], onDelete: Cascade)
  client     Client?    @relation(fields: [clientId], references: [id], onDelete: Cascade)
  project    Project?   @relation(fields: [projectId], references: [id], onDelete: Cascade)
  createdBy  User       @relation("WorkspaceAccessCreatedBy", fields: [createdById], references: [id], onDelete: Restrict)

  @@index([workspaceId])
  @@index([membershipId])
  @@map("workspace_access")
}
```

- [ ] **Sub-step 1.3: Add back-relations on `Workspace`, `Membership`, `Client`, `Project`, `User`**

In each model, add the relation field. Examples:

`Workspace { ... workspaceAccess WorkspaceAccess[] ... }` (add the line just below the existing `memberships Membership[]`).

`Membership { ... workspaceAccess WorkspaceAccess[] ... }` (just below the existing `user` relation).

`Client { ... workspaceAccess WorkspaceAccess[] ... }` (just below the existing `projects` relation if any, otherwise near the bottom of the model).

`Project { ... workspaceAccess WorkspaceAccess[] ... }` (just below the existing `cards`/`columns` relations).

`User { ... workspaceAccessCreated WorkspaceAccess[] @relation("WorkspaceAccessCreatedBy") ... }` (just below the existing `invitationsCreated Invitation[] @relation("InvitationCreatedBy")` line for visual symmetry).

If a back-relation is missing, Prisma's `prisma generate` will fail with an explicit error pointing to the field — that's the signal.

- [ ] **Sub-step 1.4: Regenerate the Prisma client**

```bash
pnpm --filter @nexushub/db prisma generate
```

Expected: `✔ Generated Prisma Client (...)` with no errors.

If Prisma complains about missing back-relations, add them where it tells you, then re-run.

### Step 2: Domain scope module (test-first)

- [ ] **Sub-step 2.1: Write the failing tests**

File: `packages/domain/src/scope/scope.test.ts`

```typescript
import { describe, expect, it } from 'vitest';
import { evaluateScopeMatch, type UserScope } from './index';

const wsScope: UserScope = { kind: 'workspace' };
const restricted = (clientIds: string[] = [], projectIds: string[] = []): UserScope => ({
  kind: 'restricted',
  clientIds,
  projectIds,
});

describe('evaluateScopeMatch — full workspace', () => {
  it('admits any client', () => {
    expect(evaluateScopeMatch(wsScope, { kind: 'client', clientId: 'c-1' })).toBe(true);
  });
  it('admits any project regardless of its client', () => {
    expect(
      evaluateScopeMatch(wsScope, { kind: 'project', projectId: 'p-1', clientId: 'c-1' }),
    ).toBe(true);
  });
});

describe('evaluateScopeMatch — restricted', () => {
  it('admits a client listed in clientIds', () => {
    expect(evaluateScopeMatch(restricted(['c-1']), { kind: 'client', clientId: 'c-1' })).toBe(true);
  });
  it('rejects a client not listed', () => {
    expect(evaluateScopeMatch(restricted(['c-1']), { kind: 'client', clientId: 'c-2' })).toBe(
      false,
    );
  });
  it('admits a project whose own id is listed', () => {
    expect(
      evaluateScopeMatch(restricted([], ['p-1']), {
        kind: 'project',
        projectId: 'p-1',
        clientId: 'c-1',
      }),
    ).toBe(true);
  });
  it('admits a project whose client is listed even if the project id is not', () => {
    expect(
      evaluateScopeMatch(restricted(['c-1']), {
        kind: 'project',
        projectId: 'p-x',
        clientId: 'c-1',
      }),
    ).toBe(true);
  });
  it('rejects a project when neither its id nor its client is listed', () => {
    expect(
      evaluateScopeMatch(restricted(['c-1'], ['p-1']), {
        kind: 'project',
        projectId: 'p-other',
        clientId: 'c-other',
      }),
    ).toBe(false);
  });
  it('empty restricted scope rejects everything (Viewer with no shares)', () => {
    expect(evaluateScopeMatch(restricted(), { kind: 'client', clientId: 'c-1' })).toBe(false);
    expect(
      evaluateScopeMatch(restricted(), { kind: 'project', projectId: 'p-1', clientId: 'c-1' }),
    ).toBe(false);
  });
});
```

- [ ] **Sub-step 2.2: Run the test to verify it fails**

```bash
pnpm --filter @nexushub/domain test -- src/scope/scope.test.ts
```

Expected: FAIL with `Cannot find module './index'`.

- [ ] **Sub-step 2.3: Implement the domain module**

File: `packages/domain/src/scope/index.ts`

```typescript
/**
 * User-scope evaluation (PRD Phase B). Pure domain — no Prisma, no I/O.
 *
 * A Membership is "full workspace" by default (no `WorkspaceAccess` rows).
 * Adding rows narrows the scope to specific clients or projects.
 *
 * The Prisma where-builders that consume this module live in
 * `apps/web/lib/auth/scope.ts` — they call `loadUserScope` to fetch the
 * rows for a request, then translate the resulting `UserScope` into a
 * Prisma WhereInput partial.
 */

export type UserScope =
  | { readonly kind: 'workspace' }
  | {
      readonly kind: 'restricted';
      readonly clientIds: readonly string[];
      readonly projectIds: readonly string[];
    };

export type Resource =
  | { readonly kind: 'client'; readonly clientId: string }
  | { readonly kind: 'project'; readonly projectId: string; readonly clientId: string };

export function evaluateScopeMatch(scope: UserScope, resource: Resource): boolean {
  if (scope.kind === 'workspace') return true;
  if (resource.kind === 'client') return scope.clientIds.includes(resource.clientId);
  // project: matches if its own id is shared OR its parent client is shared.
  return (
    scope.projectIds.includes(resource.projectId) || scope.clientIds.includes(resource.clientId)
  );
}

export function isScopeRestricted(
  scope: UserScope,
): scope is Extract<UserScope, { kind: 'restricted' }> {
  return scope.kind === 'restricted';
}
```

- [ ] **Sub-step 2.4: Run the test to verify it passes**

```bash
pnpm --filter @nexushub/domain test -- src/scope/scope.test.ts
```

Expected: PASS (7 specs).

- [ ] **Sub-step 2.5: Export from the package entry**

Add to `packages/domain/src/index.ts` (find the existing re-exports near the top — e.g. `export * from './permissions';`). Insert:

```typescript
export * from './scope';
```

- [ ] **Sub-step 2.6: Add the subpath export in `packages/domain/package.json`**

Find the existing `exports` block. Add `./scope` after `./permissions`:

```json
"./scope": "./src/scope/index.ts"
```

- [ ] **Sub-step 2.7: Typecheck + full test suite**

```bash
pnpm --filter @nexushub/domain typecheck
pnpm test
```

Expected: all green. The new test adds 7 specs to the domain count.

### Step 3: Commit

- [ ] **Single atomic commit**

```bash
git add \
  packages/db/prisma/schema.prisma \
  packages/domain/src/scope/index.ts \
  packages/domain/src/scope/scope.test.ts \
  packages/domain/src/index.ts \
  packages/domain/package.json
git commit -m "feat(domain): WorkspaceAccess model + pure scope evaluator"
```

---

## Task 3: App-side scope loader + Prisma where-builders

The domain layer is pure. The app layer wraps it with one Prisma fetch + three where-builders that the page/action layer spreads into queries.

**Files:**

- Create: `apps/web/lib/auth/scope.ts`
- Create: `apps/web/lib/auth/scope.test.ts`

- [ ] **Step 1: Write the failing test**

File: `apps/web/lib/auth/scope.test.ts`

```typescript
import { describe, expect, it } from 'vitest';
import { scopeFromRows, scopedClientWhere, scopedProjectWhere, scopedCardWhere } from './scope';

describe('scopeFromRows', () => {
  it('returns workspace scope when there are no rows', () => {
    expect(scopeFromRows([])).toEqual({ kind: 'workspace' });
  });
  it('returns restricted with the union of client + project ids', () => {
    expect(
      scopeFromRows([
        { clientId: 'c-1', projectId: null },
        { clientId: null, projectId: 'p-1' },
        { clientId: 'c-2', projectId: null },
      ]),
    ).toEqual({ kind: 'restricted', clientIds: ['c-1', 'c-2'], projectIds: ['p-1'] });
  });
});

describe('scopedClientWhere', () => {
  it('returns {} for workspace scope (no overhead)', () => {
    expect(scopedClientWhere({ kind: 'workspace' })).toEqual({});
  });
  it('returns id-in for restricted with at least one client', () => {
    expect(scopedClientWhere({ kind: 'restricted', clientIds: ['c-1'], projectIds: [] })).toEqual({
      id: { in: ['c-1'] },
    });
  });
  it('restricted with no clientIds (only projects) returns clients reachable through projects', () => {
    expect(scopedClientWhere({ kind: 'restricted', clientIds: [], projectIds: ['p-1'] })).toEqual({
      projects: { some: { id: { in: ['p-1'] } } },
    });
  });
  it('restricted with both returns the OR of the two predicates', () => {
    expect(
      scopedClientWhere({ kind: 'restricted', clientIds: ['c-1'], projectIds: ['p-1'] }),
    ).toEqual({
      OR: [{ id: { in: ['c-1'] } }, { projects: { some: { id: { in: ['p-1'] } } } }],
    });
  });
});

describe('scopedProjectWhere', () => {
  it('returns {} for workspace scope', () => {
    expect(scopedProjectWhere({ kind: 'workspace' })).toEqual({});
  });
  it('returns id-in OR clientId-in for restricted', () => {
    expect(
      scopedProjectWhere({ kind: 'restricted', clientIds: ['c-1'], projectIds: ['p-1'] }),
    ).toEqual({ OR: [{ id: { in: ['p-1'] } }, { clientId: { in: ['c-1'] } }] });
  });
  it('only projects', () => {
    expect(scopedProjectWhere({ kind: 'restricted', clientIds: [], projectIds: ['p-1'] })).toEqual({
      id: { in: ['p-1'] },
    });
  });
  it('only clients', () => {
    expect(scopedProjectWhere({ kind: 'restricted', clientIds: ['c-1'], projectIds: [] })).toEqual({
      clientId: { in: ['c-1'] },
    });
  });
});

describe('scopedCardWhere', () => {
  it('returns {} for workspace scope', () => {
    expect(scopedCardWhere({ kind: 'workspace' })).toEqual({});
  });
  it('filters cards through their project relation', () => {
    expect(
      scopedCardWhere({ kind: 'restricted', clientIds: ['c-1'], projectIds: ['p-1'] }),
    ).toEqual({
      project: { OR: [{ id: { in: ['p-1'] } }, { clientId: { in: ['c-1'] } }] },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @nexushub/web test -- lib/auth/scope.test.ts
```

Expected: FAIL with module not found.

- [ ] **Step 3: Implement `scope.ts`**

File: `apps/web/lib/auth/scope.ts`

```typescript
import 'server-only';
import type { Prisma } from '@nexushub/db';
import { prisma } from '@nexushub/db';
import { type UserScope } from '@nexushub/domain';
import type { AuthContext } from './index';

interface ScopeRow {
  readonly clientId: string | null;
  readonly projectId: string | null;
}

/**
 * Build a UserScope from raw WorkspaceAccess rows. Pure — extracted so
 * tests don't need a Prisma harness.
 */
export function scopeFromRows(rows: readonly ScopeRow[]): UserScope {
  if (rows.length === 0) return { kind: 'workspace' };
  const clientIds: string[] = [];
  const projectIds: string[] = [];
  for (const r of rows) {
    if (r.clientId) clientIds.push(r.clientId);
    if (r.projectId) projectIds.push(r.projectId);
  }
  return { kind: 'restricted', clientIds, projectIds };
}

/**
 * Load the effective scope for the current Membership. Admin and
 * super-admin bypass: always full workspace regardless of any stray rows.
 *
 * Memoised per-request via a WeakMap keyed on the AuthContext object so
 * repeated calls inside a single page render hit Prisma at most once.
 */
const cache = new WeakMap<AuthContext, Promise<UserScope>>();

export async function loadUserScope(ctx: AuthContext): Promise<UserScope> {
  if (ctx.isSuperAdmin || ctx.role === 'admin') return { kind: 'workspace' };
  const cached = cache.get(ctx);
  if (cached) return cached;
  const promise = (async (): Promise<UserScope> => {
    const rows = await prisma.workspaceAccess.findMany({
      where: { workspaceId: ctx.workspaceId, membership: { userId: ctx.userId } },
      select: { clientId: true, projectId: true },
    });
    return scopeFromRows(rows);
  })();
  cache.set(ctx, promise);
  return promise;
}

// ---------- Prisma where-builders ---------------------------------------

export function scopedClientWhere(scope: UserScope): Prisma.ClientWhereInput {
  if (scope.kind === 'workspace') return {};
  const haveClients = scope.clientIds.length > 0;
  const haveProjects = scope.projectIds.length > 0;
  if (haveClients && haveProjects) {
    return {
      OR: [
        { id: { in: [...scope.clientIds] } },
        { projects: { some: { id: { in: [...scope.projectIds] } } } },
      ],
    };
  }
  if (haveClients) return { id: { in: [...scope.clientIds] } };
  if (haveProjects) return { projects: { some: { id: { in: [...scope.projectIds] } } } };
  // Restricted with zero rows = sees nothing.
  return { id: { in: [] } };
}

export function scopedProjectWhere(scope: UserScope): Prisma.ProjectWhereInput {
  if (scope.kind === 'workspace') return {};
  const haveClients = scope.clientIds.length > 0;
  const haveProjects = scope.projectIds.length > 0;
  if (haveClients && haveProjects) {
    return {
      OR: [{ id: { in: [...scope.projectIds] } }, { clientId: { in: [...scope.clientIds] } }],
    };
  }
  if (haveProjects) return { id: { in: [...scope.projectIds] } };
  if (haveClients) return { clientId: { in: [...scope.clientIds] } };
  return { id: { in: [] } };
}

export function scopedCardWhere(scope: UserScope): Prisma.CardWhereInput {
  if (scope.kind === 'workspace') return {};
  const inner = scopedProjectWhere(scope);
  // scopedProjectWhere can return { id: { in: [] } } — preserve by spreading inside
  // the `project` relation predicate.
  return { project: inner };
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @nexushub/web test -- lib/auth/scope.test.ts
```

Expected: PASS (12 specs).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/auth/scope.ts apps/web/lib/auth/scope.test.ts
git commit -m "feat(auth): scope loader + Prisma where-builders for WorkspaceAccess"
```

---

## Task 4: Apply scope to read paths

Spread the scoped where helpers into list queries on the three workspace-level pages plus the project sub-routes (single-resource guard via `notFound()`).

**Files:**

- Modify: `apps/web/app/(app)/projects/page.tsx`
- Modify: `apps/web/app/(app)/clients/page.tsx`
- Modify: `apps/web/app/(app)/overview/page.tsx`
- Modify: `apps/web/app/(app)/projects/[id]/page.tsx`
- Modify: `apps/web/app/(app)/projects/[id]/list/page.tsx`
- Modify: `apps/web/app/(app)/projects/[id]/calendar/page.tsx`
- Modify: `apps/web/features/clients/lib/index.ts` (or wherever `listClients` lives)

- [ ] **Step 1: List pages — projects, clients, overview**

For each of the three pages, do:

a) Add the import:

```typescript
import { loadUserScope, scopedProjectWhere, scopedClientWhere } from '@/lib/auth/scope';
```

b) After `const ctx = await requireUser()`, add:

```typescript
const scope = await loadUserScope(ctx);
```

c) In list queries that read `Project`, spread `scopedProjectWhere(scope)`:

```typescript
prisma.project.findMany({
  where: { workspaceId: ctx.workspaceId, deletedAt: null, ...scopedProjectWhere(scope) },
  // ...
});
```

Same pattern for `prisma.client.findMany` using `scopedClientWhere(scope)`.

d) `listClients(ctx.workspaceId)` helper in `apps/web/features/clients/lib/index.ts`:

Find the existing signature:

```typescript
export function listClients(workspaceId: string) {
  return prisma.client.findMany({
    where: { workspaceId, deletedAt: null },
    // ...
  });
}
```

Replace with an overload that accepts an optional scope:

```typescript
import type { UserScope } from '@nexushub/domain';
import { scopedClientWhere } from '@/lib/auth/scope';

export function listClients(workspaceId: string, scope?: UserScope) {
  return prisma.client.findMany({
    where: {
      workspaceId,
      deletedAt: null,
      ...(scope ? scopedClientWhere(scope) : {}),
    },
    // ...keep existing select/orderBy
  });
}
```

Then every caller of `listClients` becomes `listClients(ctx.workspaceId, scope)`.

- [ ] **Step 2: Single-project pages — 404 if out of scope**

In each of the three `/projects/[id]/*` pages, after the existing `prisma.project.findFirst({ where: { id, workspaceId: ctx.workspaceId, deletedAt: null }, ... })`, replace:

```typescript
if (!project) notFound();
```

with:

```typescript
if (!project) notFound();
if (scope.kind === 'restricted') {
  const allowed =
    scope.projectIds.includes(project.id) ||
    (project.client?.id && scope.clientIds.includes(project.client.id));
  if (!allowed) notFound();
}
```

(`scope` comes from `loadUserScope(ctx)` near the top of the page. Use the alphabetized import.)

- [ ] **Step 3: Single-client page (if a route `/clients/[slug]` exists)**

Check `apps/web/app/(app)/clients/page.tsx` (the current client list / detail might be on the same page; if so, gate the selected client based on scope using the same pattern).

```typescript
if (selectedClient && scope.kind === 'restricted') {
  const allowed = scope.clientIds.includes(selectedClient.id);
  if (!allowed) notFound();
}
```

- [ ] **Step 4: Typecheck + lint + tests**

```bash
pnpm --filter @nexushub/web typecheck
pnpm --filter @nexushub/web lint
pnpm test
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add \
  "apps/web/app/(app)/projects/page.tsx" \
  "apps/web/app/(app)/clients/page.tsx" \
  "apps/web/app/(app)/overview/page.tsx" \
  "apps/web/app/(app)/projects/[id]/page.tsx" \
  "apps/web/app/(app)/projects/[id]/list/page.tsx" \
  "apps/web/app/(app)/projects/[id]/calendar/page.tsx" \
  apps/web/features/clients/lib/index.ts
git commit -m "feat(web): apply scope helpers to read paths (lists + single-resource guards)"
```

---

## Task 5: Apply scope to mutating server actions

Every server action that creates or modifies a Client / Project / Card must check that the actor's scope permits the operation. Pattern: load the scope once, evaluate against the resource being touched, return an error result if out of scope.

Touch list (use `grep -rln "requireUser()" apps/web/features` to confirm the full set):

- `apps/web/features/clients/actions/create-client.ts`
- `apps/web/features/clients/actions/update-client.ts`
- `apps/web/features/clients/actions/delete-client.ts`
- `apps/web/features/clients/actions/create-contact.ts`
- `apps/web/features/clients/actions/delete-contact.ts`
- `apps/web/features/projects/actions/create-project.ts`
- `apps/web/features/projects/actions/delete-project.ts`
- `apps/web/features/projects/actions/create-card.ts`
- `apps/web/features/projects/actions/move-card.ts`
- `apps/web/features/projects/actions/update-card.ts`
- `apps/web/features/projects/actions/update-card-due-date.ts`
- `apps/web/features/projects/actions/delete-card.ts`
- `apps/web/features/projects/actions/change-card-template.ts`
- `apps/web/features/projects/actions/skip-card-to-next-column.ts`
- `apps/web/features/projects/actions/advance-card.ts`
- `apps/web/features/projects/actions/card-assignees.ts`
- `apps/web/features/projects/actions/checklist.ts`

- [ ] **Step 1: Create a tiny domain helper for the scope-error message**

File: `apps/web/features/projects/lib/scope-error.ts` (new — used by both projects and clients actions; the location is a pragmatic place since it doesn't cleanly belong to either feature folder, and `projects/lib/` already houses similar cross-cutting helpers like `card-filter.ts`).

```typescript
export const SCOPE_ERROR_MESSAGE = "Cette ressource n'est pas accessible avec ton scope actuel.";
```

- [ ] **Step 2: Pattern for client-targeting actions (`create-client`, `create-contact`, etc.)**

Add the imports:

```typescript
import { loadUserScope, scopedClientWhere } from '@/lib/auth/scope';
import { SCOPE_ERROR_MESSAGE } from '@/features/projects/lib/scope-error';
```

In `createClient` (which creates a brand-new client), the scope check must reject restricted users from creating ANY client (they can't create resources outside their scope, and "creating a new client" implicitly adds a resource to the workspace that's not in their scope):

```typescript
const scope = await loadUserScope(ctx);
if (scope.kind === 'restricted') {
  return { status: 'error', message: SCOPE_ERROR_MESSAGE };
}
```

For `updateClient`, `deleteClient`, `createContact`, `deleteContact` (which operate on an EXISTING client), check whether the target client is in scope:

```typescript
const scope = await loadUserScope(ctx);
if (scope.kind === 'restricted') {
  const allowed = scope.clientIds.includes(clientId);
  if (!allowed) {
    return { status: 'error', message: SCOPE_ERROR_MESSAGE };
  }
}
```

- [ ] **Step 3: Pattern for project-targeting actions**

For `createProject`, check the target `clientId` against the scope (the new project goes under that client):

```typescript
const scope = await loadUserScope(ctx);
if (scope.kind === 'restricted') {
  const allowed = scope.clientIds.includes(parsed.data.clientId);
  if (!allowed) {
    return { status: 'error', message: SCOPE_ERROR_MESSAGE };
  }
}
```

For `deleteProject`, `updateProject`, fetch the project's `clientId` then check:

```typescript
const project = await prisma.project.findFirst({
  where: { id: projectId, workspaceId: ctx.workspaceId, deletedAt: null },
  select: { id: true, clientId: true },
});
if (!project) {
  return { status: 'error', message: 'Projet introuvable.' };
}
const scope = await loadUserScope(ctx);
if (scope.kind === 'restricted') {
  const allowed =
    scope.projectIds.includes(project.id) || scope.clientIds.includes(project.clientId);
  if (!allowed) {
    return { status: 'error', message: SCOPE_ERROR_MESSAGE };
  }
}
```

- [ ] **Step 4: Pattern for card-targeting actions**

All card mutations (`create-card`, `move-card`, `update-card`, etc.) reference a card via `cardId`. Pattern:

```typescript
const card = await prisma.card.findFirst({
  where: { id: cardId, workspaceId: ctx.workspaceId, deletedAt: null },
  select: { id: true, projectId: true, project: { select: { clientId: true } } },
});
if (!card) throw new NotFoundError('Card');

const scope = await loadUserScope(ctx);
if (scope.kind === 'restricted') {
  const allowed =
    scope.projectIds.includes(card.projectId) || scope.clientIds.includes(card.project.clientId);
  if (!allowed) {
    return { ok: false, message: SCOPE_ERROR_MESSAGE };
  }
}
```

Adjust the return shape to match each action's existing error type (`{ status: 'error' }` for Server Actions returning `State`, `{ ok: false }` for plain JSON actions like `moveCard`).

- [ ] **Step 5: For `createCard`**, the action takes `projectId` + `columnId` directly. Look up the project first:

```typescript
const project = await prisma.project.findFirst({
  where: { id: parsed.data.projectId, workspaceId: ctx.workspaceId, deletedAt: null },
  select: { id: true, clientId: true },
});
if (!project) return { status: 'error', message: 'Projet introuvable.' };

const scope = await loadUserScope(ctx);
if (scope.kind === 'restricted') {
  const allowed =
    scope.projectIds.includes(project.id) || scope.clientIds.includes(project.clientId);
  if (!allowed) {
    return { status: 'error', message: SCOPE_ERROR_MESSAGE };
  }
}
```

- [ ] **Step 6: Typecheck + lint + full test suite**

```bash
pnpm --filter @nexushub/web typecheck
pnpm --filter @nexushub/web lint
pnpm test
```

Expected: all green. **If existing tests for these actions break** (they may not mock the new `prisma.workspaceAccess.findMany` call), add to each affected `beforeEach` block:

```typescript
mocks.workspaceAccessFindMany = vi.fn().mockResolvedValue([]);
```

Plus in the `vi.mock('@nexushub/db', () => ({ prisma: { ... } }))` block, add:

```typescript
workspaceAccess: { findMany: mocks.workspaceAccessFindMany },
```

This makes the existing test's `requireUser()` mock return a context whose `loadUserScope` call sees zero rows → full workspace scope → all tests stay green.

- [ ] **Step 7: Commit**

```bash
git add \
  apps/web/features/projects/lib/scope-error.ts \
  apps/web/features/clients/actions/ \
  apps/web/features/projects/actions/
# Plus any test files updated to mock workspaceAccess.findMany.
git commit -m "feat(web): scope checks on every Client + Project + Card mutation"
```

---

## Task 6: `setUserScope` server action + `/team` scope UI

**Files:**

- Create: `apps/web/features/team/actions/set-user-scope.ts`
- Create: `apps/web/features/team/actions/set-user-scope.test.ts`
- Create: `apps/web/features/team/components/scope-chip.tsx`
- Create: `apps/web/features/team/components/scope-modal.tsx`
- Modify: `apps/web/features/team/components/member-row.tsx`
- Modify: `apps/web/app/(app)/team/page.tsx`

### Step 1: `setUserScope` server action

- [ ] **Sub-step 1.1: Write the schemas + action**

File: `apps/web/features/team/actions/set-user-scope.ts`

```typescript
'use server';
import 'server-only';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { z } from 'zod';
import { prisma } from '@nexushub/db';
import { Roles } from '@nexushub/domain';
import { requireAdmin } from '@/lib/auth';
import { assertCsrfFromFormData } from '@/lib/csrf';
import { recordAudit } from '@/lib/audit';
import { getClientIp } from '@/lib/rate-limit';

const Schema = z.object({
  membershipId: z.string().uuid(),
  /** Comma-separated list of client UUIDs to grant. Empty = clear all. */
  clientIds: z.string().optional(),
  /** Comma-separated list of project UUIDs to grant. Empty = clear all. */
  projectIds: z.string().optional(),
  /** When true, removes ALL existing rows (used for "Reset to full workspace"). */
  clearAll: z.string().optional(),
});

export type SetScopeState =
  | { readonly status: 'idle' }
  | { readonly status: 'success' }
  | { readonly status: 'error'; readonly message: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseUuidList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => UUID_RE.test(s));
}

export async function setUserScope(
  _prev: SetScopeState,
  formData: FormData,
): Promise<SetScopeState> {
  await assertCsrfFromFormData(formData);
  const ctx = await requireAdmin();

  const parsed = Schema.safeParse({
    membershipId: formData.get('membershipId'),
    clientIds: formData.get('clientIds') ?? undefined,
    projectIds: formData.get('projectIds') ?? undefined,
    clearAll: formData.get('clearAll') ?? undefined,
  });
  if (!parsed.success) {
    return { status: 'error', message: 'Données invalides.' };
  }

  const target = await prisma.membership.findUnique({
    where: { id: parsed.data.membershipId },
    select: { workspaceId: true, role: true, userId: true },
  });
  if (!target || target.workspaceId !== ctx.workspaceId) {
    return { status: 'error', message: 'Membre introuvable.' };
  }
  if (target.role === Roles.Admin) {
    return { status: 'error', message: 'Un Admin ne peut pas être restreint.' };
  }

  const clientIds = parseUuidList(parsed.data.clientIds);
  const projectIds = parseUuidList(parsed.data.projectIds);
  const clearAll = parsed.data.clearAll === '1';

  const reqHeaders = await headers();
  const ip = getClientIp(reqHeaders);
  const ua = reqHeaders.get('user-agent') ?? null;

  await prisma.$transaction(async (tx) => {
    // Replace strategy: delete all existing rows for this membership in
    // the workspace, then insert the new set. Simpler than diffing and
    // correct for the "set scope" use case.
    await tx.workspaceAccess.deleteMany({
      where: { workspaceId: ctx.workspaceId, membershipId: parsed.data.membershipId },
    });

    if (clearAll || (clientIds.length === 0 && projectIds.length === 0)) {
      return;
    }

    const rows = [
      ...clientIds.map((clientId) => ({
        workspaceId: ctx.workspaceId,
        membershipId: parsed.data.membershipId,
        clientId,
        projectId: null,
        createdById: ctx.userId,
      })),
      ...projectIds.map((projectId) => ({
        workspaceId: ctx.workspaceId,
        membershipId: parsed.data.membershipId,
        clientId: null,
        projectId,
        createdById: ctx.userId,
      })),
    ];
    if (rows.length > 0) {
      await tx.workspaceAccess.createMany({ data: rows });
    }
  });

  await recordAudit({
    action:
      clearAll || (clientIds.length === 0 && projectIds.length === 0)
        ? 'workspace_access_revoked'
        : 'workspace_access_granted',
    workspaceId: ctx.workspaceId,
    actorId: ctx.userId,
    subjectType: 'membership',
    subjectId: parsed.data.membershipId,
    data: { clientIds, projectIds, clearAll },
    ip,
    userAgent: ua,
  });

  revalidatePath('/team');
  return { status: 'success' };
}
```

- [ ] **Sub-step 1.2: Write tests**

File: `apps/web/features/team/actions/set-user-scope.test.ts`

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  membershipFindUnique: vi.fn(),
  waDeleteMany: vi.fn(),
  waCreateMany: vi.fn(),
  prismaTransaction: vi.fn(),
  requireAdmin: vi.fn(),
  assertCsrf: vi.fn(),
  recordAudit: vi.fn(),
  revalidatePath: vi.fn(),
  getClientIp: vi.fn(() => '127.0.0.1'),
}));

vi.mock('@nexushub/db', () => ({
  prisma: {
    membership: { findUnique: mocks.membershipFindUnique },
    workspaceAccess: { deleteMany: mocks.waDeleteMany, createMany: mocks.waCreateMany },
    $transaction: (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        workspaceAccess: { deleteMany: mocks.waDeleteMany, createMany: mocks.waCreateMany },
      }),
  },
}));
vi.mock('@/lib/auth', () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock('@/lib/csrf', () => ({ assertCsrfFromFormData: mocks.assertCsrf }));
vi.mock('@/lib/audit', () => ({ recordAudit: mocks.recordAudit }));
vi.mock('@/lib/rate-limit', () => ({ getClientIp: mocks.getClientIp }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));

import { setUserScope } from './set-user-scope';

const UUID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function fd(overrides: Record<string, string | undefined>): FormData {
  const f = new FormData();
  f.set('membershipId', UUID);
  for (const [k, v] of Object.entries(overrides)) if (v !== undefined) f.set(k, v);
  return f;
}

beforeEach(() => {
  for (const m of Object.values(mocks)) (m as { mockReset?: () => void }).mockReset?.();
  mocks.requireAdmin.mockResolvedValue({
    userId: 'admin-1',
    workspaceId: 'ws-1',
    role: 'admin',
    isSuperAdmin: false,
    email: 'admin@test',
  });
  mocks.membershipFindUnique.mockResolvedValue({
    workspaceId: 'ws-1',
    role: 'user',
    userId: 'other',
  });
});

describe('setUserScope', () => {
  it('replaces rows with a new set when given client + project UUIDs', async () => {
    const c = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    const p = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    const res = await setUserScope({ status: 'idle' }, fd({ clientIds: c, projectIds: p }));
    expect(res).toEqual({ status: 'success' });
    expect(mocks.waDeleteMany).toHaveBeenCalledOnce();
    expect(mocks.waCreateMany).toHaveBeenCalledOnce();
    expect(mocks.waCreateMany.mock.calls[0][0].data).toHaveLength(2);
  });

  it('clearAll=1 wipes rows and inserts nothing', async () => {
    const res = await setUserScope({ status: 'idle' }, fd({ clearAll: '1' }));
    expect(res.status).toBe('success');
    expect(mocks.waDeleteMany).toHaveBeenCalledOnce();
    expect(mocks.waCreateMany).not.toHaveBeenCalled();
  });

  it('refuses to scope an Admin membership', async () => {
    mocks.membershipFindUnique.mockResolvedValueOnce({
      workspaceId: 'ws-1',
      role: 'admin',
      userId: 'x',
    });
    const c = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    const res = await setUserScope({ status: 'idle' }, fd({ clientIds: c }));
    expect(res).toEqual({ status: 'error', message: 'Un Admin ne peut pas être restreint.' });
  });

  it('refuses to touch a membership of a different workspace', async () => {
    mocks.membershipFindUnique.mockResolvedValueOnce({
      workspaceId: 'ws-other',
      role: 'user',
      userId: 'x',
    });
    const res = await setUserScope({ status: 'idle' }, fd({}));
    expect(res).toMatchObject({ status: 'error' });
  });

  it('drops malformed UUIDs in the CSV silently', async () => {
    const res = await setUserScope({ status: 'idle' }, fd({ clientIds: 'not-a-uuid,also-bad' }));
    expect(res.status).toBe('success');
    expect(mocks.waCreateMany).not.toHaveBeenCalled(); // no valid IDs → no insert
  });
});
```

- [ ] **Sub-step 1.3: Run tests**

```bash
pnpm --filter @nexushub/web test -- features/team/actions/set-user-scope.test.ts
```

Expected: PASS (5 specs).

### Step 2: Scope chip + scope modal components

- [ ] **Sub-step 2.1: Create `scope-chip.tsx`**

File: `apps/web/features/team/components/scope-chip.tsx`

```tsx
'use client';
import type { UserScope } from '@nexushub/domain';

export interface ScopeChipProps {
  readonly scope: UserScope;
  readonly onClick?: () => void;
}

export function ScopeChip({ scope, onClick }: ScopeChipProps) {
  const label =
    scope.kind === 'workspace'
      ? 'Tout le workspace'
      : `${scope.clientIds.length} client${scope.clientIds.length > 1 ? 's' : ''} + ${scope.projectIds.length} projet${scope.projectIds.length > 1 ? 's' : ''}`;
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-full border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] px-2.5 py-1 text-[11px] font-semibold text-[color:var(--color-text-soft)] hover:text-[color:var(--color-text-main)]"
    >
      <span aria-hidden="true">🎯</span>
      {label}
    </button>
  );
}
```

- [ ] **Sub-step 2.2: Create `scope-modal.tsx`**

File: `apps/web/features/team/components/scope-modal.tsx`

```tsx
'use client';
import { useActionState, useEffect, useState } from 'react';
import { CSRF_FIELD_NAME } from '@/lib/csrf/field';
import { setUserScope, type SetScopeState } from '../actions/set-user-scope';

interface ClientOption {
  readonly id: string;
  readonly name: string;
}
interface ProjectOption {
  readonly id: string;
  readonly name: string;
  readonly clientName: string;
}

export interface ScopeModalProps {
  readonly csrfToken: string;
  readonly membershipId: string;
  readonly memberName: string;
  readonly initialClientIds: readonly string[];
  readonly initialProjectIds: readonly string[];
  readonly clientOptions: readonly ClientOption[];
  readonly projectOptions: readonly ProjectOption[];
  readonly onClose: () => void;
}

const idle: SetScopeState = { status: 'idle' };

export function ScopeModal({
  csrfToken,
  membershipId,
  memberName,
  initialClientIds,
  initialProjectIds,
  clientOptions,
  projectOptions,
  onClose,
}: ScopeModalProps) {
  const [state, action, pending] = useActionState(setUserScope, idle);
  const [clientIds, setClientIds] = useState<readonly string[]>(initialClientIds);
  const [projectIds, setProjectIds] = useState<readonly string[]>(initialProjectIds);

  useEffect(() => {
    if (state.status === 'success') onClose();
  }, [state.status, onClose]);

  const toggleClient = (id: string) =>
    setClientIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const toggleProject = (id: string) =>
    setProjectIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="scope-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="w-full max-w-2xl rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-6 shadow-2xl">
        <h2 id="scope-modal-title" className="text-xl font-extrabold tracking-tight">
          Scope de {memberName}
        </h2>
        <p className="mt-1 text-sm text-[color:var(--color-text-muted)]">
          Coche les clients ou projets auxquels ce user doit avoir accès. Aucune coche = accès à
          tout le workspace.
        </p>

        <form action={action} className="mt-4">
          <input type="hidden" name={CSRF_FIELD_NAME} value={csrfToken} />
          <input type="hidden" name="membershipId" value={membershipId} />
          <input type="hidden" name="clientIds" value={clientIds.join(',')} />
          <input type="hidden" name="projectIds" value={projectIds.join(',')} />

          <div className="grid grid-cols-2 gap-4">
            <section>
              <h3 className="mb-2 text-[11px] font-extrabold uppercase tracking-[1px] text-[color:var(--color-text-muted)]">
                Clients ({clientIds.length})
              </h3>
              <ul className="max-h-72 overflow-y-auto rounded-xl border border-[color:var(--color-border-light)] p-2">
                {clientOptions.map((c) => (
                  <li key={c.id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-[color:var(--color-bg-muted)]">
                      <input
                        type="checkbox"
                        checked={clientIds.includes(c.id)}
                        onChange={() => toggleClient(c.id)}
                        className="accent-[color:var(--color-accent-primary)]"
                      />
                      {c.name}
                    </label>
                  </li>
                ))}
              </ul>
            </section>

            <section>
              <h3 className="mb-2 text-[11px] font-extrabold uppercase tracking-[1px] text-[color:var(--color-text-muted)]">
                Projets spécifiques ({projectIds.length})
              </h3>
              <ul className="max-h-72 overflow-y-auto rounded-xl border border-[color:var(--color-border-light)] p-2">
                {projectOptions.map((p) => (
                  <li key={p.id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-[color:var(--color-bg-muted)]">
                      <input
                        type="checkbox"
                        checked={projectIds.includes(p.id)}
                        onChange={() => toggleProject(p.id)}
                        className="accent-[color:var(--color-accent-primary)]"
                      />
                      <span className="flex flex-col">
                        <span>{p.name}</span>
                        <span className="text-[10px] text-[color:var(--color-text-muted)]">
                          {p.clientName}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          {state.status === 'error' ? (
            <p
              role="alert"
              className="mt-3 rounded-md border border-[color:var(--color-danger)] bg-[color:var(--color-danger-bg)] px-3 py-2 text-sm font-medium text-[color:var(--color-danger)]"
            >
              {state.message}
            </p>
          ) : null}

          <div className="mt-5 flex items-center justify-between">
            <button
              type="submit"
              name="clearAll"
              value="1"
              className="btn btn-ghost btn-sm"
              disabled={pending}
            >
              Réinitialiser (tout le workspace)
            </button>
            <div className="flex items-center gap-2">
              <button type="button" onClick={onClose} className="btn btn-ghost btn-sm">
                Annuler
              </button>
              <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>
                {pending ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
```

### Step 3: Wire chip + modal into `member-row` + `/team` page

- [ ] **Sub-step 3.1: `member-row.tsx` — accept new props + open modal on chip click**

File: `apps/web/features/team/components/member-row.tsx`

Find the `MemberRowProps` interface and add the scope-related fields:

```typescript
import type { UserScope } from '@nexushub/domain';

export interface MemberRowProps {
  readonly csrfToken: string;
  readonly membershipId: string;
  readonly userId: string;
  readonly currentUserId: string;
  readonly displayName: string;
  readonly email: string;
  readonly role: 'admin' | 'user' | 'viewer';
  readonly isSuperAdmin: boolean;
  /** undefined for Admin (no scope possible). Otherwise the current scope. */
  readonly scope?: UserScope;
  /** Lookups passed through to the scope modal when opened. */
  readonly clientOptions: readonly { id: string; name: string }[];
  readonly projectOptions: readonly { id: string; name: string; clientName: string }[];
}
```

At the top of the component body, add modal state:

```typescript
import { useState } from 'react';
import { ScopeChip } from './scope-chip';
import { ScopeModal } from './scope-modal';

// ...inside the component:
const [scopeModalOpen, setScopeModalOpen] = useState(false);
```

In the JSX, between the existing email line and the role select, insert:

```tsx
{
  props.scope ? <ScopeChip scope={props.scope} onClick={() => setScopeModalOpen(true)} /> : null;
}
```

At the very end of the returned `<li>` (just before `</li>`), insert:

```tsx
{
  scopeModalOpen ? (
    <ScopeModal
      csrfToken={props.csrfToken}
      membershipId={props.membershipId}
      memberName={props.displayName}
      initialClientIds={props.scope?.kind === 'restricted' ? props.scope.clientIds : []}
      initialProjectIds={props.scope?.kind === 'restricted' ? props.scope.projectIds : []}
      clientOptions={props.clientOptions}
      projectOptions={props.projectOptions}
      onClose={() => setScopeModalOpen(false)}
    />
  ) : null;
}
```

- [ ] **Sub-step 3.2: `/team/page.tsx` — fetch scope rows + pass to rows**

File: `apps/web/app/(app)/team/page.tsx`

Extend the `Promise.all` to fetch `workspaceAccess` rows + the lookup options for the modal. Replace the existing block:

```typescript
const [members, invitations] = await Promise.all([...]);
```

with:

```typescript
const [members, invitations, accessRows, clientOptions, projectOptions] = await Promise.all([
  prisma.membership.findMany({
    where: { workspaceId: ctx.workspaceId },
    orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      role: true,
      userId: true,
      user: {
        select: { firstName: true, lastName: true, email: true, isSuperAdmin: true },
      },
    },
  }),
  prisma.invitation.findMany({
    where: { workspaceId: ctx.workspaceId, status: 'pending' },
    orderBy: { createdAt: 'desc' },
    select: { id: true, email: true, role: true, expiresAt: true },
  }),
  prisma.workspaceAccess.findMany({
    where: { workspaceId: ctx.workspaceId },
    select: { membershipId: true, clientId: true, projectId: true },
  }),
  prisma.client.findMany({
    where: { workspaceId: ctx.workspaceId, deletedAt: null },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  }),
  prisma.project.findMany({
    where: { workspaceId: ctx.workspaceId, deletedAt: null },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, client: { select: { name: true } } },
  }),
]);

// Group access rows by membershipId so each MemberRow gets its own scope.
const scopeByMembership = new Map<string, { clientIds: string[]; projectIds: string[] }>();
for (const r of accessRows) {
  const cur = scopeByMembership.get(r.membershipId) ?? { clientIds: [], projectIds: [] };
  if (r.clientId) cur.clientIds.push(r.clientId);
  if (r.projectId) cur.projectIds.push(r.projectId);
  scopeByMembership.set(r.membershipId, cur);
}

const projectOptionsShaped = projectOptions.map((p) => ({
  id: p.id,
  name: p.name,
  clientName: p.client.name,
}));
```

Then in the `<MemberRow>` JSX, add the new props:

```tsx
<MemberRow
  key={m.id}
  csrfToken={csrf}
  membershipId={m.id}
  userId={m.userId}
  currentUserId={ctx.userId}
  displayName={displayName}
  email={m.user.email}
  role={m.role}
  isSuperAdmin={m.user.isSuperAdmin}
  scope={
    m.role === 'admin'
      ? undefined
      : (() => {
          const rows = scopeByMembership.get(m.id);
          if (!rows) return { kind: 'workspace' as const };
          return {
            kind: 'restricted' as const,
            clientIds: rows.clientIds,
            projectIds: rows.projectIds,
          };
        })()
  }
  clientOptions={clientOptions}
  projectOptions={projectOptionsShaped}
/>
```

- [ ] **Sub-step 3.3: Typecheck + lint + tests**

```bash
pnpm --filter @nexushub/web typecheck
pnpm --filter @nexushub/web lint
pnpm test
```

Expected: green.

- [ ] **Sub-step 3.4: Commit**

```bash
git add \
  apps/web/features/team/actions/set-user-scope.ts \
  apps/web/features/team/actions/set-user-scope.test.ts \
  apps/web/features/team/components/scope-chip.tsx \
  apps/web/features/team/components/scope-modal.tsx \
  apps/web/features/team/components/member-row.tsx \
  "apps/web/app/(app)/team/page.tsx"
git commit -m "feat(team): setUserScope action + scope chip + scope modal in /team"
```

---

## Task 7: Invitation form — scope picker (User only)

When inviting a User, the Admin can optionally pre-set the new member's scope. Viewer remains disabled in Plan B.1 (B.2 unlocks it with a required scope picker).

**Files:**

- Create: `apps/web/features/invitations/actions/create-invitation-with-scope.ts` — NO, we extend the existing action.
- Modify: `apps/web/features/invitations/actions/create-invitation.ts`
- Modify: `apps/web/features/team/components/invitation-form.tsx`

- [ ] **Step 1: Extend `createInvitation` Zod schema + apply scope after the invitation is consumed**

The current `createInvitation` mints the invitation but doesn't create the Membership — that happens on `acceptInvitation`. Scope must therefore be **carried on the invitation row** until acceptance.

For Plan B.1, the simplest approach: store the scope as a JSON column on the existing `Invitation` table. This requires a schema migration.

**Decision (YAGNI):** Plan B.1 does NOT persist initial scope on the invitation. The flow is:

1. Admin invites the User (no scope).
2. User accepts → Membership created with full workspace.
3. Admin opens `/team`, clicks the user's scope chip, sets the scope via the modal.

This costs the Admin one extra click but avoids a schema change + acceptance-side wiring. **Tracked as a B.2 enhancement** if users find it annoying.

So Step 1 is **a no-op** for the action. The invitation form's UI is unchanged in this plan from Phase A (Viewer disabled, no scope picker yet).

- [ ] **Step 2: Document the decision in the invitation form helper text**

File: `apps/web/features/team/components/invitation-form.tsx`

Find the helper text at the bottom (around line 100):

```tsx
<p className="mt-3 text-xs text-[color:var(--color-text-muted)]">
  L&apos;invitation envoie un lien à usage unique valide 72h. La personne définira son mot de passe
  en arrivant sur NexusHub.
</p>
```

Replace with:

```tsx
<p className="mt-3 text-xs text-[color:var(--color-text-muted)]">
  L&apos;invitation envoie un lien à usage unique valide 72h. La personne définira son mot de passe
  en arrivant sur NexusHub. Pour restreindre son accès à certains clients ou projets, ouvre sa fiche
  dans la liste après acceptation.
</p>
```

- [ ] **Step 3: Typecheck + lint**

```bash
pnpm --filter @nexushub/web typecheck && pnpm --filter @nexushub/web lint
```

Expected: green.

- [ ] **Step 4: Commit**

```bash
git add apps/web/features/team/components/invitation-form.tsx
git commit -m "feat(team): document post-acceptance scope flow in invitation hint"
```

---

## Task 8: Manual smoke + progress.md

- [ ] **Step 1: Start dev**

```bash
pnpm dev
```

- [ ] **Step 2: As Admin, scope an existing User**

1. Log in as Admin (`angelo.geraci@brandnewday.agency`).
2. Invite a test User if one doesn't already exist.
3. On `/team`, click the **🎯 Tout le workspace** chip on the test User's row.
4. The Scope modal opens: pick one Client, hit Enregistrer.
5. Modal closes. The chip now reads **1 client + 0 projet**.

Expected: success, audit log entry `workspace_access_granted` written.

- [ ] **Step 3: Verify the scoped User sees only their scope**

1. Log out of the Admin session.
2. Log in as the test User (use the invitation link from a private window if needed).
3. On `/overview`, **only** the scoped Client's projects appear in any list.
4. On `/clients`, **only** the scoped Client appears.
5. On `/projects`, **only** projects of the scoped Client appear.
6. Try opening a URL of a project from a non-scoped Client (e.g. `/projects/<other-id>`) — must return the 404 page.
7. Try creating a Card in a scoped project — works.
8. Try creating a Card via dev-tools tampering with `projectId` set to a non-scoped project — server returns `Cette ressource n'est pas accessible avec ton scope actuel.`

- [ ] **Step 4: Verify 404 page lands when a User hits `/team`**

1. Still as the test User, navigate to `/team`.
2. Expected: the friendly **Page introuvable** page renders (not the Turbopack "Runtime Error: Response" we had in Phase A).

- [ ] **Step 5: Verify Admin can clear the scope**

1. Log back in as Admin.
2. Open the test User's row, click the scope chip, then click **Réinitialiser (tout le workspace)**.
3. Modal closes. Chip returns to **Tout le workspace**.
4. Audit log entry: `workspace_access_revoked`.

- [ ] **Step 6: Update `progress.md`**

Find Phase 9 section. Below the existing `### 9.5 User management — Phase A` add:

```markdown
### 9.6 User management — Phase B.1 (scoping foundation) ✅ (2026-05-16)

- [x] Phase A follow-ups: `isRole` predicate (drops the unsafe `as Role` cast), `requireAdmin`/`requireSuperAdmin` use `notFound()` for friendly 404, integration tests for `createInvitation` + `changeMemberRole` (9 specs)
- [x] DB: `workspace_access` table + 2 triggers (same-workspace integrity, forbid admin scope) + RLS workspace-scoped reads + admin-only writes
- [x] DB: audit kinds `workspace_access_granted` / `workspace_access_revoked`
- [x] Domain: pure `evaluateScopeMatch` + `UserScope` types (7 specs)
- [x] Server: `loadUserScope` (per-request cached) + `scopedClientWhere` / `scopedProjectWhere` / `scopedCardWhere` Prisma helpers (12 specs)
- [x] Server: scope checks applied to every Client/Project/Card server action; out-of-scope mutations return `Cette ressource n'est pas accessible avec ton scope actuel.`
- [x] Pages: `/overview`, `/projects`, `/clients` lists filter by scope; single-resource pages `notFound()` when out of scope
- [x] `setUserScope` server action (Admin only, transactional replace, audit-logged, 5 specs)
- [x] UI `/team`: scope chip per non-Admin member + scope modal (clients + projects multi-select, reset button)
- [x] Smoke verified end-to-end on staging
- [ ] **Plan B.2** : Viewer activation — unblock invitation, `/my-projects` route + adaptive sidebar + `shareProjectWithViewer` action + Partager modal + comment authorization for Viewers
```

Also bump the header date to `2026-05-16`.

- [ ] **Step 7: Commit progress + push**

```bash
git add progress.md
git commit -m "docs(progress): close user-management Phase B.1 (scoping foundation)"
```

---

## Plan B.1 Definition of Done

- [ ] All migrations apply cleanly on a fresh local DB.
- [ ] Domain tests pass: `isRole` (3 specs), `scope` (7 specs).
- [ ] App-side tests pass: `scope.test.ts` (12 specs), `set-user-scope.test.ts` (5 specs), `create-invitation.test.ts` (5 specs), `change-member-role.test.ts` (4 specs). Total new specs: 36+.
- [ ] `pnpm --filter @nexushub/web typecheck` green.
- [ ] `pnpm --filter @nexushub/web lint` green.
- [ ] `pnpm test` green across the monorepo.
- [ ] Manual smoke from Task 8 passes — scoped User sees only their resources; out-of-scope URL hits 404; mutation tampering returns the scope error.
- [ ] `progress.md` updated with section 9.6 and the date bumped.
- [ ] All commits pushed to the feature branch.
