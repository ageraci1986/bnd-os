# User Management — Design

> **Status:** Design approved 2026-05-14 (brainstorm session)
> **Owner:** Angelo L.
> **Implementation:** phased — Phase A (this design's first plan) ships the role model + super-admin flag; Phase B ships scoping & project ACL; Phase C ships the super-admin console. Each phase gets its own implementation plan; this single design document is the source of truth for all three.

## Goal

Replace the current flat `admin | member` role with a two-level access model that lets NexusHub:

1. Host multiple agencies cleanly (each agency = one workspace, isolated).
2. Give one platform-level operator (Angelo) cross-workspace visibility + control.
3. Let each agency Admin manage their own team without bothering the platform owner.
4. Restrict junior staff, freelancers, and external client validators to specific projects or specific clients without exposing the rest of the workspace.

## Non-goals

These belong to later iterations and are explicitly out of scope here:

- **Impersonation** (super-admin / admin steps into a user's session). Heavy feature with audit, banner, session security — deferred to **V1.5** with its own design.
- **Per-user pricing / seat billing.** Out of scope for V1.
- **Service accounts / API keys.** Integrations still happen through OAuth on a User. V1.5+.
- **Multi-workspace memberships UX.** Schema allows it; UI assumes one workspace per user for V1 (no workspace switcher).
- **Scoping for the Admin role.** Admin is always full-workspace; there is no "admin restricted to client X" concept.
- **Recursive invitation tree** ("admin sees only his invitees"). Workspace isolation provides this naturally — one Admin = one workspace in the agency model. We do **not** add an `invitedById` chain.

## Architecture

Two orthogonal concepts:

### 1. Platform-level — `User.isSuperAdmin: boolean`

A single boolean flag on `users`. The super-admin sees and can act across every workspace. **One column on `users`. Not an enum value, not a Membership.** Bootstrapped via a migration that flips the flag for `ageraci.finance@gmail.com`. Future promotions/demotions happen via the Phase C console.

### 2. Workspace-level — `Membership.role` enum

Each `Membership` (User × Workspace) has a role. The enum is being extended:

```
enum Role {
  admin    # full workspace, manage team, manage integrations, ...
  user     # CRUD inside their scope; if no scope → full workspace
  viewer   # read + comment inside their scope; scope is required
}
```

The existing `member` value is renamed to `user`. Existing rows are migrated.

### 3. Scope — `WorkspaceAccess` table

Optional rows that **restrict** a User or Viewer to specific resources within a workspace. Admins are always full-workspace; no rows apply to them.

```prisma
model WorkspaceAccess {
  id           String  @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  workspaceId  String  @map("workspace_id") @db.Uuid
  membershipId String  @map("membership_id") @db.Uuid
  clientId     String? @map("client_id") @db.Uuid
  projectId    String? @map("project_id") @db.Uuid
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  createdById  String  @map("created_by_id") @db.Uuid

  workspace    Workspace  @relation(...)
  membership   Membership @relation(...)
  client       Client?    @relation(...)
  project      Project?   @relation(...)
  createdBy    User       @relation(...)

  // Exactly one of clientId / projectId is non-null.
  @@check((client_id IS NOT NULL AND project_id IS NULL) OR (client_id IS NULL AND project_id IS NOT NULL))
  @@unique([membershipId, clientId])
  @@unique([membershipId, projectId])
  @@index([workspaceId])
}
```

**Semantics:**

- **Admin**: scope never applies. They see everything in the workspace.
- **User without rows**: full workspace. Same behaviour as today's `member`.
- **User with rows**: restricted to the listed clients + projects. Can CRUD inside the scope (create a project under a scoped client, edit cards on a scoped project). Cannot create resources outside the scope.
- **Viewer**: scope is **required** (the invitation flow forces at least one row). Read + comment only, within the scope.

The scope is **additive**: a user with `{ clientId: Acme } + { projectId: P-of-Beta }` sees all Acme projects **plus** project P. Future projects added under Acme are auto-included; no manual update needed.

## Permission matrix

| Action                                                       | Super-admin | Admin    | User                           | Viewer       |
| ------------------------------------------------------------ | ----------- | -------- | ------------------------------ | ------------ |
| Signup → create own workspace                                | —           | ✓ (auto) | —                              | —            |
| Create workspace for a third party                           | ✓ (Phase C) | ✗        | ✗                              | ✗            |
| See all workspaces                                           | ✓           | own only | own only                       | own only     |
| Invite user (any role) to a workspace                        | ✓ (any)     | ✓ (own)  | ✗                              | ✗            |
| Define a user/viewer scope at invitation                     | ✓           | ✓        | ✗                              | ✗            |
| Modify a user/viewer scope after the fact                    | ✓           | ✓        | ✗                              | ✗            |
| Remove user from workspace                                   | ✓           | ✓        | ✗                              | ✗            |
| Change user role                                             | ✓           | ✓        | ✗                              | ✗            |
| Promote / demote super-admin                                 | ✓           | ✗        | ✗                              | ✗            |
| Assign user to project (ProjectMember Lead/Member)           | ✓           | ✓        | ✗                              | ✗            |
| **Share an existing project with a Viewer of the workspace** | ✓           | ✓        | ✓ (on projects in their scope) | ✗            |
| CRUD clients / projects / templates                          | ✓           | ✓        | ✓ (in scope)                   | ✗            |
| Read project + leave comments                                | ✓           | ✓        | ✓ (in scope)                   | ✓ (in scope) |
| Manage workspace integrations                                | ✓           | ✓        | ✗                              | ✗            |
| Edit own profile                                             | ✓           | ✓        | ✓                              | ✓            |
| Impersonation                                                | (V1.5)      | (V1.5)   | ✗                              | ✗            |

## Invariants

These rules are enforced by DB constraint + domain validation + UI:

1. **Last Admin protection** (existing): a workspace cannot have zero Admins. The only Admin cannot be demoted or removed.
2. **Last Super-admin protection** (new): the platform cannot have zero super-admins. The only super-admin cannot lose their flag.
3. **Self-demote guard** (existing, extended): an Admin who is the only Admin cannot change their own role to `user`/`viewer`.
4. **Viewer requires scope**: creating a Viewer Membership with no `WorkspaceAccess` row is forbidden (DB check or app-level guard at invite time).
5. **Scope row exclusivity**: each `WorkspaceAccess` row has exactly one of `clientId` / `projectId` set (DB check).
6. **Scope row scope match**: the referenced `clientId` / `projectId` must belong to the same `workspaceId` as the Membership (foreign-key + same-workspace check).
7. **Admin scoping is forbidden**: a Membership with `role = admin` cannot have `WorkspaceAccess` rows (app-level guard; if rows exist on role change → bail and require explicit removal).

## Server-side enforcement

### Helpers (extended)

`requireUser` already returns `{ userId, workspaceId, role }`. It gets two new shapes:

```ts
// Existing
const ctx = await requireUser(); // any role

// New
const ctx = await requireAdmin(); // admin OR super-admin
const ctx = await requireSuperAdmin(); // super-admin only
const scope = await loadUserScope(ctx); // returns { kind: 'workspace' } | { kind: 'restricted', clientIds, projectIds }
```

`loadUserScope` caches per-request (memoized on the request context).

### Query scoping

A new helper `scopedCardWhere`, `scopedProjectWhere`, `scopedClientWhere` returns a `Prisma.WhereInput` partial that's spread into every list query. They short-circuit when scope is `workspace`:

```ts
const where = await scopedProjectWhere(ctx); // { } for admin/full-user; { OR: [...] } for restricted
const projects = await prisma.project.findMany({
  where: { workspaceId: ctx.workspaceId, deletedAt: null, ...where },
});
```

This is the same pattern as `buildCardFilterClauses` (Phase 5.9). Every read path that returns a list of clients / projects / cards / communications goes through one of these helpers — **no exceptions**.

### Write enforcement

Mutating Server Actions check the scope before writing:

- `createProject({ clientId })` — verify the User's scope allows that client.
- `updateProject(id, ...)` — verify the User's scope allows that project (or its client).
- `deleteProject(id)` — same.
- Similar for Client and Card mutations.
- `inviteUser`, `removeUser`, `changeMemberRole`, `setUserScope` — all require admin.
- `shareProjectWithViewer({ projectId, viewerMembershipId })` — requires admin **OR** a User whose scope covers the project; the target Viewer must already exist as a Membership in the workspace.

### Comments for Viewers

The existing `Comment` model already supports User authorship. The Server Action `createComment` checks the actor's role and scope:

- Admin / User in scope → allowed.
- Viewer in scope → allowed (this is the only write Viewers can do).
- Out of scope → 403.

## UI flows

### `/team` page (Phase A delivery)

- **Member list**: each row shows the Membership role with a colored badge (`admin` = purple/gradient, `user` = neutral, `viewer` = blue). A super-admin badge appears in addition for users with `isSuperAdmin = true`. The current user sees themselves with a "(vous)" suffix.
- **Invitation form**: dropdown `Rôle = admin / user / viewer`, default `user`. Phase A keeps the scope picker out (User defaults to full workspace, Viewer is not yet usable without scope — Phase B unlocks it).
- **Role change**: Admins can edit any row's role except enforcing the last-Admin guard. Toast on success.
- **Removal**: same as today, with last-Admin guard.

### `/team` — scope management (Phase B delivery)

- Each member row gets a "Scope" column. Admins see chip(s): `Tout le workspace`, or `Acme + 2 projets`, etc.
- Click → modal "Scope de [User]": list of clients with checkboxes + a section "Projets spécifiques" with multi-select. Save → updates `WorkspaceAccess` rows in a transaction.
- Invitation form (Phase B revision) adds the scope picker that appears conditionally:
  - Role = Admin → no scope (hidden).
  - Role = User → "Scope": radio `Tout le workspace` (default) | `Restreindre…` (expand).
  - Role = Viewer → "Scope" is **required**; the submit button is disabled until at least one client/project is picked.

### Viewer home (Phase B delivery)

New route `/my-projects` (default landing for Viewers, accessible to anyone). Lists the projects visible under the user's scope, grouped by client. For full-workspace users this is identical to today's `/projects`. For scoped users (User or Viewer) it shows only the in-scope subset.

The shell's sidebar adapts to role:

- **Admin / full User**: today's sidebar.
- **Scoped User**: sidebar shows Overview / Mes projets / Clients (filtered) / Communications (in-scope only) / Templates (read). No Settings → Team. No Integrations management.
- **Viewer**: sidebar shows only `/my-projects` and `/settings/profile`. No clients page, no communications, no templates, no team.

### Project share button (Phase B delivery)

On a project page, the header gets a "Partager" button next to the existing "Tous les projets" link. Visible to Admin and Users-in-scope. Opens a modal listing existing Viewers of the workspace with a checkbox "donner accès". Behind the scenes: writes/removes `WorkspaceAccess` rows with `projectId`. Cannot share with non-Viewer users; for those, the Admin uses the ProjectMember assignment instead.

### Super-admin console (Phase C delivery)

New route `/super-admin`, gated by `isSuperAdmin`. Three sections:

- **Workspaces**: paginated list. Create a workspace + assign initial Admin (invitation auto-sent). Suspend / soft-delete a workspace.
- **Users**: global search by email/name. Click → user detail showing memberships across workspaces + a "Promote to super-admin" / "Demote" button.
- **Audit log**: workspace-scoped or global view of recent admin actions.

## Migration plan

Phase A migrations (Prisma SQL):

1. **Add `isSuperAdmin` column** on `users`, default `false`. Backfill `true` for `ageraci.finance@gmail.com`. (1 reversible migration.)
2. **Extend `Role` enum**: Postgres requires careful handling — `ALTER TYPE "Role" ADD VALUE 'user'`; `ALTER TYPE "Role" ADD VALUE 'viewer'`. These run in their own transaction (Postgres restriction: cannot add enum value in same migration that uses it).
3. **Migrate existing data**: `UPDATE memberships SET role = 'user' WHERE role = 'member'`. Same for `invitations`.
4. **Drop the old `member` value** is unsafe in Postgres if any row references it; we keep it as a deprecated value and remove in a future cleanup migration after the data migration is verified.
5. **Add `last_super_admin_guard` trigger** mirroring the existing last-Admin trigger.

Phase B migrations:

1. **Create `workspace_access` table** with the schema described.
2. **Add RLS policies** for `workspace_access` (workspace-scoped, Admin-only writes).

Phase C migrations:

1. Minor — none required for the console itself; it reads existing tables. May add admin-action audit kinds if needed.

## Audit

The existing `AuditAction` enum already covers `member_role_changed`, `member_removed`, `invitation_created`, `invitation_accepted`, `invitation_revoked`. We add:

```
enum AuditAction {
  ...
  super_admin_promoted     # Phase C
  super_admin_demoted      # Phase C
  workspace_access_granted # Phase B
  workspace_access_revoked # Phase B
  workspace_created_by_super_admin  # Phase C
  workspace_suspended      # Phase C
}
```

Every mutation on Membership / WorkspaceAccess / Workspace logs an entry (workspaceId, actorUserId, targetUserId, before/after JSON).

## Testing strategy

- **Domain tests** (`packages/domain`): `evaluateScopeMatch(scope, resource)` — pure function tested with combinatorial cases (no scope, project scope, client scope, mixed).
- **Permission gate tests**: each Server Action's authorization path covered by an integration test using a test DB.
- **Migration tests**: a script that creates a workspace with the old `member` role, runs the migration, asserts the rows are `user`, asserts the enum has all three values.
- **Last-Admin / last-super-admin guards**: explicit failing test attempting each forbidden transition.
- **E2E (Playwright)**: 4 happy paths — Admin invites + scopes a Viewer; Viewer logs in and only sees the shared project; User-with-client-scope cannot see out-of-scope clients; super-admin promotes another user.

## Phased delivery

### Phase A — Roles + super-admin flag (next implementation plan)

- DB: `User.isSuperAdmin`, `Role` enum extension, data migration `member → user`, last-super-admin trigger.
- Server: `requireAdmin` / `requireSuperAdmin` helpers, role enum exposed to client via existing patterns.
- UI: `/team` invitation form supports the three roles; member rows show role + super-admin badges.
- Behavior: Users behave like today's Members (full workspace). Viewers exist in DB but have no UX yet — invitation form accepts the value, but a Viewer that logs in lands on a placeholder page until Phase B. We block the Phase A invitation form from creating a Viewer (a banner says "Disponible en Phase B") to avoid orphan accounts.

**Definition of done:** an Admin can invite a User; the new user lands and uses the product exactly like today's Members; type/lint/test green; data migration verified on a copy of staging.

### Phase B — Scoping + ACL + Viewer functional

- DB: `workspace_access` table, RLS policies, audit kinds.
- Domain: `loadUserScope`, `scopedClientWhere` / `scopedProjectWhere` / `scopedCardWhere`.
- Server: scope checks on all mutating Server Actions; `shareProjectWithViewer` action; comment authorization for Viewers.
- UI: `/team` adds scope chip + scope modal; invitation form adds the scope picker; `/my-projects` route; sidebar adapts to role; project "Partager" button.

**Definition of done:** Admin invites a Viewer and shares one project with them; Viewer logs in and sees only that project + the client name in the header; can comment on cards; cannot reach any other page in the app; Admin invites a User with `{ clientId: Acme }` scope, that User sees only Acme; out-of-scope mutations 403.

### Phase C — Super-admin console

- UI: `/super-admin` route + 3 sections (Workspaces, Users, Audit).
- Server: workspace CRUD by super-admin, global user search, super-admin promotion.
- Audit: full coverage of platform-level actions.

**Definition of done:** super-admin can create a new workspace from the console, assign its first Admin, list all workspaces, promote another user to super-admin.

## Open questions / risks

- **Postgres enum migration**: adding values requires two migrations (one to add, one to use). The rename `member → user` is via app-level data update; we keep `member` in the enum as deprecated until a separate cleanup migration. Risk: a stale code path could write `member` again. Mitigation: TypeScript types only expose the new enum after Phase A; no code can write `member` post-migration.
- **Scope check performance**: every list query gets a `scoped*Where`. For full-workspace Users (the common case) it short-circuits to `{}`, no overhead. For scoped users, the predicate is a small `OR` clause leveraging existing indexes (`projectId`, `clientId`). Acceptable.
- **Sidebar adaptive rendering** for scoped users: a non-trivial UI refactor. Mitigation: gate it behind role/scope reads on the server in the root layout, render conditionally. Already a pattern used for the auth-gated shell.
- **Viewer onboarding email**: needs a different copy than User invitation ("Vous avez été invité à consulter le projet X chez Agence Y"). Mitigation: the Resend template branches on `role`.
