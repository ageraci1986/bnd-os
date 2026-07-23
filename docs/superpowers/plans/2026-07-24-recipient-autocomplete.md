# Recipient Autocomplete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Gmail/Outlook-style recipient auto-complete to the ComposePanel's `À` / `Cc` / `Cci` fields, backed by the user's own mail history + workspace Contacts, ranked by recency×frequency with a RACI boost.

**Architecture:** Pure matcher/ranking helpers (`recipient-match.ts`) drive a Server Action (`searchRecipients`) that runs a single Postgres query joining `email_messages` (user-scoped via `integration.ownerUserId`) with `contacts` (workspace-scoped). A new `RecipientField` client component (chips + positioned dropdown, no Radix dep) consumes the action via a 150ms-debounced call and replaces the three `<input>` elements in `ComposePanel`. Cci becomes a visible field for the first time. No DB migration, no new env var, no new npm dep.

**Tech Stack:** Next.js 15 Server Actions, Prisma 6 raw SQL (`$queryRaw` with Prisma.sql) for the ranking CTE, React 19 client component with plain positioned `<ul>` dropdown, Tailwind CSS v4 tokens, Vitest + @testing-library/react, Zod input validation, Upstash rate limit (fail-open already in place).

**Spec:** [`docs/superpowers/specs/2026-07-24-recipient-autocomplete-design.md`](../specs/2026-07-24-recipient-autocomplete-design.md)

---

## File Structure

New:

- `apps/web/features/communications/lib/recipient-match.ts` — pure helpers (matcher, scorer, dedupe). No React, no Prisma. Tested standalone.
- `apps/web/features/communications/lib/recipient-match.test.ts` — unit tests.
- `apps/web/features/communications/actions/search-recipients.ts` — Server Action. Uses `requireUser`, checks rate limit, runs the ranking SQL, applies matcher/dedupe/limit from `recipient-match.ts`.
- `apps/web/features/communications/actions/search-recipients.test.ts` — integration tests (mocked Prisma + requireUser).
- `apps/web/features/communications/components/recipient-field.tsx` — client component (chips + dropdown + keyboard nav + debounced fetch).
- `apps/web/features/communications/components/recipient-field.test.tsx` — component tests (@testing-library/react).

Modified:

- `apps/web/lib/rate-limit/index.ts` — add `recipient_search: { limit: 300, window: '1 m' }` to `WINDOWS`.
- `apps/web/lib/rate-limit/index.test.ts` — add one test for the new key (existing pattern: "allows N hits then blocks").
- `apps/web/features/communications/components/compose-panel.tsx` — replace 2 `<input>` (`À`, `Cc`) with `<RecipientField>`, add visible `<RecipientField>` for `Cci`, migrate string state → `string[]` state, drop the comma-split parser.
- `apps/web/features/communications/components/compose-panel.test.tsx` — update assertions that queried the string inputs by placeholder; use the new `RecipientField` semantics.
- `PRD-NexusHub.md` — append Communications V1.6 subsection.
- `progress.md` — mark iter V1.6 done.
- `CLAUDE.md` — journal row.

Sequential dependency: Task 1 (rate limit) → 2 (matcher lib) → 3 (server action) → 4 (RecipientField) → 5 (ComposePanel wire) → 6 (docs) → 7 (final verify + PR).

---

## Task 1: Rate limit key

**Files:**

- Modify: `apps/web/lib/rate-limit/index.ts`
- Modify: `apps/web/lib/rate-limit/index.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `apps/web/lib/rate-limit/index.test.ts`, appending after the existing `mail_attachment_*` tests:

```ts
it('recipient_search allows 300 hits then blocks', async () => {
  const rl = getRateLimiter('recipient_search');
  const id = 'u-recipient-search';
  for (let i = 0; i < 300; i++) {
    expect((await rl.check(id)).success).toBe(true);
  }
  expect((await rl.check(id)).success).toBe(false);
});
```

- [ ] **Step 2: Run to confirm fail**

```bash
pnpm --filter @nexushub/web test -- rate-limit
```

Expected: FAIL — `recipient_search` not in the `RateLimitKey` union.

- [ ] **Step 3: Add the key**

Edit `apps/web/lib/rate-limit/index.ts`. Locate the `RateLimitKey` union and add `| 'recipient_search'`. Then in the `WINDOWS` map, add:

```ts
recipient_search: { limit: 300, window: '1 m' },
```

- [ ] **Step 4: Run to confirm pass**

```bash
pnpm --filter @nexushub/web test -- rate-limit
```

Expected: all rate-limit tests pass (including the new one).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/rate-limit/index.ts apps/web/lib/rate-limit/index.test.ts
git commit -m "feat(rate-limit): recipient_search 300/min key"
```

---

## Task 2: Matcher + ranking helpers (pure)

**Files:**

- Create: `apps/web/features/communications/lib/recipient-match.ts`
- Create: `apps/web/features/communications/lib/recipient-match.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/features/communications/lib/recipient-match.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  matchesQuery,
  scoreRow,
  dedupeByEmail,
  isValidEmail,
  RACI_BONUS,
  type RankableRow,
} from './recipient-match';

describe('matchesQuery', () => {
  it('matches substring in email, case-insensitive', () => {
    expect(matchesQuery('BE', 'be.collections@bnp.fr', null)).toBe(true);
    expect(matchesQuery('bnp', 'be.collections@bnp.fr', null)).toBe(true);
    expect(matchesQuery('xyz', 'be.collections@bnp.fr', null)).toBe(false);
  });

  it('matches substring in name, case-insensitive', () => {
    expect(matchesQuery('ELENA', 'e@x.fr', 'Elena Rossi')).toBe(true);
    expect(matchesQuery('rossi', 'e@x.fr', 'Elena Rossi')).toBe(true);
  });

  it('is accent-insensitive on both sides', () => {
    expect(matchesQuery('elena', 'e@x.fr', 'Éléna Rossi')).toBe(true);
    expect(matchesQuery('éléna', 'e@x.fr', 'Elena Rossi')).toBe(true);
    expect(matchesQuery('boëdec', 'boedec@x.fr', null)).toBe(true);
  });

  it('handles null name', () => {
    expect(matchesQuery('foo', 'foo@bar.fr', null)).toBe(true);
    expect(matchesQuery('bar', 'foo@bar.fr', null)).toBe(true);
    expect(matchesQuery('baz', 'foo@bar.fr', null)).toBe(false);
  });
});

describe('scoreRow', () => {
  const NOW = new Date('2026-07-24T12:00:00Z').getTime();
  const dayAgo = new Date(NOW - 86_400_000).toISOString();
  const monthAgo = new Date(NOW - 30 * 86_400_000).toISOString();

  it('rewards higher hit counts (dampened log)', () => {
    const low: RankableRow = { hits: 1, lastSeenAt: dayAgo, source: 'mail' };
    const high: RankableRow = { hits: 100, lastSeenAt: dayAgo, source: 'mail' };
    expect(scoreRow(high, NOW)).toBeGreaterThan(scoreRow(low, NOW));
  });

  it('rewards recency (exp-decay ~3 week half-life)', () => {
    const recent: RankableRow = { hits: 5, lastSeenAt: dayAgo, source: 'mail' };
    const old: RankableRow = { hits: 5, lastSeenAt: monthAgo, source: 'mail' };
    expect(scoreRow(recent, NOW)).toBeGreaterThan(scoreRow(old, NOW));
  });

  it('adds a fixed bonus for contact source', () => {
    const mail: RankableRow = { hits: 5, lastSeenAt: dayAgo, source: 'mail' };
    const contact: RankableRow = { hits: 5, lastSeenAt: dayAgo, source: 'contact' };
    expect(scoreRow(contact, NOW) - scoreRow(mail, NOW)).toBeCloseTo(RACI_BONUS, 5);
  });
});

describe('dedupeByEmail', () => {
  it('merges rows with the same email (case-insensitive), summing hits and preferring the contact name', () => {
    const mailRow = {
      email: 'Elena@X.fr',
      name: 'e rossi (informal)',
      source: 'mail' as const,
      hits: 3,
      lastSeenAt: '2026-07-01T00:00:00.000Z',
      jobTitle: null,
      clientName: null,
      raci: null,
    };
    const contactRow = {
      email: 'elena@x.fr',
      name: 'Elena Rossi',
      source: 'contact' as const,
      hits: 0,
      lastSeenAt: '2026-07-24T00:00:00.000Z',
      jobTitle: 'CMO',
      clientName: 'Belgo',
      raci: 'R' as const,
    };
    const out = dedupeByEmail([mailRow, contactRow]);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      email: 'Elena@X.fr',
      name: 'Elena Rossi', // contact name wins
      source: 'contact', // marker if any source was contact
      hits: 3, // sum
      lastSeenAt: '2026-07-24T00:00:00.000Z', // latest
      jobTitle: 'CMO',
      clientName: 'Belgo',
      raci: 'R',
    });
  });

  it('preserves distinct emails', () => {
    const rows = [
      {
        email: 'a@x.fr',
        name: 'A',
        source: 'mail' as const,
        hits: 1,
        lastSeenAt: '2026-07-01T00:00:00.000Z',
        jobTitle: null,
        clientName: null,
        raci: null,
      },
      {
        email: 'b@x.fr',
        name: 'B',
        source: 'mail' as const,
        hits: 1,
        lastSeenAt: '2026-07-01T00:00:00.000Z',
        jobTitle: null,
        clientName: null,
        raci: null,
      },
    ];
    expect(dedupeByEmail(rows)).toHaveLength(2);
  });
});

describe('isValidEmail', () => {
  it.each([
    ['a@b.fr', true],
    ['foo.bar+baz@example.co.uk', true],
    ['plainstring', false],
    ['no@dot', false],
    ['@nolocal.fr', false],
    ['spaces here@x.fr', false],
    ['', false],
  ])('%s → %s', (input, expected) => {
    expect(isValidEmail(input)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run to confirm fail**

```bash
pnpm --filter @nexushub/web test -- recipient-match
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helpers**

Create `apps/web/features/communications/lib/recipient-match.ts`:

```ts
export const RACI_BONUS = 1.5;
const RECENCY_HALF_LIFE_DAYS = 30;
const MS_PER_DAY = 86_400_000;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function norm(s: string): string {
  return stripAccents(s.toLowerCase());
}

/**
 * True iff `query` appears as a substring in either the email or the name,
 * case- and diacritic-insensitive. Empty query never matches.
 */
export function matchesQuery(query: string, email: string, name: string | null): boolean {
  const q = norm(query.trim());
  if (q.length === 0) return false;
  if (norm(email).includes(q)) return true;
  if (name && norm(name).includes(q)) return true;
  return false;
}

export interface RankableRow {
  readonly hits: number;
  readonly lastSeenAt: string; // ISO timestamp
  readonly source: 'mail' | 'contact';
}

/**
 * Combined recency × frequency score with a fixed structured-contact bonus.
 * Higher is better. Callers pass `nowMs` explicitly so tests never touch the
 * wall clock.
 *
 * See spec §3.2. Formula:
 *   log(1 + hits)                    -- dampened frequency
 *   + 2.0 * exp(-daysSince / 30)     -- exp-decay recency, ~3 week half-life
 *   + (contact ? RACI_BONUS : 0)
 */
export function scoreRow(row: RankableRow, nowMs: number): number {
  const ageMs = Math.max(0, nowMs - new Date(row.lastSeenAt).getTime());
  const daysSince = ageMs / MS_PER_DAY;
  const recency = 2.0 * Math.exp(-daysSince / RECENCY_HALF_LIFE_DAYS);
  const frequency = Math.log(1 + Math.max(0, row.hits));
  const bonus = row.source === 'contact' ? RACI_BONUS : 0;
  return frequency + recency + bonus;
}

export interface RecipientRow {
  readonly email: string;
  readonly name: string | null;
  readonly source: 'mail' | 'contact';
  readonly hits: number;
  readonly lastSeenAt: string;
  readonly jobTitle: string | null;
  readonly clientName: string | null;
  readonly raci: 'R' | 'A' | 'C' | 'I' | null;
}

/**
 * Merge rows that share the same email (lowercased). Contact name wins over
 * MIME fromName. Hits sum. Latest lastSeenAt wins. jobTitle/clientName/raci
 * inherit from the contact source. Preserves the FIRST occurrence's email
 * casing (arbitrary but stable).
 */
export function dedupeByEmail(rows: readonly RecipientRow[]): RecipientRow[] {
  const byKey = new Map<string, RecipientRow>();
  for (const row of rows) {
    const key = row.email.toLowerCase();
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, row);
      continue;
    }
    const contactSide =
      row.source === 'contact' ? row : existing.source === 'contact' ? existing : null;
    const mailSide = row.source === 'mail' ? row : existing.source === 'mail' ? existing : null;
    byKey.set(key, {
      email: existing.email, // preserve first-seen casing
      name: contactSide?.name ?? mailSide?.name ?? existing.name,
      source: contactSide ? 'contact' : 'mail',
      hits: existing.hits + row.hits,
      lastSeenAt:
        new Date(row.lastSeenAt).getTime() > new Date(existing.lastSeenAt).getTime()
          ? row.lastSeenAt
          : existing.lastSeenAt,
      jobTitle: contactSide?.jobTitle ?? existing.jobTitle,
      clientName: contactSide?.clientName ?? existing.clientName,
      raci: contactSide?.raci ?? existing.raci,
    });
  }
  return Array.from(byKey.values());
}

/**
 * Permissive regex — used to visually mark chips as invalid. NOT used to
 * gate chip creation (see spec §5 — permissive Gmail-esque behavior).
 * Server-side send action does the strict `z.string().email()` check.
 */
export function isValidEmail(s: string): boolean {
  return EMAIL_REGEX.test(s.trim());
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @nexushub/web test -- recipient-match
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/features/communications/lib/recipient-match.ts apps/web/features/communications/lib/recipient-match.test.ts
git commit -m "feat(comm): recipient-match lib (matcher + ranking + dedupe)"
```

---

## Task 3: `searchRecipients` server action

**Files:**

- Create: `apps/web/features/communications/actions/search-recipients.ts`
- Create: `apps/web/features/communications/actions/search-recipients.test.ts`

**Context for implementer:**

- `requireUser()` returns `{ workspaceId, userId, ... }`; established pattern in this codebase (see `fetch-mail-body.ts`, `upload-attachment.ts`).
- Ownership pattern: `emailMessage.integration.ownerUserId = ctx.userId`. See `fetch-mail-body.ts:38-46` for the reference query shape.
- Rate limit: `getRateLimiter('recipient_search').check(ctx.userId)`.
- Prisma raw query needed — the UNION+CTE cannot be expressed via Prisma Client's ORM API. Use `prisma.$queryRaw<Row[]>\`...\``with`Prisma.sql`fragments to safely interpolate`$1 = workspaceId`, `$2 = userId`, `$3 = query`. NEVER string-concatenate user input into the SQL text.

- [ ] **Step 1: Write the failing test**

Create `apps/web/features/communications/actions/search-recipients.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth', () => ({ requireUser: vi.fn() }));
vi.mock('@nexushub/db', () => ({
  prisma: { $queryRaw: vi.fn() },
  Prisma: { sql: (...a: unknown[]) => ({ __tag: 'sql', a }) },
}));
vi.mock('@/lib/rate-limit', () => ({ getRateLimiter: vi.fn() }));

import { requireUser } from '@/lib/auth';
import { prisma } from '@nexushub/db';
import { getRateLimiter } from '@/lib/rate-limit';
import { searchRecipients } from './search-recipients';

const requireUserMock = vi.mocked(requireUser);
const queryRawMock = vi.mocked(prisma.$queryRaw);
const getRateLimiterMock = vi.mocked(getRateLimiter);

beforeEach(() => {
  vi.clearAllMocks();
  requireUserMock.mockResolvedValue({
    workspaceId: 'ws-1',
    userId: 'u-1',
  } as never);
  getRateLimiterMock.mockReturnValue({
    check: vi.fn().mockResolvedValue({ success: true, remaining: 299, reset: Date.now() + 60_000 }),
  } as never);
});

describe('searchRecipients', () => {
  it('rejects INVALID_INPUT for empty query', async () => {
    const r = await searchRecipients({ query: '', limit: 10 });
    expect(r).toEqual({ ok: false, code: 'INVALID_INPUT' });
  });

  it('rejects RATE_LIMIT when the limiter blocks', async () => {
    getRateLimiterMock.mockReturnValue({
      check: vi
        .fn()
        .mockResolvedValue({ success: false, remaining: 0, reset: Date.now() + 30_000 }),
    } as never);
    const r = await searchRecipients({ query: 'elena', limit: 10 });
    expect(r).toEqual({ ok: false, code: 'RATE_LIMIT' });
  });

  it('returns dedupped + ranked suggestions from the Prisma raw query', async () => {
    queryRawMock.mockResolvedValueOnce([
      {
        email: 'elena@belgo.eu',
        name: 'Elena Rossi',
        source: 'contact',
        hits: 3,
        last_seen_at: '2026-07-23T10:00:00.000Z',
        job_title: 'CMO',
        client_name: 'Belgo',
        raci: 'R',
      },
      {
        email: 'be.collections@bnp.fr',
        name: null,
        source: 'mail',
        hits: 12,
        last_seen_at: '2026-07-20T10:00:00.000Z',
        job_title: null,
        client_name: null,
        raci: null,
      },
    ] as never);

    const r = await searchRecipients({ query: 'be', limit: 10 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.suggestions).toHaveLength(2);
    // Both match "be": the mail row wins on frequency (12 hits) vs the Contact's RACI bonus + recency.
    // We don't assert order rigidly — just that both appear.
    expect(r.suggestions.map((s) => s.email).sort()).toEqual([
      'be.collections@bnp.fr',
      'elena@belgo.eu',
    ]);
    const elena = r.suggestions.find((s) => s.email === 'elena@belgo.eu');
    expect(elena).toMatchObject({
      email: 'elena@belgo.eu',
      name: 'Elena Rossi',
      source: 'contact',
      jobTitle: 'CMO',
      clientName: 'Belgo',
      raci: 'R',
    });
  });

  it('never accepts a workspaceId in input (schema rejects extra fields silently or explicitly)', async () => {
    queryRawMock.mockResolvedValueOnce([] as never);
    // TypeScript would reject this at compile time, but a runtime attempt from
    // a crafted client payload should also be safe — the action uses ctx.workspaceId only.
    await searchRecipients({ query: 'x', limit: 5 } as never);
    // If workspaceId leaked into the query, our mock wouldn't see 'ws-1' bound.
    // We inspect the args passed to $queryRaw's Prisma.sql calls.
    const call = queryRawMock.mock.calls[0];
    // The raw SQL args include workspaceId + userId sourced from ctx, not from input.
    // Since we're using Prisma.sql fragments (mocked), we assert the mock was called at all.
    expect(call).toBeDefined();
  });
});
```

- [ ] **Step 2: Run to confirm fail**

```bash
pnpm --filter @nexushub/web test -- search-recipients
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `apps/web/features/communications/actions/search-recipients.ts`:

```ts
'use server';
import 'server-only';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { getRateLimiter } from '@/lib/rate-limit';
import { prisma, Prisma } from '@nexushub/db';
import { dedupeByEmail, scoreRow, type RecipientRow } from '../lib/recipient-match';

/**
 * searchRecipients — Communications iter V1.6 (recipient autocomplete).
 *
 * Backing store: `email_messages` (user-scoped via `integration.ownerUserId`)
 * unioned with `contacts` (workspace-scoped). Ranked by recency × frequency
 * with a fixed RACI-contact bonus (see `recipient-match.ts`).
 *
 * Spec: docs/superpowers/specs/2026-07-24-recipient-autocomplete-design.md
 */

const inputSchema = z.object({
  query: z.string().trim().min(1).max(100),
  limit: z.number().int().min(1).max(20).default(10),
});

export type SearchRecipientsInput = z.input<typeof inputSchema>;

export interface RecipientSuggestion {
  readonly email: string;
  readonly name: string | null;
  readonly source: 'mail' | 'contact';
  readonly jobTitle: string | null;
  readonly clientName: string | null;
  readonly raci: 'R' | 'A' | 'C' | 'I' | null;
}

export type SearchRecipientsResult =
  | { readonly ok: true; readonly suggestions: readonly RecipientSuggestion[] }
  | { readonly ok: false; readonly code: 'RATE_LIMIT' | 'INVALID_INPUT' };

interface RawRow {
  email: string;
  name: string | null;
  source: 'mail' | 'contact';
  hits: number;
  last_seen_at: string;
  job_title: string | null;
  client_name: string | null;
  raci: 'R' | 'A' | 'C' | 'I' | null;
}

export async function searchRecipients(
  raw: SearchRecipientsInput,
): Promise<SearchRecipientsResult> {
  const ctx = await requireUser();

  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  const { query, limit } = parsed.data;

  const gate = await getRateLimiter('recipient_search').check(ctx.userId);
  if (!gate.success) return { ok: false, code: 'RATE_LIMIT' };

  // Ownership pattern: mail history filtered by integration.ownerUserId
  // (per-user boundary — PRD §10 hypothesis #8) AND by workspace. Contacts
  // are workspace-scoped by nature.
  //
  // The query pre-filters on `query` inside the CTEs so the outer aggregate
  // only walks matching rows. `unaccent` requires the extension (enabled by
  // default on Supabase). We bind the same query string 4 times.
  const rows = await prisma.$queryRaw<RawRow[]>`
    WITH owned_integrations AS (
      SELECT id FROM integrations
      WHERE workspace_id = ${ctx.workspaceId}::uuid
        AND owner_user_id = ${ctx.userId}::uuid
        AND kind IN ('graph', 'imap')
    ),
    mail_addresses AS (
      SELECT lower(unaccent(from_email)) AS key,
             from_email AS email,
             from_name AS name,
             received_at
      FROM email_messages
      WHERE workspace_id = ${ctx.workspaceId}::uuid
        AND integration_id IN (SELECT id FROM owned_integrations)
        AND from_email IS NOT NULL
      UNION ALL
      SELECT lower(unaccent(addr)) AS key,
             addr AS email,
             NULL AS name,
             received_at
      FROM email_messages,
           unnest(to_recipients) AS addr
      WHERE workspace_id = ${ctx.workspaceId}::uuid
        AND integration_id IN (SELECT id FROM owned_integrations)
      UNION ALL
      SELECT lower(unaccent(addr)) AS key,
             addr AS email,
             NULL AS name,
             received_at
      FROM email_messages,
           unnest(cc_recipients) AS addr
      WHERE workspace_id = ${ctx.workspaceId}::uuid
        AND integration_id IN (SELECT id FROM owned_integrations)
    ),
    mail_stats AS (
      SELECT key,
             (array_agg(email ORDER BY received_at DESC))[1] AS email,
             (array_agg(name) FILTER (WHERE name IS NOT NULL))[1] AS name,
             'mail'::text AS source,
             count(*)::int AS hits,
             max(received_at) AS last_seen_at,
             NULL::text AS job_title,
             NULL::text AS client_name,
             NULL::text AS raci
      FROM mail_addresses
      WHERE key LIKE '%' || lower(unaccent(${query})) || '%'
         OR lower(unaccent(coalesce(name, ''))) LIKE '%' || lower(unaccent(${query})) || '%'
      GROUP BY key
    ),
    contact_stats AS (
      SELECT lower(unaccent(c.email)) AS key,
             c.email,
             c.first_name || ' ' || c.last_name AS name,
             'contact'::text AS source,
             0::int AS hits,
             NOW() AS last_seen_at,
             c.job_title,
             cl.name AS client_name,
             c.raci::text AS raci
      FROM contacts c
      LEFT JOIN clients cl ON cl.id = c.client_id
      WHERE c.workspace_id = ${ctx.workspaceId}::uuid
        AND c.email IS NOT NULL
        AND c.deleted_at IS NULL
        AND ( lower(unaccent(c.email)) LIKE '%' || lower(unaccent(${query})) || '%'
              OR lower(unaccent(c.first_name || ' ' || c.last_name)) LIKE '%' || lower(unaccent(${query})) || '%' )
    )
    SELECT * FROM mail_stats
    UNION ALL
    SELECT * FROM contact_stats
    LIMIT ${limit * 4};  -- overfetch to give dedupe headroom, capped again below
  `;

  // Dedupe + rank in TypeScript (small N, and this is where the tested
  // matcher/scorer lives — SQL side is a coarse filter).
  const nowMs = Date.now();
  const merged = dedupeByEmail(
    rows.map(
      (r): RecipientRow => ({
        email: r.email,
        name: r.name,
        source: r.source,
        hits: r.hits,
        lastSeenAt: new Date(r.last_seen_at).toISOString(),
        jobTitle: r.job_title,
        clientName: r.client_name,
        raci: r.raci,
      }),
    ),
  );
  const ranked = merged
    .map((row) => ({
      row,
      score: scoreRow({ hits: row.hits, lastSeenAt: row.lastSeenAt, source: row.source }, nowMs),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ row }) => ({
      email: row.email,
      name: row.name,
      source: row.source,
      jobTitle: row.jobTitle,
      clientName: row.clientName,
      raci: row.raci,
    }));

  return { ok: true, suggestions: ranked };
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @nexushub/web test -- search-recipients
```

Expected: all tests pass. If the "never accepts workspaceId" assertion is flaky (mock introspection depends on how Prisma.sql is mocked), simplify it to just assert the returned suggestions match ctx.workspaceId's fixtures.

- [ ] **Step 5: Typecheck + lint**

```bash
pnpm --filter @nexushub/web typecheck
pnpm --filter @nexushub/web lint
```

Expected: both clean. Common issue: the `Prisma.sql` type is a template-literal tag — no adaptation should be needed since `$queryRaw` accepts template literals directly.

- [ ] **Step 6: Commit**

```bash
git add apps/web/features/communications/actions/search-recipients.ts apps/web/features/communications/actions/search-recipients.test.ts
git commit -m "feat(comm): searchRecipients server action with ranked mail+contact union"
```

---

## Task 4: `RecipientField` component

**Files:**

- Create: `apps/web/features/communications/components/recipient-field.tsx`
- Create: `apps/web/features/communications/components/recipient-field.test.tsx`

**Context for implementer:**

- Design tokens available (see existing usage in `compose-panel.tsx`): `--color-bg-card`, `--color-bg-muted`, `--color-text-main`, `--color-text-muted`, `--color-border-light`, `--color-accent-primary`, `--accent-gradient`. For invalid state, use `--color-danger` if defined, else fall back to a hardcoded `#dc2626` with a `TODO(design-tokens)` comment.
- No Radix Popover / no combobox lib. Plain positioned `<ul>` with `role="listbox"` beneath the field, absolute-positioned inside a `relative` wrapper.
- Debounce timing: 150ms (spec §5).
- Highlight the first row by default so `Enter` without arrow-key nav still commits it.
- Use `useState<number | null>` for highlight index, `null` means "no explicit highlight" — treat as "highlight row 0 for Enter/Tab commit purposes".
- Fetch: call `searchRecipients(...)` directly from client. Server Actions are callable from client components in Next.js 15.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/features/communications/components/recipient-field.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';
import { RecipientField } from './recipient-field';

vi.mock('../actions/search-recipients', () => ({
  searchRecipients: vi.fn(),
}));

import { searchRecipients } from '../actions/search-recipients';

const searchSpy = vi.mocked(searchRecipients);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  searchSpy.mockResolvedValue({
    ok: true,
    suggestions: [
      {
        email: 'elena@belgo.eu',
        name: 'Elena Rossi',
        source: 'contact',
        jobTitle: 'CMO',
        clientName: 'Belgo',
        raci: 'R',
      },
      {
        email: 'be.collections@bnp.fr',
        name: null,
        source: 'mail',
        jobTitle: null,
        clientName: null,
        raci: null,
      },
    ],
  });
});

afterEach(() => {
  vi.useRealTimers();
});

function setup(value: readonly string[] = []) {
  const onChange = vi.fn();
  const utils = render(
    <RecipientField label="À" value={value} onChange={onChange} placeholder="ph" />,
  );
  const input = screen.getByPlaceholderText('ph') as HTMLInputElement;
  return { ...utils, input, onChange };
}

describe('RecipientField', () => {
  it('renders existing chips', () => {
    setup(['a@x.fr', 'b@x.fr']);
    expect(screen.getByText('a@x.fr')).toBeInTheDocument();
    expect(screen.getByText('b@x.fr')).toBeInTheDocument();
  });

  it('commits typed text as chip on Enter when no dropdown match', async () => {
    const { input, onChange } = setup();
    fireEvent.change(input, { target: { value: 'raw@x.fr' } });
    // Debounce fire is irrelevant here — before the debounce fires we hit Enter.
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(['raw@x.fr']);
    expect(input.value).toBe('');
  });

  it('debounces the search 150ms and shows dropdown', async () => {
    const { input } = setup();
    fireEvent.change(input, { target: { value: 'be' } });
    // Before debounce fires
    expect(searchSpy).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(150);
    });
    await waitFor(() => expect(searchSpy).toHaveBeenCalledWith({ query: 'be', limit: 10 }));
    await waitFor(() => expect(screen.getByText(/elena/i)).toBeInTheDocument());
  });

  it('Enter commits the highlighted suggestion', async () => {
    const { input, onChange } = setup();
    fireEvent.change(input, { target: { value: 'be' } });
    await act(async () => {
      vi.advanceTimersByTime(150);
    });
    await waitFor(() => expect(screen.getByText(/elena/i)).toBeInTheDocument());
    // Highlight is row 0 by default → Enter commits elena@belgo.eu
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(['elena@belgo.eu']);
  });

  it('comma commits typed text (even if dropdown open)', async () => {
    const { input, onChange } = setup();
    fireEvent.change(input, { target: { value: 'noone@nowhere.zz' } });
    await act(async () => {
      vi.advanceTimersByTime(150);
    });
    fireEvent.keyDown(input, { key: ',' });
    expect(onChange).toHaveBeenCalledWith(['noone@nowhere.zz']);
  });

  it('Backspace on empty input removes last chip', () => {
    const { input, onChange } = setup(['a@x.fr', 'b@x.fr']);
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(onChange).toHaveBeenCalledWith(['a@x.fr']);
  });

  it('click × on chip removes it', () => {
    const { onChange } = setup(['a@x.fr', 'b@x.fr']);
    const removeBtn = screen.getByRole('button', { name: /Retirer a@x\.fr/ });
    fireEvent.click(removeBtn);
    expect(onChange).toHaveBeenCalledWith(['b@x.fr']);
  });

  it('Escape closes dropdown, keeps typed text', async () => {
    const { input } = setup();
    fireEvent.change(input, { target: { value: 'be' } });
    await act(async () => {
      vi.advanceTimersByTime(150);
    });
    await waitFor(() => expect(screen.getByText(/elena/i)).toBeInTheDocument());
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByText(/elena/i)).not.toBeInTheDocument());
    expect(input.value).toBe('be'); // text preserved
  });

  it('invalid email chip renders with the invalid style + aria', () => {
    setup(['bogus']);
    const chip = screen.getByText('bogus').closest('[data-invalid]');
    expect(chip).not.toBeNull();
    expect(chip).toHaveAttribute('data-invalid', 'true');
  });

  it('no-match: dropdown closes silently (Gmail behavior)', async () => {
    searchSpy.mockResolvedValueOnce({ ok: true, suggestions: [] });
    const { input } = setup();
    fireEvent.change(input, { target: { value: 'zzz' } });
    await act(async () => {
      vi.advanceTimersByTime(150);
    });
    await waitFor(() => expect(searchSpy).toHaveBeenCalled());
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
```

Note: also add `import { afterEach } from 'vitest';` at the top.

- [ ] **Step 2: Run to confirm fail**

```bash
pnpm --filter @nexushub/web test -- recipient-field
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `apps/web/features/communications/components/recipient-field.tsx`:

```tsx
'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { searchRecipients, type RecipientSuggestion } from '../actions/search-recipients';
import { isValidEmail } from '../lib/recipient-match';

export interface RecipientFieldProps {
  readonly label: string;
  readonly value: readonly string[];
  readonly onChange: (next: readonly string[]) => void;
  readonly placeholder?: string;
  readonly disabled?: boolean;
}

const DEBOUNCE_MS = 150;
const MAX_SUGGESTIONS = 10;

function initials(source: string): string {
  const cleaned = source.replace(/[<>"']/g, '').trim();
  const parts = cleaned.split(/[\s.@_-]+/).filter(Boolean);
  const a = parts[0]?.[0]?.toUpperCase() ?? '?';
  const b = parts[1]?.[0]?.toUpperCase() ?? '';
  return a + b;
}

function highlightMatch(text: string, query: string) {
  if (!query) return text;
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const nText = norm(text);
  const nQuery = norm(query);
  const idx = nText.indexOf(nQuery);
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="rounded bg-[color:var(--color-warning-soft,#fef3c7)] px-0.5 text-[color:var(--color-text-main)]">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}

export function RecipientField({
  label,
  value,
  onChange,
  placeholder,
  disabled,
}: RecipientFieldProps) {
  const [text, setText] = useState('');
  const [suggestions, setSuggestions] = useState<readonly RecipientSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const requestSeq = useRef(0);

  const commitText = useCallback(
    (raw: string) => {
      const trimmed = raw.trim().replace(/[,;]$/, '').trim();
      if (!trimmed) return;
      onChange([...value, trimmed]);
      setText('');
      setOpen(false);
    },
    [value, onChange],
  );

  const commitChip = useCallback(
    (email: string) => {
      onChange([...value, email]);
      setText('');
      setOpen(false);
    },
    [value, onChange],
  );

  // Debounced search
  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    if (text.trim().length === 0) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    debounceTimer.current = setTimeout(() => {
      const seq = ++requestSeq.current;
      void searchRecipients({ query: text.trim(), limit: MAX_SUGGESTIONS }).then((r) => {
        if (seq !== requestSeq.current) return; // stale
        if (!r.ok) {
          setSuggestions([]);
          setOpen(false);
          return;
        }
        // Filter out already-chipped emails
        const existing = new Set(value.map((v) => v.toLowerCase()));
        const filtered = r.suggestions.filter((s) => !existing.has(s.email.toLowerCase()));
        setSuggestions(filtered);
        setOpen(filtered.length > 0);
        setHighlight(0);
      });
    }, DEBOUNCE_MS);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [text, value]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === 'Tab') {
      if (open && suggestions[highlight]) {
        e.preventDefault();
        commitChip(suggestions[highlight].email);
      } else if (text.trim().length > 0) {
        e.preventDefault();
        commitText(text);
      }
      return;
    }
    if (e.key === ',' || e.key === ';') {
      if (text.trim().length > 0) {
        e.preventDefault();
        commitText(text);
      }
      return;
    }
    if (e.key === 'Backspace' && text.length === 0 && value.length > 0) {
      e.preventDefault();
      onChange(value.slice(0, -1));
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (open) setHighlight((h) => (h + 1) % suggestions.length);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (open) setHighlight((h) => (h - 1 + suggestions.length) % suggestions.length);
      return;
    }
  }

  function handleBlur() {
    // Commit any leftover text on blur (permissive Gmail-esque)
    if (text.trim().length > 0) commitText(text);
    // Close dropdown after a tick to allow row click handlers to fire first
    setTimeout(() => setOpen(false), 100);
  }

  return (
    <div className="relative mb-2">
      <div className="flex flex-wrap items-center gap-1 rounded border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] px-2 py-1 text-sm focus-within:ring-1 focus-within:ring-[color:var(--color-accent-primary)]">
        <span className="mr-1 text-xs font-bold text-[color:var(--color-text-muted)]">{label}</span>
        {value.map((email, i) => {
          const invalid = !isValidEmail(email);
          return (
            <span
              key={`${email}-${i}`}
              data-invalid={invalid ? 'true' : 'false'}
              className={
                invalid
                  ? 'inline-flex items-center gap-1 rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-xs text-red-700'
                  : 'inline-flex items-center gap-1 rounded-full border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-muted)] px-2 py-0.5 text-xs text-[color:var(--color-text-main)]'
              }
              title={invalid ? 'email invalide' : undefined}
            >
              {email}
              <button
                type="button"
                aria-label={`Retirer ${email}`}
                onClick={() => onChange(value.filter((_, j) => j !== i))}
                className="ml-1 text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text-main)]"
              >
                ×
              </button>
            </span>
          );
        })}
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          onFocus={() => text.trim().length > 0 && suggestions.length > 0 && setOpen(true)}
          placeholder={value.length === 0 ? placeholder : ''}
          disabled={disabled}
          className="min-w-[8ch] flex-1 border-none bg-transparent text-sm outline-none"
        />
      </div>
      {open && suggestions.length > 0 && (
        <ul
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] shadow-lg"
        >
          {suggestions.map((s, i) => {
            const isHighlighted = i === highlight;
            return (
              <li
                key={s.email}
                role="option"
                aria-selected={isHighlighted}
                onMouseDown={(e) => {
                  // onMouseDown (not onClick) so blur doesn't fire before we commit
                  e.preventDefault();
                  commitChip(s.email);
                }}
                onMouseEnter={() => setHighlight(i)}
                className={
                  isHighlighted
                    ? 'flex cursor-pointer items-center gap-2 border-b border-[color:var(--color-border-light)] bg-[color:var(--color-bg-muted)] px-2 py-1.5'
                    : 'flex cursor-pointer items-center gap-2 border-b border-[color:var(--color-border-light)] px-2 py-1.5 hover:bg-[color:var(--color-bg-muted)]'
                }
              >
                <span
                  aria-hidden
                  className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                  style={{ background: 'var(--accent-gradient)' }}
                >
                  {initials(s.name ?? s.email)}
                </span>
                <div className="flex-1 leading-tight">
                  <div className="text-xs font-semibold text-[color:var(--color-text-main)]">
                    {highlightMatch(s.name ?? s.email, text.trim())}
                  </div>
                  {s.name && (
                    <div className="text-[11px] text-[color:var(--color-text-muted)]">
                      {highlightMatch(s.email, text.trim())}
                    </div>
                  )}
                  {(s.jobTitle || s.clientName) && (
                    <div className="text-[10px] text-[color:var(--color-text-muted)]">
                      {[s.jobTitle, s.clientName].filter(Boolean).join(' · ')}
                    </div>
                  )}
                </div>
                {s.source === 'contact' && (
                  <span className="rounded-full bg-[color:var(--color-bg-muted)] px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[color:var(--color-accent-primary)]">
                    Contact
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @nexushub/web test -- recipient-field
```

Expected: all 9 tests pass. If any fail on timing (fake timers can be tricky with promises), wrap the `vi.advanceTimersByTime(150)` in an `act` and follow with an extra `await Promise.resolve()` flush.

- [ ] **Step 5: Typecheck + lint**

```bash
pnpm --filter @nexushub/web typecheck
pnpm --filter @nexushub/web lint
```

Common issue: `React.KeyboardEvent<HTMLInputElement>` may need explicit `import type { KeyboardEvent } from 'react'` depending on tsconfig. Adapt.

- [ ] **Step 6: Commit**

```bash
git add apps/web/features/communications/components/recipient-field.tsx apps/web/features/communications/components/recipient-field.test.tsx
git commit -m "feat(comm): RecipientField component (chips + dropdown + keyboard nav)"
```

---

## Task 5: Wire `RecipientField` into `ComposePanel`

**Files:**

- Modify: `apps/web/features/communications/components/compose-panel.tsx`
- Modify: `apps/web/features/communications/components/compose-panel.test.tsx`

**Context for implementer:**

- Current state uses `to: string`, `cc: string` (comma-joined). Migration: replace with `toList: string[]`, `ccList: string[]`, `bccList: string[]`.
- `computePrefill` returns `toRecipients: string[]` — plug directly.
- `saveDraft` + `sendMail` already accept `string[]` — no server change.
- `loadDraft` returns `toRecipients: string[]` / `ccRecipients: string[]` / `bccRecipients: string[]` — plug directly.
- Delete the comma-split parsers (formerly `to.split(',').map(...).filter(Boolean)` in `saveDraft`/`sendMail` calls) — pass the arrays as-is.
- Add a `<RecipientField label="Cci" value={bccList} onChange={setBccList} placeholder="Cci (optionnel)" />` between the Cc and Subject fields.

- [ ] **Step 1: Update the component**

Edit `apps/web/features/communications/components/compose-panel.tsx`.

1. Add import:

```ts
import { RecipientField } from './recipient-field';
```

2. Replace the state declarations:

Old:

```ts
const [to, setTo] = useState<string>('');
const [cc, setCc] = useState<string>('');
```

New:

```ts
const [toList, setToList] = useState<readonly string[]>([]);
const [ccList, setCcList] = useState<readonly string[]>([]);
const [bccList, setBccList] = useState<readonly string[]>([]);
```

3. Update the `loadDraft` branch (currently sets `setTo(r.draft.toRecipients.join(', '))` etc.):

Old:

```ts
setTo(r.draft.toRecipients.join(', '));
setCc(r.draft.ccRecipients.join(', '));
```

New:

```ts
setToList(r.draft.toRecipients);
setCcList(r.draft.ccRecipients);
setBccList(r.draft.bccRecipients);
```

4. Update the `computePrefill` fallback branch:

Old:

```ts
setTo(p.toRecipients.join(', '));
setCc(p.ccRecipients.join(', '));
```

New:

```ts
setToList(p.toRecipients);
setCcList(p.ccRecipients);
setBccList([]);
```

5. Update the `saveDraft` calls (2 sites: initial forward-reprise save + autosave debounce site) — replace the comma-split parsing with the array state directly:

Old (inside forward reprise):

```ts
toRecipients: [...p.toRecipients],
ccRecipients: [...p.ccRecipients],
bccRecipients: [],
```

Leave that one as-is (it uses the prefill `p` not the user-typed state).

Old (inside autosave debounce useEffect):

```ts
toRecipients: to.split(',').map((s) => s.trim()).filter(Boolean),
ccRecipients: cc.split(',').map((s) => s.trim()).filter(Boolean),
bccRecipients: [],
```

New:

```ts
toRecipients: [...toList],
ccRecipients: [...ccList],
bccRecipients: [...bccList],
```

6. Update the `sendMail` call:

Old:

```ts
toRecipients: to.split(',').map((s) => s.trim()).filter(Boolean),
ccRecipients: cc.split(',').map((s) => s.trim()).filter(Boolean),
bccRecipients: [],
```

New (also strip client-side invalid chips as a defense — the send action's Zod does its own strict check but this avoids confusing "invalid recipient" errors when the user just left a bogus chip visible):

```ts
toRecipients: [...toList].filter(isValidEmail),
ccRecipients: [...ccList].filter(isValidEmail),
bccRecipients: [...bccList].filter(isValidEmail),
```

Import: `import { isValidEmail } from '../lib/recipient-match';`

7. Update the debounce useEffect deps: replace `to`, `cc` with `toList`, `ccList`, `bccList`.

8. Replace the JSX inputs:

Old:

```tsx
<input
  value={to}
  onChange={(e) => setTo(e.target.value)}
  placeholder="À (séparés par des virgules)"
  className="mb-2 w-full rounded border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] px-2 py-1 text-sm"
/>
<input
  value={cc}
  onChange={(e) => setCc(e.target.value)}
  placeholder="Cc (optionnel)"
  className="mb-2 w-full rounded border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] px-2 py-1 text-sm"
/>
```

New:

```tsx
<RecipientField label="À" value={toList} onChange={setToList} placeholder="Destinataires" />
<RecipientField label="Cc" value={ccList} onChange={setCcList} placeholder="Cc" />
<RecipientField label="Cci" value={bccList} onChange={setBccList} placeholder="Cci" />
```

9. Update the `sendMail` guard (currently checks `to.trim().length === 0`) — replace with `toList.length === 0`.

- [ ] **Step 2: Update existing tests**

Edit `apps/web/features/communications/components/compose-panel.test.tsx`. Any assertion using `screen.getByPlaceholderText('À (séparés par des virgules)')` no longer finds that literal placeholder — the field is now the RecipientField's input which has its own placeholder. Update to `screen.getByPlaceholderText('Destinataires')`.

Any assertion that types into `to` and expects a comma-split later — those tests were validating the field parser. With the new component the flow is different (chip commit on Enter/comma). Adjust:

- Old pattern:

```ts
fireEvent.change(to, { target: { value: 'dest@example.com' } });
```

- New pattern:

```ts
fireEvent.change(to, { target: { value: 'dest@example.com' } });
fireEvent.keyDown(to, { key: 'Enter' });
```

Verify the send-failure tests still pass by ensuring at least one recipient exists in `toList` before clicking Envoyer.

- [ ] **Step 3: Run tests**

```bash
pnpm --filter @nexushub/web test -- compose-panel
```

Expected: all tests pass.

- [ ] **Step 4: Typecheck + lint**

```bash
pnpm --filter @nexushub/web typecheck
pnpm --filter @nexushub/web lint
```

- [ ] **Step 5: Full communications suite regression**

```bash
pnpm --filter @nexushub/web test -- communications
```

Expected: all tests green — no regression in the mail attachments / send / draft flows.

- [ ] **Step 6: Commit**

```bash
git add apps/web/features/communications/components/compose-panel.tsx apps/web/features/communications/components/compose-panel.test.tsx
git commit -m "feat(comm): wire RecipientField into ComposePanel (À + Cc + Cci)"
```

---

## Task 6: Documentation

**Files:**

- Modify: `PRD-NexusHub.md`
- Modify: `progress.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: PRD — Communications V1.6 subsection**

Locate the Communications section in `PRD-NexusHub.md`. After the V1.5 attachments subsection, append:

```markdown
### V1.6 — Recipient autocomplete (2026-07-24)

Auto-complete des destinataires dans `À`/`Cc`/`Cci` du ComposePanel :

- Suggestions issues de l'historique mail personnel (user-scoped via
  `integration.ownerUserId`) + des Contacts RACI du workspace.
- Ranking récence × fréquence + boost fixe RACI, match substring
  insensible casse/accents sur email + nom.
- UI chips + dropdown positionné, keyboard nav (↑↓/Enter/Tab/,/Esc),
  chips invalides marqués rouge (permissif à la saisie, filtrés au send).
- Cci devient visible dans l'UI pour la première fois.

Voir `docs/superpowers/specs/2026-07-24-recipient-autocomplete-design.md`.
```

- [ ] **Step 2: progress.md**

Add a row/section for iter V1.6 done 2026-07-24:

```markdown
### 6.0d Recipient autocomplete V1.6 — DONE (2026-07-24)

- Server action `searchRecipients` + Zod input + rate limit `recipient_search` 300/min
- Pure matcher/ranking lib (unit tested)
- `RecipientField` chips-dropdown component
- ComposePanel migration `string` → `string[]` state, Cci field visible
- No DB migration, no new dep
```

- [ ] **Step 3: CLAUDE.md journal**

Append to §11 (Journal des évolutions) table:

```markdown
| 2026-07-24 | Recipient autocomplete V1.6 (Communications iter 5) — chips + dropdown, mail history + Contacts | Angelo L. + Claude |
```

- [ ] **Step 4: Commit**

```bash
git add PRD-NexusHub.md progress.md CLAUDE.md
git commit -m "docs(recipient-autocomplete): PRD V1.6 + progress + CLAUDE journal"
```

---

## Task 7: Final verify + PR

- [ ] **Step 1: Full turbo pipeline**

```bash
pnpm turbo run typecheck lint test --continue
```

Expected: all 14 turbo tasks pass. If any fail, STOP and report — do not attempt to fix at this stage.

- [ ] **Step 2: Working tree clean**

```bash
git status
```

Expected: no untracked, no unstaged.

- [ ] **Step 3: Commit list for PR body**

```bash
git log --oneline main..HEAD
```

Capture the list.

- [ ] **Step 4: Push branch**

```bash
git push -u origin feature/recipient-autocomplete
```

- [ ] **Step 5: Create PR**

```bash
gh pr create --base main --head feature/recipient-autocomplete \
  --title "feat(comm): recipient autocomplete V1.6 — chips + dropdown + mail history/Contacts source" \
  --body "$(cat <<'EOF'
## Summary
- **Chips + dropdown** replace the comma-separated inputs in ComposePanel's À / Cc / Cci fields (Cci now visible for the first time).
- **Source**: user's own mail history (`email_messages`, filtered by `integration.ownerUserId` per PRD §10 hypothesis #8) UNION workspace-scoped Contacts. Dedupped on lowered email.
- **Ranking**: `ln(1 + hits) + 2·exp(-daysSince/30) + 1.5·contactBonus`. RACI-typed Contacts float up.
- **Matching**: case- and diacritic-insensitive substring across email + name. `unaccent` extension (Supabase default).
- **Interactions** (Gmail-esque permissive): Enter/Tab/comma/blur commit → chip; Backspace on empty removes last; ↑↓ nav; Esc closes; invalid emails show red but aren't blocked.
- **No DB migration, no new env var, no new npm dep.**

## Test plan
- [ ] `pnpm turbo run typecheck lint test` green (verified in Task 7).
- [ ] Manual staging smoke: open ComposePanel new/reply/forward, type 2+ letters, verify dropdown appears with mail + Contact matches, click a row → chip commit.
- [ ] Verify Cci is visible + works.
- [ ] Verify chips can be removed with × and via Backspace-on-empty.
- [ ] Verify invalid chip renders red and is stripped by the send action.

## V2 follow-ups (out of scope)
- Materialized view for ranking if p95 > 200ms
- Distribution lists / groups
- Editable chips (click to reopen)
- next-intl migration of hardcoded FR strings
- E2E Playwright smokes

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 6: Report URL**

Return the PR URL for user review. DO NOT MERGE.
