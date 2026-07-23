# Recipient Autocomplete — Design Spec (Communications iter V1.6)

> **Status:** Approved 2026-07-24 by Angelo L.
> **Trigger:** Iter feedback after mail attachments V1.5 landed —
> "quand on tape un destinataire, possible de faire comme sur outlook ou gmail,
> que si un mail a deja ete envoye ou recu des qu'on tape une lettre on voit
> des suggestions de contacts".
> **Prior art in repo:** [`docs/superpowers/specs/2026-07-16-mail-attachments-design.md`](./2026-07-16-mail-attachments-design.md)

---

## 1. Goal

When the user types 1+ character in the `À` / `Cc` / `Cci` fields of `ComposePanel`,
a dropdown lists up to 8 recipient suggestions pulled from:

1. The user's own mailbox history (`email_messages` — received + sent).
2. The workspace's structured contacts (`Contact` — client contacts with optional
   RACI role).

Suggestions are ranked by a `recency × frequency` combined score with a fixed
boost for structured `Contact` rows. Matching is a case- and diacritic-insensitive
substring over both email and full name. Selection either clicks a row or
commits typed text; either path becomes a **chip** in the field, with the
prior comma-separated `<input>` replaced by a chips + input hybrid.

Non-goal: address book editing, distribution-list expansion, cross-workspace
lookups, or any change to how mails are actually sent (chips resolve back to
a `string[]` at submit).

---

## 2. Sources & Scope

### 2.1 Mail history (`email_messages`) — user-scoped

Every row where **the mail belongs to an integration owned by the caller** is
mined for correspondents. Ownership check mirrors the pattern already used by
[`fetch-mail-body.ts`](../../../apps/web/features/communications/actions/fetch-mail-body.ts)
and Task 14/17 of the attachments iter: filter by `workspaceId = ctx.workspaceId`
**AND** `integration.ownerUserId = ctx.userId`. This preserves the PRD §10
hypothesis #8 boundary — one user's inbox never leaks into another workspace
member's autocomplete.

Each row contributes up to 4 addresses:

| Field              | Name column                       | Hit weight                                                                               |
| ------------------ | --------------------------------- | ---------------------------------------------------------------------------------------- |
| `fromEmail`        | `fromName`                        | 1 hit / row                                                                              |
| `toRecipients[i]`  | (none — the raw array is strings) | 1 hit / row                                                                              |
| `ccRecipients[i]`  | (none)                            | 1 hit / row                                                                              |
| `bccRecipients[i]` | (none)                            | 1 hit / row (present on `mail_drafts` only; not currently persisted on `email_messages`) |

Practical implication: sender names come across for received mail (via
`fromName`), but recipient names must be **derived from the local-part or
looked up via a Contact match** — the array columns are bare emails.

### 2.2 Structured contacts (`Contact`) — workspace-scoped

Rows with `email IS NOT NULL AND deletedAt IS NULL`. Workspace-scoped by nature
(no per-user boundary — a Contact is a business asset shared across the team).
Each Contact contributes:

- `email`
- `firstName + ' ' + lastName` as display name
- `jobTitle` (optional secondary line in rich rendering)
- `client.name` (optional secondary line, joined via FK)
- `raci` (optional badge / boost signal)

### 2.3 Deduplication

The two sources are merged with a **case-lowered email as the dedup key**.
When both sources yield the same email:

- Display name → prefer the Contact's `firstName lastName` (structured over
  free-form MIME `fromName`)
- Rich-line context (`jobTitle`, `client.name`) → the Contact source
- Hit count → sum of both (a mailed Contact accumulates hits normally)
- Ranking bonus → RACI bonus applies once (see §3.2)

---

## 3. Backend

### 3.1 Server action shape

```ts
// apps/web/features/communications/actions/search-recipients.ts
'use server';

const inputSchema = z.object({
  query: z.string().trim().min(1).max(100),
  limit: z.number().int().min(1).max(20).default(10),
});

export type RecipientSuggestion = {
  readonly email: string;
  readonly name: string | null;
  readonly source: 'mail' | 'contact';
  readonly jobTitle?: string | null;
  readonly clientName?: string | null;
  readonly raci?: 'R' | 'A' | 'C' | 'I' | null;
};

export type SearchRecipientsResult =
  | { readonly ok: true; readonly suggestions: readonly RecipientSuggestion[] }
  | { readonly ok: false; readonly code: 'RATE_LIMIT' | 'INVALID_INPUT' };

export async function searchRecipients(
  raw: z.infer<typeof inputSchema>,
): Promise<SearchRecipientsResult>;
```

`requireUser()` runs first (workspace + user resolved from Supabase JWT).
The action never accepts a `workspaceId` param — that path would be a leak
vector.

### 3.2 Ranking algorithm

```
score(row) =
    log(1 + total_hits)                            -- frequency, dampened
  + recency_bonus(last_seen_at)                    -- exp-decay over days
  + (row.source === 'contact' ? RACI_BONUS : 0)    -- fixed structured-contact boost
```

Where:

```
recency_bonus(t) = 2.0 * exp(-days_since(t) / 30)   -- half-life ≈ 3 weeks
RACI_BONUS       = 1.5                              -- roughly equivalent to a Contact having ~5 mail hits
```

Implementation as a single Postgres query using two CTEs (`mail_stats`,
`contact_stats`) unioned and ranked. Suggestion set is capped at `limit`
(default 10) after ranking. Matching predicate is `email ILIKE '%' || query || '%'
OR name ILIKE '%' || query || '%'` with `unaccent` applied on both sides —
Supabase enables the `unaccent` extension by default.

Rough SQL sketch (fleshed out during implementation):

```sql
WITH mail_stats AS (
  SELECT lower(unaccent(addr)) AS key,
         addr AS email,
         from_name AS name,
         'mail' AS source,
         count(*) AS hits,
         max(received_at) AS last_seen_at
  FROM (
    SELECT from_email AS addr, from_name, received_at FROM email_messages
     WHERE workspace_id = $1 AND integration_id IN ($ownedIntegrations)
    UNION ALL
    SELECT unnest(to_recipients) AS addr, NULL, received_at FROM email_messages
     WHERE workspace_id = $1 AND integration_id IN ($ownedIntegrations)
    UNION ALL
    SELECT unnest(cc_recipients) AS addr, NULL, received_at FROM email_messages
     WHERE workspace_id = $1 AND integration_id IN ($ownedIntegrations)
  ) AS m
  GROUP BY key, addr, from_name
),
contact_stats AS (
  SELECT lower(unaccent(email)) AS key,
         email,
         first_name || ' ' || last_name AS name,
         job_title,
         raci,
         c.client_id,
         cl.name AS client_name
  FROM contacts c
  LEFT JOIN clients cl ON cl.id = c.client_id
  WHERE c.workspace_id = $1 AND c.email IS NOT NULL AND c.deleted_at IS NULL
),
combined AS (
  SELECT key, email, name, source, hits, last_seen_at,
         NULL::text AS job_title, NULL::text AS client_name, NULL::text AS raci
  FROM mail_stats
  UNION ALL
  SELECT key, email, name, 'contact', 0, NOW(), job_title, client_name, raci::text
  FROM contact_stats
)
SELECT key,
       max(email) AS email,
       COALESCE(max(name) FILTER (WHERE source = 'contact'),
                max(name) FILTER (WHERE source = 'mail'))     AS name,
       CASE WHEN bool_or(source = 'contact') THEN 'contact' ELSE 'mail' END AS source,
       max(job_title)   AS job_title,
       max(client_name) AS client_name,
       max(raci)        AS raci,
       -- ranking
       ln(1 + sum(hits)) +
       2.0 * exp(-EXTRACT(EPOCH FROM (NOW() - max(last_seen_at))) / (30 * 86400)) +
       CASE WHEN bool_or(source = 'contact') THEN 1.5 ELSE 0 END AS score
FROM combined
WHERE key ILIKE '%' || lower(unaccent($2)) || '%'
   OR max(name) ILIKE '%' || lower(unaccent($2)) || '%'  -- must be outer-referenced correctly
GROUP BY key
ORDER BY score DESC
LIMIT $3;
```

The final `WHERE`/`HAVING` layering will be refined at implementation
(above sketch has an obvious `max(name)` correlation bug — the real query
either pre-filters in the CTEs or uses a windowed subquery).

### 3.3 Indexes

Postgres index review at plan-writing time (implementation reads
`packages/db/prisma/schema.prisma` and asserts):

- `email_messages` MUST have an index whose leading column is
  `(workspace_id, integration_id)`. Add one if absent.
- `email_messages` GIN indexes on `to_recipients` / `cc_recipients` are
  intentionally NOT required for V1 — the `unnest` scan is O(rows) which
  is acceptable at current mailbox sizes.
- `contacts(workspace_id, email)` — assert; add if absent.

If p95 latency exceeds 200ms in load-testing after ship, escalate to §8's
materialized-view follow-up rather than reaching for partial indexes now.

### 3.4 Rate limiting

New key `recipient_search` in [`rate-limit/index.ts`](../../../apps/web/lib/rate-limit/index.ts):

```ts
recipient_search: { limit: 300, window: '1 m' }
```

300/user/min covers even hyperactive keystroke usage after client-side debounce
(150ms → theoretical max of ~400 calls/min, cut ~in half by pauses). Fail-open
behavior already in place from the mail-attachments iter — a Redis outage does
not brick the autocomplete.

### 3.5 Errors & PII

- `INVALID_INPUT` — Zod parse failure; message not surfaced (client already
  filters by length).
- `RATE_LIMIT` — dropdown shows a minimal "Trop de recherches, réessaie dans
  quelques secondes" state; typing continues to work uninhibited.
- No audit event. Recipient search is a read-only, non-mutating query.
- Logs never contain the query string or any returned email — a request-id +
  hit-count summary is the maximum granularity for observability.

---

## 4. UI — `RecipientField` component

New file: [`apps/web/features/communications/components/recipient-field.tsx`](../../../apps/web/features/communications/components/recipient-field.tsx).

### 4.1 Public API

```ts
export interface RecipientFieldProps {
  readonly label: string; // 'À' | 'Cc' | 'Cci'
  readonly value: readonly string[]; // committed emails
  readonly onChange: (next: readonly string[]) => void;
  readonly placeholder?: string;
  readonly disabled?: boolean;
}
```

State is fully controlled by the parent (ComposePanel). No internal draft
buffer beyond the transient "in-progress" input string.

### 4.2 Anatomy

```
┌─ label (À / Cc / Cci) ──────────────────────────────────┐
│ ┌───────────────────────────────────────────────────┐   │
│ │ [chip a×] [chip b×] [chip c invalid×] typed...▓   │   │  ← field
│ └───────────────────────────────────────────────────┘   │
│  ┌───── dropdown popover (Radix, position="bottom") ─┐  │
│  │  BC  Be.collections5                        │      │  │
│  │      be.collections5@bnpparibasfortisfactor.com │  │  │  ← row (rich)
│  │  ─────────────────────────────────────────────  │  │
│  │  EM  Elena Marchetti                 [Contact] │  │  │
│  │      elena@belgo-brand.eu                       │  │
│  │      CMO · Belgo Brand                          │  │  │  ← Contact-only 3rd line
│  │  ─────────────────────────────────────────────  │  │
│  │  SU  Support                                    │  │
│  │      support@belbe.com                          │  │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

Row shape approved in brainstorm §Q7 (option C — rich):

- Circular avatar 28×28 with 2-letter initials on the accent gradient
- Name in bold (name derived from Contact if available, else the MIME
  `fromName`, else the email's local-part title-cased as a last resort)
- Email in muted secondary color
- **Contact-only third line**: `jobTitle · clientName` (either or both
  omitted if null)
- **`Contact` badge** on the right when `source === 'contact'`
- Matched substrings highlighted with a translucent yellow background

### 4.3 Chip shape

- Rounded pill, `bg-accent-soft` fill, `text-accent-primary` foreground
- Trailing `×` button (aria-label `Retirer <email>`)
- **Invalid state** (email fails a strict regex): red fill, red text, tooltip
  "email invalide" — chip still exists (permissive mode), send-time filter
  strips it. See §5 for the validation regex.

### 4.4 Design tokens

Zero hex, all tokens from `mockups/styles.css` following the project convention
established in CLAUDE.md §5.3 and reaffirmed by the mail attachments iter
(spec §11). Colors use `var(--color-accent-*)`, `var(--color-danger-*)`,
`var(--color-bg-card)`, `var(--color-border-light)`.

---

## 5. Interaction spec (Gmail-esque, permissive)

Brainstorm Q8 established this profile (option A). Full behavior:

| Trigger                        | Effect                                                                                                                        |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Focus in field                 | Dropdown opens if the input already has 1+ char (else stays closed)                                                           |
| Type 1st char                  | Dropdown opens; debounced `searchRecipients` call fires after 150ms idle                                                      |
| Type more chars                | Each keystroke resets the 150ms timer; only the last query is sent                                                            |
| `↑` / `↓`                      | Move highlight in dropdown (roving, wrap at ends)                                                                             |
| `Enter` / `Tab`                | Commit the **highlighted** suggestion as chip; if no highlight, commit the typed text                                         |
| `,` / `;`                      | Commit the typed text as chip (no matter what's highlighted)                                                                  |
| Blur (field loses focus)       | Commit the typed text as chip (empty text → no-op)                                                                            |
| `Backspace` in **empty input** | Remove the **last** chip; if that chip was invalid, the raw text repopulates the input                                        |
| `Backspace` in non-empty input | Standard character delete                                                                                                     |
| `Escape`                       | Close dropdown, keep typed text intact                                                                                        |
| Click on chip                  | (V2) Reopen chip as editable text; for V1, only the `×` interaction exists                                                    |
| Click on chip's `×`            | Remove that chip                                                                                                              |
| Click on dropdown row          | Commit that row as chip, clear typed text, close dropdown, refocus input                                                      |
| Click outside field/dropdown   | Radix Popover default — dropdown closes; input's current text stays as-is (no commit)                                         |
| Rate-limit rejected            | Toast "Trop de recherches, réessaie dans quelques secondes"; typing continues, dropdown stays closed until next debounce fire |
| No match returned              | Dropdown closes silently (Gmail behavior — no "0 résultats" state)                                                            |

**Email validity regex** (permissive but not junk-accepting):

```ts
/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
```

Any chip failing this regex renders in the "invalid" style. On send,
`ComposePanel` filters out invalid chips before passing the array to
`sendMail` — the send server action's own Zod validator already enforces
`z.string().email()` so this is defense in depth.

**Applied to all 3 fields** (`À`, `Cc`, `Cci`) uniformly. `Cci` will require
a small ComposePanel wiring change since it currently isn't rendered as a
distinct field — see §7.

**Note on Cci suggestions.** `email_messages.bccRecipients` is not persisted
(BCC is stripped by every SMTP relay before delivery), so Cci suggestions
come from `Contacts` and from BCC entries the user themselves put on prior
outgoing drafts (persisted via `mail_drafts.bccRecipients` — currently not
mined; scope creep and deferred to V2). For V1, expect Cci suggestions
to be Contact-only in practice.

**Accessibility.** The field itself has `role="combobox"` with
`aria-expanded` / `aria-controls` / `aria-activedescendant` bound to the
highlighted row. Each row has `role="option"` and a stable `id`. Chips are
plain `<span>` with the `×` button labeled per email.

---

## 6. Testing

### 6.1 Unit tests

- `apps/web/features/communications/lib/recipient-match.ts` — pure matcher +
  ranking helpers, tested in `.test.ts` beside. Time-dependent scoring takes
  `now: number` as an explicit arg so tests never touch the wall clock.
- Coverage targets: `matchesQuery` (case + accent variants), `scoreRow`
  (each of the 3 factors independent + combined), `dedupeByEmail` (Contact-
  wins-name, hit-count-sums).

### 6.2 Integration tests

- `search-recipients.test.ts` — mock `requireUser`, mock `prisma`, seed
  representative fixture rows (mails from 2 integrations, one owned, one
  not; contacts across 2 workspaces; deleted contact excluded; dedup case)
  and assert the returned suggestion set + ordering + that a mail from a
  non-owned integration NEVER appears.
- Rate-limit rejection path (mock `getRateLimiter` to return non-success).

### 6.3 Component tests

- `recipient-field.test.tsx` — @testing-library/react:
  - Typing 'be' shows the dropdown; matches highlighted; hit count call
    debounced to one after 150ms.
  - `↓` moves highlight; `Enter` commits.
  - `,` commits typed text as chip.
  - `Backspace` on empty removes last chip.
  - `Escape` closes dropdown without losing text.
  - Clicking `×` on a chip removes it and calls `onChange`.
  - Invalid chip renders with the invalid style + correct aria attributes.

### 6.4 E2E (deferred)

Not required for V1. Add a smoke to `e2e/tests/mail-send.spec.ts` in a
follow-up if this feature accumulates regression pressure.

---

## 7. Integration into `ComposePanel`

Three inline `<input>` elements in [`compose-panel.tsx`](../../../apps/web/features/communications/components/compose-panel.tsx#L341-L352)
(`À`, `Cc`) are replaced by three `<RecipientField>` instances. `Cci` is
currently not rendered as its own visible field — this iter adds it (the
send server action already accepts `bccRecipients[]` per the mail send V1
iter).

State migration inside `ComposePanel`:

- Current: `to: string`, `cc: string` (comma-joined). Parsed with `split(',')`
  at each save.
- New: `toList: readonly string[]`, `ccList: readonly string[]`,
  `bccList: readonly string[]`. Saved directly to `saveDraft`/`sendMail`
  which already take `string[]`.

The parsing helper currently in `ComposePanel` (comma-split + trim + filter
empty) becomes obsolete for `toList`/`ccList`/`bccList` and is deleted.

Autosave debounce still runs on any field change; no change to the persistence
contract.

---

## 8. Out of scope — V2 follow-ups

Explicitly deferred so the V1 iter stays focused:

- **Materialized view / nightly aggregate.** If p95 latency on
  `searchRecipients` exceeds 200ms at real workload, add a
  `recipient_stats(workspace_id, user_id, email_lower, name, hits,
last_seen_at)` table refreshed by an Inngest job. Ranking then reads a
  single indexed row per candidate.
- **Distribution lists / groups.** Suggesting a saved group ("Comité BNP")
  that expands to N emails on selection.
- **Cross-workspace autocomplete for shared contacts.** Requires modeling
  a "global contacts" scope which the current data model doesn't have.
- **Editable chips.** Clicking a chip to reopen it as text in the input.
- **i18n via `next-intl`.** V1 hardcodes FR to match the rest of the panel;
  the eventual migration is a project-wide sweep, not this iter's concern.
- **E2E Playwright smokes.** See §6.4.
- **Contact avatar images.** Only initials in V1 — the schema has no
  `avatarUrl` column on `Contact` and adding one is a separate iter.

---

## 9. Implementation surface (files touched)

| File                                                                   | Change                                                                  |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `apps/web/features/communications/actions/search-recipients.ts`        | **NEW** — server action + Zod input                                     |
| `apps/web/features/communications/actions/search-recipients.test.ts`   | **NEW** — integration tests                                             |
| `apps/web/features/communications/lib/recipient-match.ts`              | **NEW** — pure matcher + ranking helpers                                |
| `apps/web/features/communications/lib/recipient-match.test.ts`         | **NEW** — unit tests                                                    |
| `apps/web/features/communications/components/recipient-field.tsx`      | **NEW** — the chips + dropdown component                                |
| `apps/web/features/communications/components/recipient-field.test.tsx` | **NEW** — component tests                                               |
| `apps/web/features/communications/components/compose-panel.tsx`        | Replace 2 `<input>` with 3 `<RecipientField>` + add `Cci` visible field |
| `apps/web/features/communications/components/compose-panel.test.tsx`   | Update field-interaction tests                                          |
| `apps/web/lib/rate-limit/index.ts`                                     | Add `recipient_search` key                                              |
| `apps/web/lib/rate-limit/index.test.ts`                                | Add test for the new key                                                |
| `PRD-NexusHub.md`                                                      | §6.5 Communications — add V1.6 subsection                               |
| `progress.md`                                                          | Mark iter V1.6 done                                                     |
| `CLAUDE.md`                                                            | Journal entry                                                           |

No new dependency. No new env var. No DB migration. No new Supabase Storage
bucket. No new Fly.io service.

---

## 10. Security invariants (checklist for review)

- [ ] `requireUser()` first in `searchRecipients`; `workspaceId` / `userId`
      **always** derived from the JWT, never accepted as input.
- [ ] Mail history filtered by `integration.ownerUserId = ctx.userId` — not
      workspace-level — to preserve PRD §10 hypothesis #8.
- [ ] `Contact` query filtered by `workspaceId = ctx.workspaceId` +
      `deletedAt IS NULL`.
- [ ] Zod input: `query` length 1-100, `limit` 1-20.
- [ ] Prisma parameterized queries only (no `$queryRawUnsafe`).
- [ ] No PII in logs: query string and returned emails are never logged.
- [ ] Rate limit `recipient_search` gates the endpoint.
- [ ] Chips validated client-side + defense-in-depth by `sendMail`'s existing
      `z.string().email()` on the request.
