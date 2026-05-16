# User Management — Phase B.2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unlock the Viewer role end-to-end: an Admin can invite a Viewer with a required scope, the Viewer accepts and lands on a `/my-projects` page that shows only their shared projects, a Viewer-aware sidebar replaces the workspace sidebar, and Admins/scoped-Users can share an existing project with an existing Viewer through a "Partager" modal on the project page. Internal scoping (Plan B.1) already enforces the read/write boundaries — B.2 is purely UX activation on top of that foundation.

**Architecture:** The Invitation table gains two `UUID[]` columns (`scope_client_ids`, `scope_project_ids`) so the invitation flow can persist the scope the Admin set at invite time. `acceptInvitation` transactionally creates the Membership AND the matching `WorkspaceAccess` rows. Viewer-side UX is a new route `/my-projects` (a scope-aware project grid), a Viewer-only variant of the shell sidebar, and a project header "Partager" button that opens a modal listing the workspace's Viewers with per-project share toggles. The `shareProjectWithViewer` action is a thin wrapper around `WorkspaceAccess.create` that gates on Admin OR a User whose scope already covers the project. The Phase A `Viewer` rejection guards are removed; the Zod enums stay the same.

**Tech Stack:** Prisma 6 + Postgres 17 (Supabase), TypeScript strict, Next.js 15 App Router, Vitest.

**Scope guardrails (out of this plan):** No comments-for-Viewers (the Comment server actions don't exist yet — Phase 5.4 noted them as deferred to Phase 8). No `/super-admin` console (Phase C). No impersonation (V1.5). No editing of Viewer scope from the same modal as the share — Admin still uses the existing `/team` scope modal for full Viewer scope edits.

---

## File Structure

**New files:**

- `packages/db/prisma/migrations/20260517100001_invitation_scope/migration.sql` — add `scope_client_ids UUID[]` + `scope_project_ids UUID[]` to `invitations`.
- `apps/web/app/(app)/my-projects/page.tsx` — Viewer-facing landing page.
- `apps/web/app/(app)/my-projects/loading.tsx` — skeleton.
- `apps/web/features/projects/actions/share-project-with-viewer.ts` — server action that grants a Viewer access to a project.
- `apps/web/features/projects/actions/share-project-with-viewer.test.ts` — 4 integration specs.
- `apps/web/features/projects/components/share-project-modal.tsx` — modal on project pages.
- `apps/web/features/projects/components/share-project-button.tsx` — header trigger.
- `apps/web/features/shell/components/sidebar-viewer.tsx` — Viewer-only sidebar variant (the simpler one with just `/my-projects` + `/settings`).

**Modified files:**

- `packages/db/prisma/schema.prisma` — Invitation model: add `scopeClientIds String[] @default([])` + `scopeProjectIds String[] @default([])`.
- `apps/web/features/invitations/actions/create-invitation.ts` — accept `scopeClientIds` + `scopeProjectIds` form fields, validate that Viewer role requires non-empty scope, persist on the row.
- `apps/web/features/invitations/actions/create-invitation.test.ts` — extend with Viewer-with-scope happy path + Viewer-without-scope rejection.
- `apps/web/features/invitations/actions/accept-invitation.ts` — after creating Membership, read `inv.scopeClientIds` / `inv.scopeProjectIds` and `workspaceAccess.createMany` inside the same transaction.
- `apps/web/features/team/actions/change-member-role.ts` — remove the Viewer-blocking branch; when promoting to Viewer require an existing scope row OR refuse.
- `apps/web/features/team/actions/change-member-role.test.ts` — replace the "Viewer rejected" spec with "Viewer accepted if scope exists" + "Viewer rejected if no scope rows".
- `apps/web/features/team/components/invitation-form.tsx` — the Viewer option becomes enabled; a conditional scope picker (client multi-select + project multi-select) shows when role=viewer; on submit the picked ids are sent as hidden CSV fields. Helper text updated.
- `apps/web/app/(app)/team/page.tsx` — pass `clientOptions` + `projectOptions` to `InvitationForm` so it can render the scope picker (the page already fetches them for the scope modal).
- `apps/web/app/(app)/layout.tsx` — branch on `ctx.role === 'viewer'`: render the Viewer sidebar instead of the full one.
- `apps/web/app/(app)/projects/[id]/page.tsx` — header gets the `ShareProjectButton` (Admin + any user whose scope covers the project see it; Viewer hides it).
- `progress.md` — section 9.7.

---

## Task 1: DB migration — persist scope on Invitation

**Files:**

- Create: `packages/db/prisma/migrations/20260517100001_invitation_scope/migration.sql`

- [ ] **Step 1: Create the directory**

```bash
mkdir -p packages/db/prisma/migrations/20260517100001_invitation_scope
```

- [ ] **Step 2: Write the SQL**

File: `packages/db/prisma/migrations/20260517100001_invitation_scope/migration.sql`

```sql
-- Phase B.2 — persist the scope picked by the Admin at invite time so
-- the acceptance flow can materialise it as WorkspaceAccess rows.
-- Empty arrays = "no restriction" (full workspace), same default as the
-- existing Membership model.
ALTER TABLE "public"."invitations"
  ADD COLUMN "scope_client_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];

ALTER TABLE "public"."invitations"
  ADD COLUMN "scope_project_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];
```

- [ ] **Step 3: Apply**

```bash
pnpm --filter @nexushub/db prisma migrate deploy
```

Expected: `Applying migration "20260517100001_invitation_scope"` and `All migrations have been successfully applied.`

- [ ] **Step 4: Verify**

```bash
pnpm --filter @nexushub/db prisma db execute --stdin <<'SQL'
SELECT column_name, data_type FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'invitations'
   AND column_name IN ('scope_client_ids', 'scope_project_ids');
SQL
```

Expected: both rows present, type `ARRAY`.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/migrations/20260517100001_invitation_scope/
git commit -m "feat(db): persist scope on invitation rows"
```

---

## Task 2: schema.prisma + Prisma generate

**Files:**

- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add the two fields to the `Invitation` model**

Find the `Invitation` model (around line 234). Add two new lines next to the existing fields (place them after `role` for visual grouping):

```prisma
model Invitation {
  id               String           @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  workspaceId      String           @map("workspace_id") @db.Uuid
  email            String           @db.Citext
  role             Role             @default(user)
  scopeClientIds   String[]         @default([]) @map("scope_client_ids") @db.Uuid
  scopeProjectIds  String[]         @default([]) @map("scope_project_ids") @db.Uuid
  tokenHash        String           @unique @map("token_hash") @db.VarChar(64)
  // ... rest unchanged
}
```

- [ ] **Step 2: Regenerate the Prisma client**

```bash
pnpm --filter @nexushub/db prisma generate
```

Expected: `✔ Generated Prisma Client (...)`.

- [ ] **Step 3: Verify**

```bash
pnpm --filter @nexushub/web typecheck
```

Expected: green.

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma/schema.prisma
git commit -m "feat(db): Invitation.scopeClientIds + scopeProjectIds in schema"
```

---

## Task 3: Unblock Viewer in server actions + persist scope on invite

**Files:**

- Modify: `apps/web/features/invitations/actions/create-invitation.ts`
- Modify: `apps/web/features/invitations/actions/create-invitation.test.ts`
- Modify: `apps/web/features/team/actions/change-member-role.ts`
- Modify: `apps/web/features/team/actions/change-member-role.test.ts`
- Modify: `apps/web/features/invitations/actions/accept-invitation.ts`

### Step 1: `create-invitation.ts`

a) Remove the Viewer-blocking branch (around lines 45–50):

```typescript
// DELETE this block:
if (role === Roles.Viewer) {
  return {
    status: 'error',
    message: 'Le rôle Viewer sera disponible dans une prochaine mise à jour.',
  };
}
```

b) Extend the Zod schema to accept the two scope CSV fields:

Find the existing `CreateInvitationSchema = z.object({...})`. Add:

```typescript
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseUuidCsv(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => UUID_RE.test(s));
}

const CreateInvitationSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  role: z.enum([Roles.Admin, Roles.User, Roles.Viewer]).default(Roles.User),
  scopeClientIds: z.string().optional(),
  scopeProjectIds: z.string().optional(),
});
```

c) After parsing the form (`const { email, role, scopeClientIds: scopeClientCsv, scopeProjectIds: scopeProjectCsv } = parsed.data;`), parse the lists and enforce Viewer scope:

```typescript
const scopeClientIds = parseUuidCsv(scopeClientCsv);
const scopeProjectIds = parseUuidCsv(scopeProjectCsv);

if (role === Roles.Viewer && scopeClientIds.length === 0 && scopeProjectIds.length === 0) {
  return {
    status: 'error',
    message: 'Un Viewer doit avoir au moins un client ou un projet dans son scope.',
  };
}
```

d) When inserting the invitation row, persist the lists:

```typescript
const created = await prisma.invitation.create({
  data: {
    workspaceId: ctx.workspaceId,
    email,
    role,
    scopeClientIds,
    scopeProjectIds,
    tokenHash: token.hash,
    expiresAt,
    status: 'pending',
    createdById: ctx.userId,
  },
  select: { id: true },
});
```

### Step 2: `create-invitation.test.ts`

Replace the existing "rejects role=viewer" spec with three new ones:

```typescript
it('rejects role=viewer with no scope', async () => {
  const f = fd('viewer');
  const res = await createInvitation({ status: 'idle' }, f);
  expect(res).toEqual({
    status: 'error',
    message: 'Un Viewer doit avoir au moins un client ou un projet dans son scope.',
  });
  expect(mocks.invitationCreate).not.toHaveBeenCalled();
});

it('accepts role=viewer with at least one client in scope', async () => {
  const f = fd('viewer');
  f.set('scopeClientIds', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  const res = await createInvitation({ status: 'idle' }, f);
  expect(res.status).toBe('success');
  const args = mocks.invitationCreate.mock.calls[0]![0];
  expect(args.data.role).toBe('viewer');
  expect(args.data.scopeClientIds).toEqual(['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa']);
  expect(args.data.scopeProjectIds).toEqual([]);
});

it('drops malformed scope UUIDs from the CSV silently', async () => {
  const f = fd('viewer');
  f.set('scopeClientIds', 'not-a-uuid,also-bad');
  f.set('scopeProjectIds', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
  const res = await createInvitation({ status: 'idle' }, f);
  expect(res.status).toBe('success');
  const args = mocks.invitationCreate.mock.calls[0]![0];
  expect(args.data.scopeClientIds).toEqual([]);
  expect(args.data.scopeProjectIds).toEqual(['bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb']);
});
```

### Step 3: `change-member-role.ts`

a) Remove the Viewer-blocking branch (~lines 39–43):

```typescript
// DELETE this block:
if (role === Roles.Viewer) {
  return {
    status: 'error',
    message: 'Le rôle Viewer sera disponible dans une prochaine mise à jour.',
  };
}
```

b) When promoting an existing member to Viewer, refuse if they have no scope rows. After the role-equality short-circuit and the target lookup, add:

```typescript
if (role === Roles.Viewer) {
  const accessCount = await prisma.workspaceAccess.count({
    where: { workspaceId: ctx.workspaceId, membershipId: membershipId },
  });
  if (accessCount === 0) {
    return {
      status: 'error',
      message: "Définis d'abord un scope pour ce membre avant de le passer en Viewer.",
    };
  }
}
```

### Step 4: `change-member-role.test.ts`

Replace the Viewer-rejection spec with two new ones:

```typescript
it('refuses to promote to viewer when the member has no scope rows', async () => {
  mocks.workspaceAccessCount.mockResolvedValueOnce(0);
  const res = await changeMemberRole(
    { status: 'idle' },
    fd('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'viewer'),
  );
  expect(res).toEqual({
    status: 'error',
    message: "Définis d'abord un scope pour ce membre avant de le passer en Viewer.",
  });
  expect(mocks.membershipUpdate).not.toHaveBeenCalled();
});

it('promotes to viewer when scope rows already exist', async () => {
  mocks.workspaceAccessCount.mockResolvedValueOnce(2);
  const res = await changeMemberRole(
    { status: 'idle' },
    fd('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'viewer'),
  );
  expect(res.status).toBe('success');
  expect(mocks.membershipUpdate).toHaveBeenCalledOnce();
});
```

You will need to add `workspaceAccessCount: vi.fn()` to the `vi.hoisted()` mocks block, expose `workspaceAccess: { count: mocks.workspaceAccessCount }` in the Prisma mock object, and `mocks.workspaceAccessCount.mockResolvedValue(0)` in the default `beforeEach`.

### Step 5: `accept-invitation.ts` — materialise scope as WorkspaceAccess rows

Find the existing `prisma.$transaction([...])` block (around lines 123–145) that creates the Membership. Extend it: read the invitation's scope arrays earlier, and inside the transaction `workspaceAccess.createMany` the rows after the Membership is created.

a) Add `scopeClientIds` + `scopeProjectIds` to the invitation `select` block (lines 81–89):

```typescript
const inv = await tx.invitation.findUnique({
  where: { tokenHash },
  select: {
    id: true,
    email: true,
    role: true,
    scopeClientIds: true,
    scopeProjectIds: true,
    expiresAt: true,
    consumedAt: true,
    status: true,
    workspaceId: true,
  },
});
```

b) Convert the second `$transaction([...])` (array form) to a transactional function so we can `await` the Membership creation and then create the access rows referencing the new membership id:

Replace:

```typescript
await prisma.$transaction([
  prisma.invitation.update({...}),
  prisma.user.update({...}),
  prisma.membership.create({
    data: {
      workspaceId: consumed.workspaceId,
      userId: newUserId,
      role: consumed.role,
    },
  }),
]);
```

With:

```typescript
await prisma.$transaction(async (tx) => {
  await tx.invitation.update({
    where: { id: consumed.id },
    data: { status: 'accepted', consumedAt: new Date(), consumedByUserId: newUserId },
  });
  await tx.user.update({
    where: { id: newUserId },
    data: { firstName, lastName },
  });
  const newMembership = await tx.membership.create({
    data: {
      workspaceId: consumed.workspaceId,
      userId: newUserId,
      role: consumed.role,
    },
    select: { id: true },
  });
  // Materialise the persisted scope as WorkspaceAccess rows. Empty arrays
  // = no restriction (the default for User). Viewer always has at least
  // one row because createInvitation refused otherwise.
  const accessRows = [
    ...consumed.scopeClientIds.map((clientId) => ({
      workspaceId: consumed.workspaceId,
      membershipId: newMembership.id,
      clientId,
      projectId: null,
      createdById: consumed.createdById,
    })),
    ...consumed.scopeProjectIds.map((projectId) => ({
      workspaceId: consumed.workspaceId,
      membershipId: newMembership.id,
      clientId: null,
      projectId,
      createdById: consumed.createdById,
    })),
  ];
  if (accessRows.length > 0) {
    await tx.workspaceAccess.createMany({ data: accessRows });
  }
});
```

Also extend the inner select on line 80–89 to include `createdById` so the access rows have a sensible audit trail.

### Step 6: Verify

```bash
pnpm --filter @nexushub/web typecheck
pnpm --filter @nexushub/web lint
pnpm test
```

All green. New test count = 128 + 5 (3 new in create-invitation + 2 swapped in change-member-role).

### Step 7: Commit

```bash
git add \
  apps/web/features/invitations/actions/create-invitation.ts \
  apps/web/features/invitations/actions/create-invitation.test.ts \
  apps/web/features/team/actions/change-member-role.ts \
  apps/web/features/team/actions/change-member-role.test.ts \
  apps/web/features/invitations/actions/accept-invitation.ts
git commit -m "feat(team): unblock Viewer; invitation persists scope, acceptance materialises it"
```

---

## Task 4: Invitation form — conditional scope picker

**Files:**

- Modify: `apps/web/features/team/components/invitation-form.tsx`
- Modify: `apps/web/app/(app)/team/page.tsx`

### Step 1: Pass scope lookup data to the form

In `(app)/team/page.tsx`, the Promise.all already fetches `clientOptions` and `projectOptions` for the scope modal (in B.1). Pass them to `<InvitationForm>` too:

```tsx
<InvitationForm
  csrfToken={csrf}
  clientOptions={clientOptions}
  projectOptions={projectOptionsShaped}
/>
```

### Step 2: Update `invitation-form.tsx` props + state

a) New props:

```typescript
interface Props {
  readonly csrfToken: string;
  readonly clientOptions: readonly { id: string; name: string }[];
  readonly projectOptions: readonly {
    id: string;
    name: string;
    clientId: string;
    clientName: string;
  }[];
}
```

b) Local state for the picker:

```typescript
import { useState } from 'react';

// inside the component:
const [role, setRole] = useState<'admin' | 'user' | 'viewer'>('user');
const [clientIds, setClientIds] = useState<readonly string[]>([]);
const [projectIds, setProjectIds] = useState<readonly string[]>([]);

const clientIdsSet = new Set(clientIds);
const inheritedProjectIds = new Set(
  projectOptions.filter((p) => clientIdsSet.has(p.clientId)).map((p) => p.id),
);

const toggleClient = (id: string) =>
  setClientIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
const toggleProject = (id: string) => {
  const proj = projectOptions.find((p) => p.id === id);
  if (!proj) return;
  if (clientIdsSet.has(proj.clientId)) {
    // drill-down: replicate the ScopeModal behaviour
    const siblings = projectOptions
      .filter((p) => p.clientId === proj.clientId && p.id !== id)
      .map((p) => p.id);
    setClientIds((prev) => prev.filter((c) => c !== proj.clientId));
    setProjectIds((prev) => {
      const next = new Set(prev);
      for (const s of siblings) next.add(s);
      next.delete(id);
      return [...next];
    });
    return;
  }
  setProjectIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
};
```

c) Replace the existing `<select>` with one that updates state:

```tsx
<select
  id="invite-role"
  name="role"
  value={role}
  onChange={(e) => setRole(e.target.value as 'admin' | 'user' | 'viewer')}
  className="field-select"
>
  <option value="user">User</option>
  <option value="admin">Admin</option>
  <option value="viewer">Viewer</option>
</select>
```

(The `viewer` option is no longer disabled.)

d) Render the scope picker conditionally — when `role !== 'admin'`, show a collapsible "Scope" section. For Viewer the section is mandatory; for User it's optional.

Insert directly above the existing helper paragraph at the bottom of the form:

```tsx
{
  role !== 'admin' ? (
    <div className="mt-4 rounded-xl border border-[color:var(--color-border-light)] p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[11px] font-extrabold uppercase tracking-[1px] text-[color:var(--color-text-muted)]">
          Scope {role === 'viewer' ? '· requis' : '· optionnel'}
        </h3>
        <span className="text-[10px] text-[color:var(--color-text-muted)]">
          Aucune coche = accès à tout le workspace
        </span>
      </div>
      <input type="hidden" name="scopeClientIds" value={clientIds.join(',')} />
      <input type="hidden" name="scopeProjectIds" value={projectIds.join(',')} />
      <div className="grid grid-cols-2 gap-3">
        <section>
          <h4 className="mb-1 text-[10px] font-extrabold uppercase text-[color:var(--color-text-muted)]">
            Clients ({clientIds.length})
          </h4>
          <ul className="max-h-40 overflow-y-auto rounded-md border border-[color:var(--color-border-light)] p-1.5">
            {clientOptions.map((c) => (
              <li key={c.id}>
                <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-[color:var(--color-bg-muted)]">
                  <input
                    type="checkbox"
                    checked={clientIds.includes(c.id)}
                    onChange={() => toggleClient(c.id)}
                  />
                  {c.name}
                </label>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h4 className="mb-1 text-[10px] font-extrabold uppercase text-[color:var(--color-text-muted)]">
            Projets ({projectIds.length + inheritedProjectIds.size})
          </h4>
          <ul className="max-h-40 overflow-y-auto rounded-md border border-[color:var(--color-border-light)] p-1.5">
            {projectOptions.map((p) => {
              const inherited = inheritedProjectIds.has(p.id);
              const checked = inherited || projectIds.includes(p.id);
              return (
                <li key={p.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-[color:var(--color-bg-muted)]">
                    <input type="checkbox" checked={checked} onChange={() => toggleProject(p.id)} />
                    <span className="flex flex-col">
                      <span>{p.name}</span>
                      <span className="text-[9px] text-[color:var(--color-text-muted)]">
                        {p.clientName}
                        {inherited ? ' · inclus via le client' : null}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  ) : null;
}
```

e) Update the helper paragraph for the new flow:

```tsx
<p className="mt-3 text-xs text-[color:var(--color-text-muted)]">
  L&apos;invitation envoie un lien à usage unique valide 72h. La personne définira son mot de passe
  en arrivant sur NexusHub.
  {role === 'viewer' ? ' Le scope choisi sera matérialisé automatiquement à l’acceptation.' : ''}
</p>
```

### Step 3: Verify

```bash
pnpm --filter @nexushub/web typecheck && pnpm --filter @nexushub/web lint && pnpm test
```

All green.

### Step 4: Commit

```bash
git add apps/web/features/team/components/invitation-form.tsx "apps/web/app/(app)/team/page.tsx"
git commit -m "feat(team): conditional scope picker in invitation form"
```

---

## Task 5: `/my-projects` route + adaptive sidebar

**Files:**

- Create: `apps/web/app/(app)/my-projects/page.tsx`
- Create: `apps/web/app/(app)/my-projects/loading.tsx`
- Create: `apps/web/features/shell/components/sidebar-viewer.tsx`
- Modify: `apps/web/app/(app)/layout.tsx`

### Step 1: `/my-projects/page.tsx`

A simple scope-aware grid of projects grouped by client. Mirror the `/projects` page's layout but filter by the user's actual scope (so for a Viewer with one shared project they see just that project).

```tsx
import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@nexushub/db';
import { requireUser } from '@/lib/auth';
import { loadUserScope, scopedProjectWhere } from '@/lib/auth/scope';

export const metadata: Metadata = { title: 'Mes projets' };

export default async function MyProjectsPage() {
  const ctx = await requireUser();
  const scope = await loadUserScope(ctx);

  const projects = await prisma.project.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      deletedAt: null,
      archivedAt: null,
      ...scopedProjectWhere(scope),
    },
    orderBy: [{ client: { name: 'asc' } }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      description: true,
      client: { select: { id: true, name: true, colorToken: true } },
      _count: { select: { cards: { where: { deletedAt: null } } } },
    },
  });

  // Group by client name for the visual sections.
  const byClient = new Map<string, typeof projects>();
  for (const p of projects) {
    const key = p.client.name;
    const list = byClient.get(key) ?? [];
    list.push(p);
    byClient.set(key, list);
  }

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-8">
        <h1 className="text-[34px] font-extrabold tracking-tight">Mes projets</h1>
        <p className="mt-2 text-sm text-[color:var(--color-text-muted)]">
          Les projets auxquels tu as accès dans cet espace.
        </p>
      </header>

      {projects.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-10 text-center">
          <h2 className="text-xl font-extrabold tracking-tight">Aucun projet partagé</h2>
          <p className="mt-2 text-sm text-[color:var(--color-text-muted)]">
            Quand un Admin partagera un projet avec toi, il apparaîtra ici.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {Array.from(byClient.entries()).map(([clientName, list]) => (
            <section key={clientName}>
              <h2 className="mb-3 flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-[1px] text-[color:var(--color-text-muted)]">
                <span
                  aria-hidden="true"
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: `var(--${list[0]!.client.colorToken})` }}
                />
                {clientName}
              </h2>
              <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {list.map((p) => (
                  <li key={p.id}>
                    <Link
                      href={`/projects/${p.id}`}
                      className="block rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-5 shadow-[var(--shadow-card)] transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-hover)]"
                    >
                      <h3 className="text-lg font-extrabold tracking-tight">{p.name}</h3>
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
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
```

### Step 2: `/my-projects/loading.tsx`

```tsx
export default function MyProjectsLoading() {
  return (
    <div className="nx-fade-in mx-auto max-w-6xl">
      <header className="mb-8">
        <div className="nx-skeleton mb-2" style={{ height: 36, width: 200 }} />
        <div className="nx-skeleton" style={{ height: 14, width: 320 }} />
      </header>
      <div className="flex flex-col gap-8">
        {Array.from({ length: 2 }, (_, ci) => (
          <section key={ci}>
            <div className="nx-skeleton mb-3" style={{ height: 12, width: 140 }} />
            <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 3 }, (_, pi) => (
                <li
                  key={pi}
                  className="rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-5"
                >
                  <div className="nx-skeleton mb-2" style={{ height: 18, width: '70%' }} />
                  <div className="nx-skeleton" style={{ height: 12, width: '90%' }} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
```

### Step 3: `sidebar-viewer.tsx`

A minimal sidebar variant — just brand + a single link to `/my-projects` + the user chip in the footer. We render the same `<Sidebar>` primitive but with a stripped-down content tree.

```tsx
import { Sidebar, SidebarBrand, SidebarFooter, SidebarSectionCollapsible } from '@nexushub/ui';
import { NavLink } from './nav-link';
import { UserChip } from './user-chip';
import { DashboardIcon, GearIcon } from './icons';

export interface SidebarViewerProps {
  readonly workspaceName: string;
  readonly displayName: string;
  readonly initials: string;
}

export function SidebarViewer({ workspaceName, displayName, initials }: SidebarViewerProps) {
  return (
    <Sidebar>
      <SidebarBrand mark="N" name="NexusHub" subtitle={workspaceName} />

      <SidebarSectionCollapsible
        label="Espace"
        storageKey="viewer-main"
        defaultOpen
        icon={<DashboardIcon />}
      >
        <NavLink href="/my-projects" icon="◱" label="Mes projets" />
      </SidebarSectionCollapsible>

      <SidebarSectionCollapsible label="Compte" storageKey="viewer-account" icon={<GearIcon />}>
        <NavLink href="/settings" icon="⚙" label="Paramètres" />
      </SidebarSectionCollapsible>

      <SidebarFooter>
        <UserChip displayName={displayName} initials={initials} role="Viewer" />
      </SidebarFooter>
    </Sidebar>
  );
}
```

### Step 4: Branch the layout on role

In `apps/web/app/(app)/layout.tsx`, at the top of the JSX return, branch:

```tsx
const isViewer = ctx.role === 'viewer';

// ...

return (
  <div className="grid min-h-screen grid-cols-[260px_1fr]">
    {isViewer ? (
      <SidebarViewer workspaceName={workspace.name} displayName={displayName} initials={initials} />
    ) : (
      <Sidebar>{/* existing full sidebar content */}</Sidebar>
    )}
    {/* rest unchanged */}
  </div>
);
```

Import the new component at the top of the file.

### Step 5: Verify + commit

```bash
pnpm --filter @nexushub/web typecheck && pnpm --filter @nexushub/web lint && pnpm test
```

All green.

```bash
git add \
  "apps/web/app/(app)/my-projects/" \
  apps/web/features/shell/components/sidebar-viewer.tsx \
  "apps/web/app/(app)/layout.tsx"
git commit -m "feat(team): /my-projects route + Viewer-only sidebar"
```

---

## Task 6: `shareProjectWithViewer` action + Partager modal

**Files:**

- Create: `apps/web/features/projects/actions/share-project-with-viewer.ts`
- Create: `apps/web/features/projects/actions/share-project-with-viewer.test.ts`
- Create: `apps/web/features/projects/components/share-project-modal.tsx`
- Create: `apps/web/features/projects/components/share-project-button.tsx`
- Modify: `apps/web/app/(app)/projects/[id]/page.tsx`

### Step 1: Server action

File: `apps/web/features/projects/actions/share-project-with-viewer.ts`

```typescript
'use server';
import 'server-only';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { z } from 'zod';
import { prisma } from '@nexushub/db';
import { Roles } from '@nexushub/domain';
import { requireUser } from '@/lib/auth';
import { loadUserScope } from '@/lib/auth/scope';
import { assertCsrfFromFormData } from '@/lib/csrf';
import { recordAudit } from '@/lib/audit';
import { getClientIp } from '@/lib/rate-limit';

const Schema = z.object({
  projectId: z.string().uuid(),
  membershipId: z.string().uuid(),
  /** 'share' to grant, 'unshare' to revoke. */
  mode: z.enum(['share', 'unshare']),
});

export type ShareResult = { readonly ok: true } | { readonly ok: false; readonly message: string };

export async function shareProjectWithViewer(input: {
  projectId: string;
  membershipId: string;
  mode: 'share' | 'unshare';
  csrfToken: string;
}): Promise<ShareResult> {
  // We don't take a FormData here; the modal POSTs JSON via fetch.
  // CSRF token comes through an explicit header check in the route?
  // Simpler: encode as FormData.
  const fd = new FormData();
  fd.set('projectId', input.projectId);
  fd.set('membershipId', input.membershipId);
  fd.set('mode', input.mode);
  fd.set('_csrf', input.csrfToken);
  await assertCsrfFromFormData(fd);

  const ctx = await requireUser();

  const parsed = Schema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Données invalides.' };

  const project = await prisma.project.findFirst({
    where: { id: parsed.data.projectId, workspaceId: ctx.workspaceId, deletedAt: null },
    select: { id: true, clientId: true },
  });
  if (!project) return { ok: false, message: 'Projet introuvable.' };

  // Permission: Admin/super-admin always; otherwise a User whose scope
  // covers the project. (A Viewer never shares.)
  if (ctx.role !== Roles.Admin && !ctx.isSuperAdmin) {
    if (ctx.role === Roles.Viewer) {
      return { ok: false, message: 'Action réservée aux Admins.' };
    }
    const scope = await loadUserScope(ctx);
    if (scope.kind === 'restricted') {
      const allowed =
        scope.projectIds.includes(project.id) || scope.clientIds.includes(project.clientId);
      if (!allowed) return { ok: false, message: 'Projet hors de ton scope.' };
    }
  }

  // Target must be a Viewer in this workspace.
  const target = await prisma.membership.findUnique({
    where: { id: parsed.data.membershipId },
    select: { workspaceId: true, role: true },
  });
  if (!target || target.workspaceId !== ctx.workspaceId) {
    return { ok: false, message: 'Membre introuvable.' };
  }
  if (target.role !== Roles.Viewer) {
    return { ok: false, message: 'Le partage projet ne concerne que les Viewers.' };
  }

  const reqHeaders = await headers();
  const ip = getClientIp(reqHeaders);
  const ua = reqHeaders.get('user-agent') ?? null;

  if (parsed.data.mode === 'share') {
    // Upsert-ish: don't create a duplicate if it already exists.
    const existing = await prisma.workspaceAccess.findFirst({
      where: {
        workspaceId: ctx.workspaceId,
        membershipId: parsed.data.membershipId,
        projectId: parsed.data.projectId,
      },
      select: { id: true },
    });
    if (!existing) {
      await prisma.workspaceAccess.create({
        data: {
          workspaceId: ctx.workspaceId,
          membershipId: parsed.data.membershipId,
          projectId: parsed.data.projectId,
          clientId: null,
          createdById: ctx.userId,
        },
      });
    }
    await recordAudit({
      action: 'workspace_access_granted',
      workspaceId: ctx.workspaceId,
      actorId: ctx.userId,
      subjectType: 'membership',
      subjectId: parsed.data.membershipId,
      data: { projectId: parsed.data.projectId },
      ip,
      userAgent: ua,
    });
  } else {
    await prisma.workspaceAccess.deleteMany({
      where: {
        workspaceId: ctx.workspaceId,
        membershipId: parsed.data.membershipId,
        projectId: parsed.data.projectId,
      },
    });
    await recordAudit({
      action: 'workspace_access_revoked',
      workspaceId: ctx.workspaceId,
      actorId: ctx.userId,
      subjectType: 'membership',
      subjectId: parsed.data.membershipId,
      data: { projectId: parsed.data.projectId },
      ip,
      userAgent: ua,
    });
  }

  revalidatePath(`/projects/${parsed.data.projectId}`);
  return { ok: true };
}
```

### Step 2: 4 integration specs

File: `apps/web/features/projects/actions/share-project-with-viewer.test.ts`

Mirror the existing `set-user-scope.test.ts` mock pattern. Specs:

1. Admin shares an existing Viewer with a project → returns ok, calls workspaceAccess.create.
2. Refuses when target membership is not a Viewer (e.g. a User) → returns error.
3. Refuses when project is in a different workspace → returns error.
4. Mode='unshare' calls deleteMany.

Full code: same skeleton as set-user-scope.test.ts. Use `requireUser` mock (not requireAdmin) so we can test the User-with-scope branch separately if desired. For the 4 specs above, all use admin context.

### Step 3: Modal + button

File: `apps/web/features/projects/components/share-project-button.tsx`

```tsx
'use client';
import { useState } from 'react';
import { ShareProjectModal } from './share-project-modal';

interface Viewer {
  readonly membershipId: string;
  readonly displayName: string;
  readonly email: string;
  readonly hasAccess: boolean;
}

export interface ShareProjectButtonProps {
  readonly projectId: string;
  readonly projectName: string;
  readonly csrfToken: string;
  readonly viewers: readonly Viewer[];
}

export function ShareProjectButton(props: ShareProjectButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn btn-ghost btn-sm">
        Partager
      </button>
      {open ? <ShareProjectModal {...props} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
```

File: `apps/web/features/projects/components/share-project-modal.tsx`

```tsx
'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { shareProjectWithViewer } from '../actions/share-project-with-viewer';

interface Viewer {
  readonly membershipId: string;
  readonly displayName: string;
  readonly email: string;
  readonly hasAccess: boolean;
}

export interface ShareProjectModalProps {
  readonly projectId: string;
  readonly projectName: string;
  readonly csrfToken: string;
  readonly viewers: readonly Viewer[];
  readonly onClose: () => void;
}

export function ShareProjectModal({
  projectId,
  projectName,
  csrfToken,
  viewers,
  onClose,
}: ShareProjectModalProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // Local optimistic state so toggling each checkbox feels instant.
  const [accessMap, setAccessMap] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(viewers.map((v) => [v.membershipId, v.hasAccess])),
  );

  const toggle = (membershipId: string, currentValue: boolean) => {
    const next = !currentValue;
    setAccessMap((prev) => ({ ...prev, [membershipId]: next }));
    setErrorMsg(null);
    startTransition(async () => {
      const res = await shareProjectWithViewer({
        projectId,
        membershipId,
        mode: next ? 'share' : 'unshare',
        csrfToken,
      });
      if (!res.ok) {
        setAccessMap((prev) => ({ ...prev, [membershipId]: currentValue }));
        setErrorMsg(res.message);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="w-full max-w-md rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-6 shadow-2xl">
        <h2 id="share-modal-title" className="text-xl font-extrabold tracking-tight">
          Partager {projectName}
        </h2>
        <p className="mt-1 text-sm text-[color:var(--color-text-muted)]">
          Coche les Viewers de cet espace qui doivent avoir accès à ce projet.
        </p>

        {viewers.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-[color:var(--color-border-light)] p-4 text-center text-sm text-[color:var(--color-text-muted)]">
            Aucun Viewer dans cet espace. Invite un Viewer depuis la page Équipe d&apos;abord.
          </p>
        ) : (
          <ul className="mt-4 max-h-72 overflow-y-auto rounded-xl border border-[color:var(--color-border-light)] p-2">
            {viewers.map((v) => (
              <li key={v.membershipId}>
                <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-[color:var(--color-bg-muted)]">
                  <input
                    type="checkbox"
                    checked={accessMap[v.membershipId] ?? false}
                    onChange={() => toggle(v.membershipId, accessMap[v.membershipId] ?? false)}
                    disabled={pending}
                  />
                  <span className="flex flex-col">
                    <span>{v.displayName}</span>
                    <span className="text-[10px] text-[color:var(--color-text-muted)]">
                      {v.email}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}

        {errorMsg ? (
          <p
            role="alert"
            className="mt-3 rounded-md border border-[color:var(--color-danger)] bg-[color:var(--color-danger-bg)] px-3 py-2 text-sm font-medium text-[color:var(--color-danger)]"
          >
            {errorMsg}
          </p>
        ) : null}

        <div className="mt-5 flex justify-end">
          <button type="button" onClick={onClose} className="btn btn-primary btn-sm">
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}
```

### Step 4: Wire the button into the project page

In `apps/web/app/(app)/projects/[id]/page.tsx`:

a) Fetch the workspace's Viewers + their per-project access in the existing Promise.all:

```typescript
prisma.membership.findMany({
  where: { workspaceId: ctx.workspaceId, role: 'viewer' },
  select: {
    id: true,
    user: { select: { firstName: true, lastName: true, email: true } },
    workspaceAccess: {
      where: { projectId: id },
      select: { id: true },
    },
  },
}),
```

Add the result to the destructured array (e.g. `viewers`).

b) Shape the data for the modal:

```typescript
const viewerOptions = viewers.map((v) => {
  const displayName =
    [v.user.firstName, v.user.lastName].filter(Boolean).join(' ').trim() || v.user.email;
  return {
    membershipId: v.id,
    displayName,
    email: v.user.email,
    hasAccess: v.workspaceAccess.length > 0,
  };
});
```

c) In the JSX, between `<ViewToggle />` and `<DeleteProjectButton />`, render the share button **only if the current user has share permission**:

```tsx
{
  canShare ? (
    <ShareProjectButton
      projectId={project.id}
      projectName={project.name}
      csrfToken={csrf}
      viewers={viewerOptions}
    />
  ) : null;
}
```

where `canShare` is computed near the top:

```typescript
const canShare =
  ctx.isSuperAdmin ||
  ctx.role === 'admin' ||
  (ctx.role === 'user' &&
    (scope.kind === 'workspace' ||
      scope.projectIds.includes(id) ||
      scope.clientIds.includes(project.client.id)));
```

### Step 5: Verify + commit

```bash
pnpm --filter @nexushub/web typecheck && pnpm --filter @nexushub/web lint && pnpm test
```

All green. Test count grows by 4 (the new share-project specs).

```bash
git add \
  apps/web/features/projects/actions/share-project-with-viewer.ts \
  apps/web/features/projects/actions/share-project-with-viewer.test.ts \
  apps/web/features/projects/components/share-project-button.tsx \
  apps/web/features/projects/components/share-project-modal.tsx \
  "apps/web/app/(app)/projects/[id]/page.tsx"
git commit -m "feat(team): shareProjectWithViewer action + Partager modal on project pages"
```

---

## Task 7: Manual smoke + progress.md

- [ ] **Step 1: Start dev**

```bash
pnpm dev
```

- [ ] **Step 2: As Admin, invite a Viewer with scope**

1. Log in as Admin (`angelo.geraci@brandnewday.agency`).
2. Open `/team`. Select role **Viewer**. The scope picker appears with "requis".
3. Pick 1 client (e.g. Acme). Submit.
4. Invitation row appears with role **Viewer**.
5. From the dev log, grab the accept URL.

- [ ] **Step 3: Accept as the Viewer**

1. Private window. Paste the accept URL. Set password.
2. Land on the app — sidebar shows ONLY "Mes projets" + "Paramètres".
3. `/my-projects` lists Acme projects (the scoped client's projects).
4. Click a project → opens the Kanban board for that project.
5. Try opening `/projects` directly → 404 (route doesn't apply).

- [ ] **Step 4: As Admin, share another project with that Viewer via the modal**

1. Log back in as Admin (other browser).
2. Open a project of a different client (e.g. Lumen).
3. Click "Partager". The Viewer appears in the list, unchecked.
4. Check the box. Optimistic check, server confirms.
5. Reload as the Viewer → the new project appears under Lumen on `/my-projects`.

- [ ] **Step 5: As Admin, uncheck the share**

1. Open the project page again, click Partager.
2. Uncheck the Viewer's box.
3. Reload as the Viewer → the project is gone from `/my-projects`.

- [ ] **Step 6: Update `progress.md`**

Find section 9.6. Under it, add:

```markdown
### 9.7 User management — Phase B.2 (Viewer activation) ✅ (2026-05-17)

- [x] DB: `Invitation.scope_client_ids` + `scope_project_ids` UUID arrays so the invite-time scope survives until acceptance
- [x] Server: `createInvitation` accepts the scope CSV + refuses a Viewer with no scope (3 new specs)
- [x] Server: `changeMemberRole` allows promoting to Viewer only if scope rows already exist (2 swapped specs)
- [x] Server: `acceptInvitation` materialises the persisted scope as `WorkspaceAccess` rows inside the membership-creation transaction
- [x] UI: invitation form has a conditional scope picker (clients + projects multi-select with drill-down, just like the /team scope modal) — required when role=viewer, optional when role=user
- [x] Route: `/my-projects` lists the user's scope-visible projects grouped by client (loading skeleton included)
- [x] Sidebar: Viewer-only variant renders just "Mes projets" + "Paramètres"; the layout branches on `ctx.role === 'viewer'`
- [x] Server + UI: `shareProjectWithViewer` action (4 specs) + "Partager" modal on the project page (visible to Admin or User-in-scope, hidden for Viewer); optimistic toggle with rollback
- [x] Smoke vérifié : Admin invite Viewer scopé → acceptation crée membership + WorkspaceAccess → Viewer voit /my-projects scopé → Partager modal ajoute/retire un projet en temps réel
- [ ] **Plan B.3 (later)**: Viewer-can-comment once the Comment server actions exist (Phase 8)
- [ ] **Phase C**: console `/super-admin` (CRUD workspaces, liste globale users, promotion super-admin)
```

Also bump the header date to `2026-05-17`.

- [ ] **Step 7: Commit**

```bash
git add progress.md
git commit -m "docs(progress): close user-management Phase B.2 (Viewer activation)"
```

---

## Plan B.2 Definition of Done

- [ ] Migration `20260517100001_invitation_scope` applies cleanly.
- [ ] Domain + app tests pass: createInvitation now has 3 viewer-specific specs, changeMemberRole has 2 viewer-specific specs, shareProjectWithViewer has 4 specs.
- [ ] `pnpm --filter @nexushub/web typecheck` green.
- [ ] `pnpm --filter @nexushub/web lint` green.
- [ ] `pnpm test` green across the monorepo.
- [ ] Manual smoke passes — Admin invites Viewer with scope, Viewer accepts, lands on `/my-projects` with sidebar showing only that route, Admin shares an additional project via the modal, Viewer sees it on reload.
- [ ] `progress.md` updated with section 9.7 and the date bumped.
- [ ] All commits pushed to `main`.
