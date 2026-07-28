# Distribution Lists — Design Spec (Communications iter V1.7)

> **Status:** Approved 2026-07-24 by Angelo L.
> **Prior art:** [`docs/superpowers/specs/2026-07-16-mail-attachments-design.md`](./2026-07-16-mail-attachments-design.md),
> [`docs/superpowers/specs/2026-07-24-recipient-autocomplete-design.md`](./2026-07-24-recipient-autocomplete-design.md)
> **Trigger:** V2 follow-up of the recipient autocomplete iter V1.6 (spec §8 "Distribution lists / groups").

---

## 1. Goal

Let each user save named groups of email recipients (e.g. "Comité BNP" = 5
emails) and reuse them from the ComposePanel's `À` / `Cc` / `Cci` fields.
Typing a group name matches it in the same dropdown as regular contacts;
selecting a group **expands immediately** into N individual chips (silent
dedup against already-chipped emails).

Non-goal: workspace-shared groups, group-as-alias (collapse chip), CSV
import, contacts-across-clients aggregation, standalone contacts (contacts
not attached to a Client). All deferred to V2 — see §8.

Motivation: agencies mail recurring team compositions ("weekly design
review", "monthly BNP steering") multiple times a week. Typing 4-5 emails
by hand each time is friction the autocomplete already partially solves but
doesn't eliminate. Groups turn one keystroke into N recipients.

---

## 2. Scope & sharing model

**Personal only.** Every group belongs to exactly one user; other
workspace members never see it in their dropdown or `/contacts` page. This
matches the MailDraft pattern (one draft per user, no cross-user
visibility) and keeps the RBAC model unchanged.

Owner = creator. Only the owner can edit/delete their own group. No
"transfer ownership", no admin override, no soft-delete for V1 — hard
delete is simple and matches the personal-scope premise (nobody else
depends on your groups).

If a workspace-shared groups feature emerges later, the migration path is
purely additive: add a `shared: boolean` column defaulting to `false`.

---

## 3. Data model

**Migration:** `packages/db/prisma/migrations/YYYYMMDDHHMMSS_recipient_groups/`.

### 3.1 Prisma model

```prisma
model RecipientGroup {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  workspaceId String   @map("workspace_id") @db.Uuid
  userId      String   @map("user_id") @db.Uuid
  /// Display name — user-provided, unique per (workspace, user) case-insensitively.
  name        String   @db.VarChar(100)
  /// JSONB array of { email, name? }. See recipient-group-schema.ts for the
  /// Zod validator. Bounded to 100 items by the API layer.
  members     Json     @default("[]")
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt   DateTime @updatedAt      @map("updated_at") @db.Timestamptz(6)

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  user      User      @relation(fields: [userId],      references: [id], onDelete: Cascade)

  @@index([workspaceId, userId])
  @@map("recipient_groups")
}
```

Plus a Postgres functional unique index (not expressible as a Prisma
`@@unique` because it's a `LOWER()` expression):

```sql
CREATE UNIQUE INDEX recipient_groups_workspace_user_name_key
  ON recipient_groups (workspace_id, user_id, LOWER(name));
```

### 3.2 Member shape

```ts
// apps/web/features/contacts/lib/recipient-group-schema.ts
import { z } from 'zod';

export const recipientGroupMemberSchema = z.object({
  email: z.string().email().max(254),
  name: z.string().min(1).max(100).optional(),
});

export const recipientGroupMembersSchema = z.array(recipientGroupMemberSchema).max(100);

export type RecipientGroupMember = z.infer<typeof recipientGroupMemberSchema>;
```

### 3.3 Caps

- **100 members per group** — Zod-enforced. Beyond that a group becomes a
  poor UX (dropdown expansion floods the compose field) and hints at
  needing a mailing list ESP, not a compose shortcut.
- **50 groups per user** — checked at creation via `count()`. Beyond that
  the /contacts page starts feeling like a browse-and-search problem, which
  it isn't sized for in V1.

Both caps produce clear French error messages, not generic 500s.

### 3.4 Back-relations on existing models

```prisma
model Workspace {
  // ... existing fields
  recipientGroups RecipientGroup[]
}

model User {
  // ... existing fields
  recipientGroups RecipientGroup[]
}
```

Cascade delete on both: deleting a workspace or a user drops their groups.

---

## 4. Backend — server actions

All new files under `apps/web/features/contacts/actions/`. Every action
starts with `requireUser()`; workspace/user ids come exclusively from the
JWT — never from input. Zod input validation on 100% of parameters.

### 4.1 `listRecipientGroups`

```ts
export type RecipientGroupDto = {
  readonly id: string;
  readonly name: string;
  readonly members: readonly RecipientGroupMember[];
  readonly updatedAt: string; // ISO
};

export type ListRecipientGroupsResult = {
  readonly ok: true;
  readonly groups: readonly RecipientGroupDto[];
};

export async function listRecipientGroups(): Promise<ListRecipientGroupsResult>;
```

Sorted by `updatedAt DESC` (most recently touched first). No pagination —
50-cap makes a single page trivial.

### 4.2 `createRecipientGroup`

```ts
const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  members: recipientGroupMembersSchema.default([]),
});

export type CreateRecipientGroupResult =
  | { readonly ok: true; readonly group: RecipientGroupDto }
  | {
      readonly ok: false;
      readonly code: 'INVALID_INPUT' | 'NAME_TAKEN' | 'CAP_REACHED';
      readonly message: string;
    };

export async function createRecipientGroup(
  raw: z.input<typeof createSchema>,
): Promise<CreateRecipientGroupResult>;
```

`NAME_TAKEN` is detected via a Prisma unique-constraint violation catch on
the functional index. `CAP_REACHED` runs a `count()` before insert.

### 4.3 `updateRecipientGroup`

```ts
const updateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(100).optional(),
  members: recipientGroupMembersSchema.optional(),
});

export type UpdateRecipientGroupResult =
  | { readonly ok: true; readonly group: RecipientGroupDto }
  | {
      readonly ok: false;
      readonly code: 'NOT_FOUND' | 'INVALID_INPUT' | 'NAME_TAKEN';
      readonly message: string;
    };
```

Ownership check: the update targets `WHERE id = $1 AND workspaceId = ctx.workspaceId AND userId = ctx.userId`.
A row not found returns `NOT_FOUND` regardless of whether it exists in
another user's scope (indistinguishable — no cross-user probe possible).

### 4.4 `deleteRecipientGroup`

```ts
const deleteSchema = z.object({ id: z.string().uuid() });

export type DeleteRecipientGroupResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: 'NOT_FOUND' };
```

Hard delete with same ownership scoping as update.

### 4.5 `searchRecipients` extension

The V1.6 server action gains a **third source** unioned with mail history
and Contacts, plus a new optional `includeGroups: boolean` input
(defaulting to `true`) — the group editor UI passes `false` to prevent
nesting groups inside groups (see §5.3):

```sql
-- ...existing mail_stats + contact_stats CTEs from V1.6...
, group_stats AS (
  SELECT lower(unaccent(name)) AS key,
         id::text AS group_id,
         name,
         'group'::text AS source,
         jsonb_array_length(members) AS member_count,
         updated_at AS last_seen_at
  FROM recipient_groups
  WHERE workspace_id = ${ctx.workspaceId}::uuid
    AND user_id     = ${ctx.userId}::uuid
    AND lower(unaccent(name)) LIKE '%' || lower(unaccent(${query})) || '%'
)
SELECT ... FROM mail_stats
UNION ALL SELECT ... FROM contact_stats
UNION ALL SELECT ... FROM group_stats  -- with padded NULLs for shape parity
LIMIT ${limit * 4};
```

The TypeScript side dedupes/ranks as before. `RecipientSuggestion` gains
a new discriminated variant:

```ts
export type RecipientSuggestion =
  | { source: 'mail' | 'contact'; email: string; name: string | null; ... }
  | { source: 'group'; groupId: string; name: string; memberCount: number; members: readonly RecipientGroupMember[] };
```

The `members` array is included in the suggestion payload so the client
can expand without a second round-trip. Trade-off: bigger response
(potentially 100 members × ~60 bytes = 6 KB per group). Acceptable at 10
suggestions and typical group sizes (~5-10 members).

### 4.6 Ranking — group priority

Groups get a fixed **`GROUP_BONUS = 3.0`** on top of the existing scoring
formula (higher than `RACI_BONUS = 1.5`). Rationale: typing "com" and
matching a group named "Comité BNP" is a stronger intent signal than
matching a random contact whose name happens to contain "com". The bonus
pushes groups to the top when they match.

### 4.7 Rate limiting

Reuses the existing `recipient_search` key from V1.6 (300/min). No new
key for CRUD groups — trafic will be low (a few CRUD ops per user per
week at most) and the dashboard-level actions are already gated by
auth.

### 4.8 Errors & PII

- All `NOT_FOUND` returns are indistinguishable from "not owned" (no user
  enumeration).
- Logs contain the action name + result code only. Group names and member
  emails NEVER appear in logs.
- No audit event for CRUD (unlike attachment upload/download which have
  security-relevant audit trails per the mail attachments iter §9). If
  compliance later needs an audit trail, adding `AuditAction.recipient_group_created`/
  `_updated`/`_deleted` is additive.

---

## 5. UI

### 5.1 New page `/contacts`

New route: `apps/web/app/(app)/contacts/page.tsx`.

Added to the sidebar under **Atelier** (`apps/web/app/(app)/layout.tsx`),
between "Clients" and "Templates cartes":

```tsx
<NavLink href="/clients"  icon="◉" label="Clients" />
<NavLink href="/contacts" icon="👥" label="Contacts" />  {/* NEW */}
<NavLink href="/templates/cards" icon="▤" label="Templates cartes" />
```

Icon: emoji `👥` (matches the existing convention for Atelier nav icons —
`◉ ▤ ✎ ▦ ⎔ ⟷ ⚙ ✦`).

### 5.2 Page layout

```
┌──────────────────────────────────────────────────────────────┐
│  Contacts                                    [+ Nouveau groupe]│
│  Groupes de destinataires pour la composition mail              │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ 👥 Comité BNP                                    [✎] [🗑]│ │
│  │    5 membres · Modifié il y a 2 jours                     │ │
│  │    e.marchetti@bnp.fr, p.durand@bnp.fr, +3 autres          │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ 👥 Design team Belgo                             [✎] [🗑]│ │
│  │    3 membres · Modifié il y a 1 semaine                    │ │
│  │    ...                                                     │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│  [empty state if 0 groupes: "Aucun groupe. Clique + Nouveau…"] │
└──────────────────────────────────────────────────────────────┘
```

- Cards sorted `updatedAt DESC`
- Preview line = first 2 emails + `"+N autres"` when > 2
- `[✎]` opens the edit modal, `[🗑]` opens a confirm dialog
- `[+ Nouveau groupe]` opens the create modal (same shape as edit)

### 5.3 Create / edit modal

New component: `apps/web/features/contacts/components/recipient-group-editor.tsx`.

```
┌─────────────────────────────────────────┐
│  Nouveau groupe                    [×] │
├─────────────────────────────────────────┤
│  Nom                                    │
│  ┌───────────────────────────────────┐  │
│  │ Comité BNP                        │  │
│  └───────────────────────────────────┘  │
│                                         │
│  Membres  (5 / 100)                    │
│  ┌───────────────────────────────────┐  │
│  │ Membres [chip a×] [chip b×] ...  │  │  ← RecipientField reused
│  │           typed...▓               │  │
│  └───────────────────────────────────┘  │
│                                         │
│                    [Annuler]  [Enregistrer]│
└─────────────────────────────────────────┘
```

- The **members input reuses `RecipientField`** from V1.6, with a new
  prop `suppressGroups?: boolean` set to `true` here. The dropdown will
  show mail history + Contacts but NOT other groups — nesting groups is
  a non-goal for V1 (would need cycle detection, wasted UX). Implemented
  by adding a `includeGroups?: boolean` param to the `searchRecipients`
  server action, defaulting to `true`; the editor calls with `false` so
  the group_stats CTE is skipped.
- Member counter `(N / 100)` next to the label; turns red at 100 AND the
  RecipientField becomes `disabled` at 100 to hard-block further adds.
  The 100th chip's × still works — removing frees a slot.
- The `name` input uses a plain `<input>` with client-side validation
  (min 1 char, max 100). Server enforces via Zod anyway.
- Errors from the server action surface as a Toast + inline red text
  under the affected field for `NAME_TAKEN` / `CAP_REACHED`.

### 5.4 Delete confirmation

Small inline modal: "Supprimer le groupe **Comité BNP** ? Cette action est
définitive." with `[Annuler]` and `[Supprimer]` (red button). No 30-day
trash — hard delete matches §2's premise (personal groups, nobody else
depends on them).

### 5.5 `RecipientField` dropdown — new group row

Extends the row rendering in
[`apps/web/features/communications/components/recipient-field.tsx`](../../../apps/web/features/communications/components/recipient-field.tsx).

For `s.source === 'group'`:

- **Avatar** replaced with a `👥` glyph (same 28×28 circular container,
  same accent gradient background, glyph in white).
- **Primary line** = group name (with match highlight — same
  `<mark>` behavior as V1.6).
- **Secondary line** = `"{memberCount} membres"` (not an email; groups
  don't have one).
- **Right badge** = "Groupe" (violet, same visual family as V1.6's
  "Contact" badge).
- **Priority in ranked list** = groups float to the top when they match,
  driven by the `GROUP_BONUS = 3.0` scoring (§4.6).

The row is otherwise indistinguishable from a regular row in
behavior — keyboard `↑↓` still cycles through it, `Enter` still commits.

### 5.6 Expansion on commit

When the user selects a group row (click or Enter/Tab):

1. Read `suggestion.members` (already in the payload — see §4.5).
2. Compute `newValue` = existing `value[]` + every member's email, with
   **case-insensitive dedup** against already-chipped emails.
3. Call `onChange(newValue)`.
4. Clear typed text, close dropdown.

The user sees N new chips appear (all valid because groups only ever
store emails that passed `z.string().email()` at create-time).

```ts
function commitGroup(group: GroupSuggestion, current: readonly string[]) {
  const seen = new Set(current.map((e) => e.toLowerCase()));
  const additions = group.members
    .map((m) => m.email)
    .filter((email) => {
      const lo = email.toLowerCase();
      if (seen.has(lo)) return false;
      seen.add(lo);
      return true;
    });
  return [...current, ...additions];
}
```

No toast for the dedup — silent (Gmail behavior; the visual chip count is
its own feedback).

---

## 6. Testing

### 6.1 Unit

- `apps/web/features/contacts/lib/recipient-group-expand.ts` (+ `.test.ts`) — pure
  `commitGroup` helper. Test cases: no dedup / partial dedup /
  full-dedup / case variants / accent variants (defer to matcher when
  needed).
- `recipient-group-schema.test.ts` — Zod schema edge cases (empty name,
  200-char name, 100 members exactly, 101 members, malformed email, dup
  member emails at Zod level → allowed, dedup happens at expansion time).

### 6.2 Integration

- `list-recipient-groups.test.ts` — returns caller's groups only; excludes
  other users in same workspace; ordering by `updatedAt DESC`.
- `create-recipient-group.test.ts` — happy path; `NAME_TAKEN` case-insensitive;
  `CAP_REACHED` at 50 groups.
- `update-recipient-group.test.ts` — happy path (name only, members only,
  both); `NOT_FOUND` when targeting another user's group.
- `delete-recipient-group.test.ts` — happy path; `NOT_FOUND` for others'.
- Extension of `search-recipients.test.ts` — new fixture with a
  `RecipientGroup` row; query matches by name; group appears with
  `source: 'group'` and `members` populated; `groupBonus` ordering
  verified (a matching group beats a comparable mail contact).

### 6.3 Component

- `recipient-group-editor.test.tsx` — modal renders, add member via chip
  commit, remove chip, submit → calls `createRecipientGroup` /
  `updateRecipientGroup` with the right shape.
- Extension of `recipient-field.test.tsx` — new group row renders with
  the correct avatar + badge; selecting it commits N emails (dedup
  respected).
- `contacts-page.test.tsx` — list of groups renders; empty state;
  create/edit/delete round-trips via mocked actions.

### 6.4 E2E (deferred)

Same rationale as V1.6 — not required for this iter.

---

## 7. Security invariants (review checklist)

- [ ] `requireUser()` runs first in every action.
- [ ] All queries scoped `workspaceId = ctx.workspaceId AND userId = ctx.userId`.
      No cross-user reads possible.
- [ ] Zod input on every action (name length, members shape, member cap).
- [ ] `NAME_TAKEN` / `NOT_FOUND` don't leak whether the target exists in
      another user's scope.
- [ ] Prisma parameterized queries + `$queryRaw` template literals only;
      no `$queryRawUnsafe`.
- [ ] Group names and member emails never appear in logs.
- [ ] Expansion happens client-side after the server has already
      auth-checked the group lookup — no server-side "send to a group id"
      path that could bypass per-recipient validation.

---

## 8. Out of scope — V2 follow-ups

- **Workspace-shared groups** — add `shared: boolean` + owner/edit RBAC.
  Additive migration, no data conversion needed.
- **Group-as-alias (collapse chip)** — show one chip in the compose,
  expand server-side at send time. Requires new draft data model + send
  action changes.
- **Vue "tous les contacts"** — aggregate view of all `Contact` rows
  (currently client-scoped) on the `/contacts` page as a second tab.
- **Contacts standalone** — allow `Contact` rows with `clientId = null`,
  editable from `/contacts`.
- **Import CSV** de membres (Excel bootstrap for a large existing team).
- **Editable chips** (V1.6 debt too — click chip to reopen as text).
- **E2E Playwright** smokes.
- **`next-intl`** migration.

---

## 9. Files touched

New:

| File                                                                          | Purpose                                                                |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `packages/db/prisma/migrations/YYYYMMDDHHMMSS_recipient_groups/migration.sql` | Prisma migration creating `recipient_groups` + functional unique index |
| `apps/web/features/contacts/lib/recipient-group-schema.ts` (+ test)           | Zod schemas for member + members array                                 |
| `apps/web/features/contacts/lib/recipient-group-expand.ts` (+ test)           | Pure `commitGroup` helper (dedup case-insensitive)                     |
| `apps/web/features/contacts/actions/list-recipient-groups.ts` (+ test)        | Server action + integration test                                       |
| `apps/web/features/contacts/actions/create-recipient-group.ts` (+ test)       | Server action + integration test                                       |
| `apps/web/features/contacts/actions/update-recipient-group.ts` (+ test)       | Server action + integration test                                       |
| `apps/web/features/contacts/actions/delete-recipient-group.ts` (+ test)       | Server action + integration test                                       |
| `apps/web/features/contacts/components/recipient-group-editor.tsx` (+ test)   | Create/edit modal                                                      |
| `apps/web/features/contacts/components/recipient-group-card.tsx`              | Card in the /contacts list                                             |
| `apps/web/app/(app)/contacts/page.tsx` (+ test)                               | Route page — list + create/edit/delete                                 |

Modified:

| File                                                                   | Change                                                                                         |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `packages/db/prisma/schema.prisma`                                     | New `RecipientGroup` model + back-relations on `Workspace` and `User`                          |
| `apps/web/app/(app)/layout.tsx`                                        | Sidebar `NavLink` between Clients and Templates cartes                                         |
| `apps/web/features/communications/actions/search-recipients.ts`        | Add `group_stats` CTE + `group` source variant + `GROUP_BONUS = 3.0`                           |
| `apps/web/features/communications/actions/search-recipients.test.ts`   | Extend with a group fixture case                                                               |
| `apps/web/features/communications/lib/recipient-match.ts`              | Add `GROUP_BONUS` export + `RankableRow.source` variants                                       |
| `apps/web/features/communications/lib/recipient-match.test.ts`         | Extend with group-bonus test                                                                   |
| `apps/web/features/communications/components/recipient-field.tsx`      | Render group row variant + `commitGroup` path on Enter/click + `suppressGroups?: boolean` prop |
| `apps/web/features/communications/components/recipient-field.test.tsx` | Extend with group row + expansion test + `suppressGroups` behavior                             |
| `PRD-NexusHub.md`                                                      | New V1.7 subsection under Communications                                                       |
| `progress.md`                                                          | Iter V1.7 done                                                                                 |
| `CLAUDE.md`                                                            | Journal entry                                                                                  |

No new npm dep. No new env var. No new Fly.io service. Migration applies
to shared Supabase (`yphedrhofupththvlvoa`) pre-merge via `apply_migration`.
