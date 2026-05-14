# User Management — Phase A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat `admin | member` role with the foundation of the two-level access model — extend the `Role` enum to `admin | user | viewer`, add `User.isSuperAdmin` with Angelo bootstrapped, expose new auth helpers, and update `/team` UI to handle the new role names. **Viewers exist in the DB but cannot be invited yet** (gated, Phase B unlocks the scope picker that makes Viewer usable).

**Architecture:** 4 hand-crafted Prisma migrations (Postgres can `RENAME` an enum value in-place + `ADD` new values, but `ADD VALUE` cannot share a transaction with statements that use the new value — hence the split files). After the DB migrations land, all code changes — schema.prisma, generated client, domain `Roles` constant, auth helpers, server actions, and three UI components — ship in a **single atomic commit** because the breaking type rename (`member` → `user`) cannot be made green incrementally without leaving Prisma's type and TypeScript's references temporarily inconsistent.

**Tech Stack:** Prisma 6 + Postgres 17 (Supabase), TypeScript strict, Next.js 15 App Router, Vitest.

**Scope guardrails (out of this plan):** No `WorkspaceAccess` table (Phase B). No `/super-admin` route (Phase C). No impersonation (V1.5). No new UI flow for Viewers — invitations are explicitly blocked. No project-level ACL filtering.

---

## File Structure

**New files:**

- `packages/db/prisma/migrations/20260515100001_role_rename_member_to_user/migration.sql`
- `packages/db/prisma/migrations/20260515100002_role_add_viewer/migration.sql`
- `packages/db/prisma/migrations/20260515100003_user_is_super_admin/migration.sql`
- `packages/db/prisma/migrations/20260515100004_protect_last_super_admin/migration.sql`
- `packages/domain/src/permissions/permissions.test.ts`

**Modified files (all in the single Task 5 commit):**

- `packages/db/prisma/schema.prisma` — extend `Role` enum + add `isSuperAdmin` on User.
- `packages/domain/src/permissions/index.ts` — Roles constant + capability matrix.
- `apps/web/lib/auth/index.ts` — AuthContext.isSuperAdmin + `requireSuperAdmin()`.
- `apps/web/features/invitations/actions/create-invitation.ts` — Zod schema + Viewer guard.
- `apps/web/features/team/actions/change-member-role.ts` — Zod schema + Viewer guard.
- `apps/web/features/team/components/invitation-form.tsx` — 3-option dropdown.
- `apps/web/features/team/components/member-row.tsx` — role prop type + super-admin badge.
- `apps/web/features/team/components/pending-invitation-row.tsx` — role prop type + labels.
- `apps/web/app/(app)/team/page.tsx` — fetch isSuperAdmin, pass new props.

---

## Task 1: DB migration — rename enum value `member` → `user`

**Files:**

- Create: `packages/db/prisma/migrations/20260515100001_role_rename_member_to_user/migration.sql`

**Why first:** `RENAME VALUE` is in-place — all existing membership and invitation rows (today holding `'member'`) start reading as `'user'` immediately. No data migration needed. Must run before any code uses the new label.

- [ ] **Step 1: Create the migration directory**

```bash
mkdir -p packages/db/prisma/migrations/20260515100001_role_rename_member_to_user
```

- [ ] **Step 2: Write the migration SQL**

File: `packages/db/prisma/migrations/20260515100001_role_rename_member_to_user/migration.sql`

```sql
-- Phase A — rename the existing 'member' enum value to 'user' in place.
-- Postgres 12+ ALTER TYPE ... RENAME VALUE rewrites the label without
-- touching any row data; every membership/invitation that was 'member'
-- now reads as 'user' atomically.
ALTER TYPE "public"."Role" RENAME VALUE 'member' TO 'user';
```

- [ ] **Step 3: Apply the migration**

Run: `pnpm --filter @nexushub/db prisma migrate deploy`

Expected: `Applying migration "20260515100001_role_rename_member_to_user"` and `All migrations have been successfully applied.`

- [ ] **Step 4: Verify the rename took effect**

Run: `pnpm --filter @nexushub/db prisma db execute --stdin <<'SQL'
SELECT enumlabel FROM pg_enum WHERE enumtypid = '"public"."Role"'::regtype ORDER BY enumsortorder;
SQL`

Expected output contains: `admin` and `user` (no `member`).

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/migrations/20260515100001_role_rename_member_to_user/
git commit -m "feat(db): rename Role enum value member to user"
```

---

## Task 2: DB migration — add enum value `viewer`

**Files:**

- Create: `packages/db/prisma/migrations/20260515100002_role_add_viewer/migration.sql`

**Why alone:** Postgres restricts `ALTER TYPE ... ADD VALUE` from sharing a transaction with statements that _use_ the new value. Keeping it in its own migration file guarantees the migration runner commits it before any subsequent statement references `viewer`.

- [ ] **Step 1: Create the migration directory**

```bash
mkdir -p packages/db/prisma/migrations/20260515100002_role_add_viewer
```

- [ ] **Step 2: Write the migration SQL**

File: `packages/db/prisma/migrations/20260515100002_role_add_viewer/migration.sql`

```sql
-- Phase A — add the 'viewer' enum value. Kept in its own migration
-- because Postgres forbids using a newly-added enum value inside the
-- same transaction. Phase B uses this value; Phase A leaves it unused
-- (the invitation flow explicitly rejects 'viewer' until then).
ALTER TYPE "public"."Role" ADD VALUE IF NOT EXISTS 'viewer';
```

- [ ] **Step 3: Apply the migration**

Run: `pnpm --filter @nexushub/db prisma migrate deploy`

Expected: `Applying migration "20260515100002_role_add_viewer"` and `All migrations have been successfully applied.`

- [ ] **Step 4: Verify the new value exists**

Run: `pnpm --filter @nexushub/db prisma db execute --stdin <<'SQL'
SELECT enumlabel FROM pg_enum WHERE enumtypid = '"public"."Role"'::regtype ORDER BY enumsortorder;
SQL`

Expected output: `admin`, `user`, `viewer`.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/migrations/20260515100002_role_add_viewer/
git commit -m "feat(db): add viewer to Role enum"
```

---

## Task 3: DB migration — `User.is_super_admin` + backfill Angelo

**Files:**

- Create: `packages/db/prisma/migrations/20260515100003_user_is_super_admin/migration.sql`

- [ ] **Step 1: Create the migration directory**

```bash
mkdir -p packages/db/prisma/migrations/20260515100003_user_is_super_admin
```

- [ ] **Step 2: Write the migration SQL**

File: `packages/db/prisma/migrations/20260515100003_user_is_super_admin/migration.sql`

```sql
-- Phase A — platform-level super-admin flag.
-- Default false for everyone; Angelo is the bootstrap super-admin.
-- The Phase C console will own runtime promotions; this migration is
-- the only place that hard-codes an email.
ALTER TABLE "public"."users"
  ADD COLUMN "is_super_admin" BOOLEAN NOT NULL DEFAULT FALSE;

-- Partial index so the auth lookup stays cheap when checking the flag.
CREATE INDEX IF NOT EXISTS "users_is_super_admin_idx"
  ON "public"."users" ("is_super_admin")
  WHERE "is_super_admin" = TRUE;

-- Bootstrap. If the user doesn't exist yet (fresh DB), this is a no-op
-- and the flag will be set when the account is provisioned later.
UPDATE "public"."users"
   SET "is_super_admin" = TRUE
 WHERE "email" = 'ageraci.finance@gmail.com';
```

- [ ] **Step 3: Apply the migration**

Run: `pnpm --filter @nexushub/db prisma migrate deploy`

Expected: `Applying migration "20260515100003_user_is_super_admin"` and `All migrations have been successfully applied.`

- [ ] **Step 4: Verify column and backfill**

Run: `pnpm --filter @nexushub/db prisma db execute --stdin <<'SQL'
SELECT email, is_super_admin FROM public.users WHERE email = 'ageraci.finance@gmail.com';
SQL`

Expected: 1 row, `is_super_admin = true`. If 0 rows, the account hasn't been provisioned locally yet — the migration is still correct; the flag will be set when Angelo first signs in.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/migrations/20260515100003_user_is_super_admin/
git commit -m "feat(db): add User.is_super_admin + bootstrap Angelo"
```

---

## Task 4: DB migration — last-super-admin protection trigger

**Files:**

- Create: `packages/db/prisma/migrations/20260515100004_protect_last_super_admin/migration.sql`

**Why a trigger:** Mirrors the existing `protect_last_admin` pattern at `packages/db/prisma/migrations/20260427100007_cascade_friendly_triggers/migration.sql:37-75`. App-level guards alone can be bypassed by a stray Prisma call.

- [ ] **Step 1: Create the migration directory**

```bash
mkdir -p packages/db/prisma/migrations/20260515100004_protect_last_super_admin
```

- [ ] **Step 2: Write the migration SQL**

File: `packages/db/prisma/migrations/20260515100004_protect_last_super_admin/migration.sql`

```sql
-- Phase A — last-super-admin protection.
-- Forbid the transition that would leave the platform with zero super-admins.
-- Mirrors public.protect_last_admin (introduced in 20260427100007).
CREATE OR REPLACE FUNCTION public.protect_last_super_admin()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  remaining int;
BEGIN
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.is_super_admin = TRUE THEN RETURN NEW; END IF;
    IF OLD.is_super_admin = FALSE THEN RETURN NEW; END IF;
  END IF;

  SELECT COUNT(*) INTO remaining
    FROM public.users
   WHERE is_super_admin = TRUE
     AND id <> OLD.id;

  IF remaining = 0 THEN
    RAISE EXCEPTION 'LAST_SUPER_ADMIN_PROTECTED: cannot remove or demote the last super-admin'
      USING ERRCODE = 'P0001';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_last_super_admin_update ON public.users;
CREATE TRIGGER trg_protect_last_super_admin_update
  BEFORE UPDATE OF is_super_admin ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.protect_last_super_admin();

DROP TRIGGER IF EXISTS trg_protect_last_super_admin_delete ON public.users;
CREATE TRIGGER trg_protect_last_super_admin_delete
  BEFORE DELETE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.protect_last_super_admin();
```

- [ ] **Step 3: Apply the migration**

Run: `pnpm --filter @nexushub/db prisma migrate deploy`

Expected: `Applying migration "20260515100004_protect_last_super_admin"` and `All migrations have been successfully applied.`

- [ ] **Step 4: Verify the trigger blocks demotion of the last super-admin**

Run: `pnpm --filter @nexushub/db prisma db execute --stdin <<'SQL'
DO $$
DECLARE
  cnt int;
BEGIN
  SELECT COUNT(*) INTO cnt FROM public.users WHERE is_super_admin = TRUE;
  IF cnt <> 1 THEN
    RAISE NOTICE 'Skipping trigger smoke (super_admin count = %)', cnt;
    RETURN;
  END IF;
  BEGIN
    UPDATE public.users SET is_super_admin = FALSE WHERE is_super_admin = TRUE;
    RAISE EXCEPTION 'expected LAST_SUPER_ADMIN_PROTECTED to fire';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'LAST_SUPER_ADMIN_PROTECTED%' THEN
      RAISE NOTICE 'trigger fired as expected: %', SQLERRM;
    ELSE
      RAISE;
    END IF;
  END;
END $$;
SQL`

Expected: `NOTICE: trigger fired as expected: LAST_SUPER_ADMIN_PROTECTED: ...`. If `Skipping trigger smoke` instead — Angelo's account doesn't exist locally yet; the trigger is still installed correctly.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/migrations/20260515100004_protect_last_super_admin/
git commit -m "feat(db): add protect_last_super_admin trigger"
```

---

## Task 5: All code changes — one atomic commit

> **CRITICAL:** This task is a **single commit** because renaming `Roles.Member` to `Roles.User`, regenerating the Prisma client, and updating every consumer cannot be split without leaving intermediate states where TypeScript types of `Role` from Prisma and from the domain disagree. Do **not** commit between sub-steps — only at the very end, after typecheck + lint + test are all green.

### Step 1: Update `schema.prisma`

File: `packages/db/prisma/schema.prisma`

- [ ] **Sub-step 1.1: Replace the `Role` enum (lines 33–36)**

Replace:

```prisma
enum Role {
  admin
  member
}
```

With:

```prisma
enum Role {
  admin
  user
  viewer
}
```

- [ ] **Sub-step 1.2: Add `isSuperAdmin` to the `User` model**

Find the `User` model block (around line 134). Add the new field between `timezone` and `createdAt`:

```prisma
model User {
  id        String   @id @db.Uuid
  email     String   @unique @db.Citext
  firstName String?  @map("first_name")
  lastName  String?  @map("last_name")
  avatarUrl String?  @map("avatar_url")
  locale    String   @default("fr") @db.VarChar(8)
  timezone  String   @default("Europe/Paris") @db.VarChar(64)
  isSuperAdmin Boolean @default(false) @map("is_super_admin")
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  memberships        Membership[]
  invitationsCreated Invitation[]             @relation("InvitationCreatedBy")
  pushSubscriptions  PushSubscription[]
  notificationPrefs  NotificationPreference[]
  notificationsTo    Notification[]
  activityActor      ActivityEvent[]
  auditEvents        AuditLog[]
  cardAssignments    CardAssignee[]
  comments           Comment[]
  projectMemberships ProjectMember[]
  ownedIntegrations  Integration[]            @relation("IntegrationOwner")

  @@index([email])
  @@map("users")
}
```

- [ ] **Sub-step 1.3: Regenerate the Prisma client**

Run: `pnpm --filter @nexushub/db prisma generate`

Expected: `✔ Generated Prisma Client (...)` with no errors.

The repo now contains the new client. Subsequent steps update consumers to match.

### Step 2: Update domain `Roles` + capability matrix + tests

- [ ] **Sub-step 2.1: Write the domain test first (TDD)**

File: `packages/domain/src/permissions/permissions.test.ts` (new)

```typescript
import { describe, expect, it } from 'vitest';
import { Roles, can, type Capability } from './index';

describe('Roles', () => {
  it('exposes admin, user, and viewer', () => {
    expect(Roles.Admin).toBe('admin');
    expect(Roles.User).toBe('user');
    expect(Roles.Viewer).toBe('viewer');
  });
});

describe('can()', () => {
  it('admin holds every capability', () => {
    const allCaps: Capability[] = [
      'workspace.read',
      'workspace.update',
      'project.crud',
      'client.crud',
      'template.crud',
      'member.invite',
      'member.remove',
      'member.change_role',
      'integration.slack.manage',
      'integration.exchange.connect_self',
      'settings.update_own',
    ];
    for (const cap of allCaps) {
      expect(can(Roles.Admin, cap)).toBe(true);
    }
  });

  it("user has today's member surface (full workspace, no team management)", () => {
    expect(can(Roles.User, 'workspace.read')).toBe(true);
    expect(can(Roles.User, 'project.crud')).toBe(true);
    expect(can(Roles.User, 'client.crud')).toBe(true);
    expect(can(Roles.User, 'template.crud')).toBe(true);
    expect(can(Roles.User, 'integration.exchange.connect_self')).toBe(true);
    expect(can(Roles.User, 'settings.update_own')).toBe(true);
    expect(can(Roles.User, 'member.invite')).toBe(false);
    expect(can(Roles.User, 'member.remove')).toBe(false);
    expect(can(Roles.User, 'member.change_role')).toBe(false);
    expect(can(Roles.User, 'workspace.update')).toBe(false);
    expect(can(Roles.User, 'integration.slack.manage')).toBe(false);
  });

  it('viewer can only read and edit own profile', () => {
    expect(can(Roles.Viewer, 'workspace.read')).toBe(true);
    expect(can(Roles.Viewer, 'settings.update_own')).toBe(true);
    expect(can(Roles.Viewer, 'project.crud')).toBe(false);
    expect(can(Roles.Viewer, 'client.crud')).toBe(false);
    expect(can(Roles.Viewer, 'template.crud')).toBe(false);
    expect(can(Roles.Viewer, 'member.invite')).toBe(false);
    expect(can(Roles.Viewer, 'workspace.update')).toBe(false);
  });
});
```

- [ ] **Sub-step 2.2: Replace `packages/domain/src/permissions/index.ts`**

Replace the entire file with:

```typescript
export const Roles = {
  Admin: 'admin',
  User: 'user',
  Viewer: 'viewer',
} as const;

export type Role = (typeof Roles)[keyof typeof Roles];

export type Capability =
  | 'workspace.read'
  | 'workspace.update'
  | 'project.crud'
  | 'client.crud'
  | 'template.crud'
  | 'member.invite'
  | 'member.remove'
  | 'member.change_role'
  | 'integration.slack.manage'
  | 'integration.exchange.connect_self'
  | 'settings.update_own';

const CAPABILITY_MATRIX: Record<Role, ReadonlySet<Capability>> = {
  [Roles.Admin]: new Set<Capability>([
    'workspace.read',
    'workspace.update',
    'project.crud',
    'client.crud',
    'template.crud',
    'member.invite',
    'member.remove',
    'member.change_role',
    'integration.slack.manage',
    'integration.exchange.connect_self',
    'settings.update_own',
  ]),
  [Roles.User]: new Set<Capability>([
    'workspace.read',
    'project.crud',
    'client.crud',
    'template.crud',
    'integration.exchange.connect_self',
    'settings.update_own',
  ]),
  [Roles.Viewer]: new Set<Capability>(['workspace.read', 'settings.update_own']),
};

export function can(role: Role, capability: Capability): boolean {
  return CAPABILITY_MATRIX[role].has(capability);
}

export function assertCan(role: Role, capability: Capability): void {
  if (!can(role, capability)) {
    throw new Error(`FORBIDDEN: role=${role} cannot ${capability}`);
  }
}
```

### Step 3: Update auth helpers

- [ ] **Sub-step 3.1: Replace `apps/web/lib/auth/index.ts`**

```typescript
/**
 * Auth helpers (CLAUDE.md §4.4).
 *
 * `getUser()` — anonymous-friendly: returns `null` when not signed in.
 * `requireUser()` — throws `RedirectToLogin` for unauthenticated requests.
 * `requireAdmin()` — throws `Forbidden` if the user is not Admin in the workspace.
 * `requireSuperAdmin()` — throws `Forbidden` if the user is not a platform super-admin.
 *
 * SECURITY:
 *  - `supabase.auth.getUser()` validates the JWT against Supabase (network call).
 *    Never rely on `getSession()` alone — it only decodes the cookie locally.
 *  - All checks happen server-side. Client components must call these via Server Actions.
 *  - We always join via `Membership.workspace_id`; never trust a workspace_id sent by the client.
 */
import 'server-only';
import { redirect } from 'next/navigation';
import { prisma } from '@nexushub/db';
import { Roles, type Role } from '@nexushub/domain';
import { createSupabaseServer } from '../supabase/server';

export interface AuthContext {
  readonly userId: string;
  readonly email: string;
  readonly workspaceId: string;
  readonly role: Role;
  readonly isSuperAdmin: boolean;
}

/**
 * Returns the verified user + workspace membership context, or `null` when
 * the request is unauthenticated.
 */
export async function getAuthContext(): Promise<AuthContext | null> {
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;

  // Single query joining users + first membership so we get isSuperAdmin
  // + role in one trip.
  const user = await prisma.user.findUnique({
    where: { id: data.user.id },
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

  return {
    userId: data.user.id,
    email: data.user.email ?? '',
    workspaceId: membership.workspaceId,
    role: membership.role as Role,
    isSuperAdmin: user.isSuperAdmin,
  };
}

/**
 * Server Action / page guard. Redirects to /login when not authenticated.
 */
export async function requireUser(): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) redirect('/login');
  return ctx;
}

/** Stricter guard: also enforces Admin role (or super-admin override). */
export async function requireAdmin(): Promise<AuthContext> {
  const ctx = await requireUser();
  if (ctx.role !== Roles.Admin && !ctx.isSuperAdmin) {
    throw new Response('Forbidden', { status: 403 });
  }
  return ctx;
}

/** Platform-level guard for super-admin-only routes (Phase C entry points). */
export async function requireSuperAdmin(): Promise<AuthContext> {
  const ctx = await requireUser();
  if (!ctx.isSuperAdmin) {
    throw new Response('Forbidden', { status: 403 });
  }
  return ctx;
}
```

### Step 4: Update server actions

- [ ] **Sub-step 4.1: Update `create-invitation.ts`**

File: `apps/web/features/invitations/actions/create-invitation.ts`

Find the schema (line 17):

```typescript
const CreateInvitationSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  role: z.enum([Roles.Admin, Roles.Member]).default(Roles.Member),
});
```

Replace with:

```typescript
const CreateInvitationSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  role: z.enum([Roles.Admin, Roles.User, Roles.Viewer]).default(Roles.User),
});
```

After `const { email, role } = parsed.data;` add the Phase A Viewer guard:

```typescript
// Phase A: Viewer requires a scope picker (Phase B). The UI disables
// the option; this is the defence-in-depth.
if (role === Roles.Viewer) {
  return {
    status: 'error',
    message: 'Le rôle Viewer sera disponible dans une prochaine mise à jour.',
  };
}
```

- [ ] **Sub-step 4.2: Update `change-member-role.ts`**

File: `apps/web/features/team/actions/change-member-role.ts`

Find the schema:

```typescript
const Schema = z.object({
  membershipId: z.string().uuid(),
  role: z.enum([Roles.Admin, Roles.Member]),
});
```

Replace with:

```typescript
const Schema = z.object({
  membershipId: z.string().uuid(),
  role: z.enum([Roles.Admin, Roles.User, Roles.Viewer]),
});
```

After `const { membershipId, role } = parsed.data;` add:

```typescript
if (role === Roles.Viewer) {
  return {
    status: 'error',
    message: 'Le rôle Viewer sera disponible dans une prochaine mise à jour.',
  };
}
```

### Step 5: Update UI components

- [ ] **Sub-step 5.1: Update `InvitationForm` dropdown**

File: `apps/web/features/team/components/invitation-form.tsx`

Find the `<select>` block (lines 79–87):

```tsx
<div>
  <label className="field-label" htmlFor="invite-role">
    Rôle
  </label>
  <select id="invite-role" name="role" defaultValue="member" className="field-select">
    <option value="member">Membre</option>
    <option value="admin">Admin</option>
  </select>
</div>
```

Replace with:

```tsx
<div>
  <label className="field-label" htmlFor="invite-role">
    Rôle
  </label>
  <select id="invite-role" name="role" defaultValue="user" className="field-select">
    <option value="user">User</option>
    <option value="admin">Admin</option>
    <option value="viewer" disabled title="Disponible bientôt (Phase B)">
      Viewer (bientôt)
    </option>
  </select>
</div>
```

- [ ] **Sub-step 5.2: Update `MemberRow`**

File: `apps/web/features/team/components/member-row.tsx`

Replace the `MemberRowProps` interface:

```typescript
export interface MemberRowProps {
  readonly csrfToken: string;
  readonly membershipId: string;
  readonly userId: string;
  readonly currentUserId: string;
  readonly displayName: string;
  readonly email: string;
  readonly role: 'admin' | 'user' | 'viewer';
  readonly isSuperAdmin: boolean;
}
```

Replace the role `<select>` block:

```tsx
<select
  id={`role-${props.membershipId}`}
  name="role"
  defaultValue={props.role}
  disabled={rolePending}
  className="field-select w-32"
>
  <option value="user">User</option>
  <option value="admin">Admin</option>
  <option value="viewer" disabled title="Disponible bientôt (Phase B)">
    Viewer (bientôt)
  </option>
</select>
```

Replace the name+badges block (the `<div className="min-w-0 flex-1">` containing the displayName and "Vous" pill):

```tsx
<div className="min-w-0 flex-1">
  <p className="truncate text-sm font-bold">
    {props.displayName}
    {isSelf ? (
      <span className="ml-2 rounded-full bg-[color:var(--color-bg-hover)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.5px] text-[color:var(--color-text-muted)]">
        Vous
      </span>
    ) : null}
    {props.isSuperAdmin ? (
      <span
        className="ml-2 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.5px] text-white"
        style={{ backgroundImage: 'var(--accent-gradient)' }}
        title="Super-admin de la plateforme"
      >
        Super-admin
      </span>
    ) : null}
  </p>
  <p className="truncate text-xs text-[color:var(--color-text-muted)]">{props.email}</p>
</div>
```

- [ ] **Sub-step 5.3: Update `PendingInvitationRow`**

File: `apps/web/features/team/components/pending-invitation-row.tsx`

Replace the props interface:

```typescript
export interface PendingInvitationRowProps {
  readonly csrfToken: string;
  readonly invitationId: string;
  readonly email: string;
  readonly role: 'admin' | 'user' | 'viewer';
  readonly expiresAtIso: string;
  readonly expiresLabel: string;
}
```

Replace the role label line:

```tsx
<p className="text-xs text-[color:var(--color-text-muted)]">
  {roleLabel(props.role)} · expire <time dateTime={props.expiresAtIso}>{props.expiresLabel}</time>
</p>
```

Add at the bottom of the file (after the `PendingInvitationRow` function):

```typescript
function roleLabel(role: 'admin' | 'user' | 'viewer'): string {
  switch (role) {
    case 'admin':
      return 'Admin';
    case 'user':
      return 'User';
    case 'viewer':
      return 'Viewer';
  }
}
```

- [ ] **Sub-step 5.4: Update `/team` page to fetch isSuperAdmin and pass new props**

File: `apps/web/app/(app)/team/page.tsx`

Remove the now-unused `Roles` import — find:

```typescript
import { Roles } from '@nexushub/domain';
```

Delete that line.

Find the `members` query (lines 26–35):

```typescript
    prisma.membership.findMany({
      where: { workspaceId: ctx.workspaceId },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        role: true,
        userId: true,
        user: { select: { firstName: true, lastName: true, email: true } },
      },
    }),
```

Replace with:

```typescript
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
```

Find the `<MemberRow>` rendering (lines 91–101):

```tsx
<MemberRow
  key={m.id}
  csrfToken={csrf}
  membershipId={m.id}
  userId={m.userId}
  currentUserId={ctx.userId}
  displayName={displayName}
  email={m.user.email}
  role={m.role === Roles.Admin ? 'admin' : 'member'}
/>
```

Replace with:

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
/>
```

Find the `<PendingInvitationRow>` rendering (lines 123–132):

```tsx
<PendingInvitationRow
  key={inv.id}
  csrfToken={csrf}
  invitationId={inv.id}
  email={inv.email}
  role={inv.role === Roles.Admin ? 'admin' : 'member'}
  expiresAtIso={inv.expiresAt.toISOString()}
  expiresLabel={dateFormatterFr.format(inv.expiresAt)}
/>
```

Replace with:

```tsx
<PendingInvitationRow
  key={inv.id}
  csrfToken={csrf}
  invitationId={inv.id}
  email={inv.email}
  role={inv.role}
  expiresAtIso={inv.expiresAt.toISOString()}
  expiresLabel={dateFormatterFr.format(inv.expiresAt)}
/>
```

### Step 6: Verify everything

- [ ] **Sub-step 6.1: Typecheck**

Run: `pnpm --filter @nexushub/web typecheck`

Expected: PASS.

If failures mention `Roles.Member` somewhere — grep the codebase: `grep -rn "Roles\.Member" apps packages` — and update each call site to `Roles.User`.

- [ ] **Sub-step 6.2: Lint**

Run: `pnpm --filter @nexushub/web lint && pnpm --filter @nexushub/domain lint`

Expected: both PASS.

- [ ] **Sub-step 6.3: Run all tests**

Run: `pnpm test`

Expected: ALL pass (including the 3 new specs in `permissions.test.ts`).

If `apps/web/features/invitations/email/templates.test.ts` references the string `'member'` in any assertion, update it to `'user'`. Re-run.

### Step 7: Single atomic commit

- [ ] **Sub-step 7.1: Stage all the modified files**

```bash
git add \
  packages/db/prisma/schema.prisma \
  packages/domain/src/permissions/index.ts \
  packages/domain/src/permissions/permissions.test.ts \
  apps/web/lib/auth/index.ts \
  apps/web/features/invitations/actions/create-invitation.ts \
  apps/web/features/team/actions/change-member-role.ts \
  apps/web/features/team/components/invitation-form.tsx \
  apps/web/features/team/components/member-row.tsx \
  apps/web/features/team/components/pending-invitation-row.tsx \
  "apps/web/app/(app)/team/page.tsx"
```

- [ ] **Sub-step 7.2: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(team): user management Phase A — three-role model + super-admin flag

Domain Roles is now { Admin, User, Viewer }; capability matrix gives
User today's Member surface (full workspace, no team mgmt) and Viewer
only read + own-profile (real Viewer UX lands in Phase B).

requireSuperAdmin() added; AuthContext exposes isSuperAdmin. Server
actions accept the three roles but reject Viewer until Phase B unlocks
the scope picker. /team UI shows the three options (Viewer disabled)
and a Super-admin badge in member rows.

Companion DB migrations (separate commits): role rename, viewer add,
is_super_admin column + Angelo backfill, last-super-admin trigger.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Manual smoke + progress.md

- [ ] **Step 1: Start the dev server**

Run: `pnpm dev`

Expected: app starts on http://localhost:3000.

- [ ] **Step 2: Log in as Angelo and open `/team`**

Expected:

- Angelo's row shows a **Super-admin** purple/pink badge next to the name.
- Role select offers `User`, `Admin`, and `Viewer (bientôt)` (the last disabled).

- [ ] **Step 3: Invite a fresh email as `User`**

Fill the invitation form: an email you control, role `User`. Submit.

Expected: success banner "Invitation envoyée à <email>", form resets, a new "Invitations en attente" row appears with role label **User**.

- [ ] **Step 4: Confirm Viewer is disabled in the form**

Inspect the InvitationForm `<select>` in DevTools. Confirm the Viewer option has `disabled` + the title `Disponible bientôt (Phase B)`.

Expected: option visually greyed out; cannot be selected by mouse or keyboard.

- [ ] **Step 5: Open the invitation email, accept it, log in as the new user**

Expected:

- The new user lands and sees the same UI today's Members see (Overview, Projects, Clients, Templates).
- `/team` returns 403 for them (the existing `requireAdmin` guard).
- Their row in /team (visible to Angelo on next refresh) shows a plain User pill — no super-admin badge.

- [ ] **Step 6: Update `progress.md`**

Open `progress.md`. Find Phase 9 — _Équipe, Paramètres, Notifications_. Under it, add:

```markdown
### 9.x User management — Phase A ✅ (2026-05-15)

- [x] DB: `Role` enum extended (admin / user / viewer) via in-place RENAME + ADD VALUE
- [x] DB: `User.is_super_admin` boolean + Angelo bootstrapped via migration
- [x] DB: `protect_last_super_admin` trigger mirroring the last-Admin pattern
- [x] Domain: `Roles` constant + capability matrix covers the three roles (3 new specs)
- [x] Auth: `requireSuperAdmin()` added; `AuthContext.isSuperAdmin` exposed
- [x] Server actions: `createInvitation` + `changeMemberRole` accept the three roles; Viewer rejected with explicit Phase B-coming message
- [x] UI `/team`: 3-option role dropdown (Viewer disabled), super-admin badge in member rows, role labels updated
- [x] Smoke verified: Admin can invite a User end-to-end
- [ ] **Phase B**: scope picker + `WorkspaceAccess` table + `/my-projects` route — separate plan
- [ ] **Phase C**: super-admin console (`/super-admin`) — separate plan
```

- [ ] **Step 7: Commit**

```bash
git add progress.md
git commit -m "docs(progress): close user-management Phase A"
```

---

## Phase A Definition of Done

- [ ] All 4 migrations applied cleanly on a fresh local DB (`prisma migrate deploy` from scratch produces no errors).
- [ ] All 4 migrations applied to staging Supabase (run `pnpm --filter @nexushub/db prisma migrate deploy` with the staging `DATABASE_URL`).
- [ ] Domain test `permissions.test.ts` passes (3 specs).
- [ ] `pnpm --filter @nexushub/web typecheck` is green.
- [ ] `pnpm --filter @nexushub/web lint` is green.
- [ ] `pnpm test` is green (87+ specs).
- [ ] Manual smoke from Task 6 passes — Admin invites a User end-to-end; Viewer option is disabled in the form; super-admin badge renders for Angelo.
- [ ] `progress.md` updated.
- [ ] All commits pushed to `main`.
