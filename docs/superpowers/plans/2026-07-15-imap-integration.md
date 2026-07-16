# IMAP Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a NexusHub user connect any IMAP mailbox (OVH Hosted Exchange, Fastmail, iCloud, self-hosted, arbitrary provider) so its emails appear in `/communications` alongside the Microsoft Graph mailbox already in production. Read-only V1.

**Architecture:** Reuse the existing `Integration` table with a new `kind='imap'` — credentials are AES-256-GCM encrypted JSON in `encryptedTokens` (same helper and key as Graph tokens). A new adapter at `packages/integrations/src/imap/` mirrors the shape of the Graph adapter and consumes `ImapFlow`. Autodiscover uses Mozilla ISPDB then `.well-known/autoconfig`, then falls back to a manual form. Sync is a Server Action triggered on `/communications` render, throttled 30 s per mailbox and run in parallel with the Graph sync via `Promise.allSettled`.

**Tech Stack:** Next.js 15 (App Router, Server Actions), React 19, TypeScript strict, Prisma 6 on Supabase Postgres 16, `imapflow` (new), `sanitize-html` (existing), `fast-xml-parser` (new — for ISPDB XML), `@upstash/ratelimit` (existing), Vitest, Playwright.

**Spec:** [`docs/superpowers/specs/2026-07-15-imap-integration-design.md`](../specs/2026-07-15-imap-integration-design.md)

**Branch / worktree:** `feature/imap-integration` in `.worktrees/imap-integration` (already set up, baseline green: 166 tests passing).

---

## Task 1: Prisma schema — Integration + EmailMessage + IntegrationKind enum

**Files:**

- Modify: `packages/db/prisma/schema.prisma` (enum + Integration model + EmailMessage model)

- [ ] **Step 1: Add `imap` to IntegrationKind enum**

Locate the `IntegrationKind` enum in `packages/db/prisma/schema.prisma` (currently `slack graph fireflies otter`) and add `imap`:

```prisma
enum IntegrationKind {
  slack
  graph
  fireflies
  otter
  imap
}
```

- [ ] **Step 2: Add two nullable fields to Integration model**

In `model Integration`, right after the existing `deltaToken` line, add:

```prisma
  /// IMAP INBOX UIDVALIDITY. Null for non-IMAP kinds.
  /// Reset triggers a full refetch (folder invalidated server-side).
  imapUidValidity      BigInt?           @map("imap_uid_validity")
  /// IMAP INBOX cursor for incremental sync. Null on first sync.
  imapLastSeenUid      BigInt?           @map("imap_last_seen_uid")
```

- [ ] **Step 3: Add `integrationId` FK to EmailMessage + swap composite unique**

In `model EmailMessage`:

1. Replace the existing `@@unique([workspaceId, externalId], ...)` line (search for `@@unique` inside the EmailMessage block) with:

   ```prisma
   @@unique([workspaceId, integrationId, externalId])
   ```

2. Add these fields near the other FK fields (before the `@@` block):

   ```prisma
   integrationId    String      @map("integration_id") @db.Uuid
   integration      Integration @relation(fields: [integrationId], references: [id], onDelete: Cascade)
   ```

3. Add an index right below the existing indexes:

   ```prisma
   @@index([workspaceId, integrationId, receivedAt(sort: Desc)])
   ```

- [ ] **Step 4: Add the back-relation on Integration**

In `model Integration`, add a back-relation (near the other `@relation` fields):

```prisma
emailMessages EmailMessage[]
```

- [ ] **Step 5: Regenerate Prisma Client**

```bash
cd packages/db && pnpm exec prisma generate
```

Expected: `✔ Generated Prisma Client (v6.19.3) …`

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/schema.prisma
git commit -m "feat(db): extend Integration + EmailMessage for IMAP mailboxes"
```

---

## Task 2: Migration SQL — additive + backfill + index swap

**Files:**

- Create: `packages/db/prisma/migrations/<timestamp>_imap_integration_foundations/migration.sql`

- [ ] **Step 1: Generate migration skeleton**

```bash
cd packages/db && pnpm exec prisma migrate dev --create-only --name imap_integration_foundations --schema prisma/schema.prisma
```

This will fail if `DATABASE_URL` points at a shared DB — use `--create-only`, we don't want it to apply.

If Prisma refuses to run without a DB connection, create the file manually:

```bash
mkdir -p packages/db/prisma/migrations/$(date -u +%Y%m%d%H%M%S)_imap_integration_foundations
touch packages/db/prisma/migrations/$(date -u +%Y%m%d%H%M%S)_imap_integration_foundations/migration.sql
```

- [ ] **Step 2: Write the migration SQL**

Overwrite the generated `migration.sql` with the exact SQL below (Prisma may have generated most of it; the backfill + safety guards are ours to add):

```sql
-- AlterEnum
ALTER TYPE "IntegrationKind" ADD VALUE 'imap';

-- AlterTable Integration: additive nullable columns (safe on live DB)
ALTER TABLE "integrations"
  ADD COLUMN "imap_uid_validity"   BIGINT,
  ADD COLUMN "imap_last_seen_uid"  BIGINT;

-- AlterTable EmailMessage: additive nullable FK column
ALTER TABLE "email_messages"
  ADD COLUMN "integration_id" UUID;

-- Backfill: assign every existing email to its workspace's Graph integration.
-- Precondition (checked by the runbook step): at most one Graph integration
-- per workspace exists at migration time. If a workspace has more than one,
-- the runbook says to stop and reconcile manually — the pre-check below hard-
-- fails with a self-explanatory NOTICE.
DO $$
DECLARE
  offenders INT;
BEGIN
  SELECT COUNT(*) INTO offenders
  FROM (
    SELECT workspace_id
    FROM integrations
    WHERE kind = 'graph'
    GROUP BY workspace_id
    HAVING COUNT(*) > 1
  ) s;
  IF offenders > 0 THEN
    RAISE EXCEPTION 'imap_integration_foundations: % workspace(s) have multiple Graph integrations. Backfill cannot pick a source — reconcile manually before re-running.', offenders;
  END IF;
END $$;

UPDATE "email_messages" em
SET "integration_id" = (
  SELECT i.id
  FROM "integrations" i
  WHERE i.workspace_id = em.workspace_id AND i.kind = 'graph'
  ORDER BY i.created_at ASC
  LIMIT 1
);

-- Verify no NULLs remain (fails loudly if a workspace has emails but no Graph).
DO $$
DECLARE
  orphans INT;
BEGIN
  SELECT COUNT(*) INTO orphans FROM "email_messages" WHERE "integration_id" IS NULL;
  IF orphans > 0 THEN
    RAISE EXCEPTION 'imap_integration_foundations: % email row(s) could not be backfilled (no matching Graph integration). Reconcile manually.', orphans;
  END IF;
END $$;

-- Now enforce NOT NULL + FK
ALTER TABLE "email_messages"
  ALTER COLUMN "integration_id" SET NOT NULL,
  ADD CONSTRAINT "email_messages_integration_id_fkey"
    FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Swap the composite unique index
DROP INDEX IF EXISTS "email_messages_workspace_id_external_id_key";
CREATE UNIQUE INDEX "email_messages_workspace_id_integration_id_external_id_key"
  ON "email_messages" ("workspace_id", "integration_id", "external_id");

-- New index for filtered-by-mailbox listing
CREATE INDEX "email_messages_workspace_id_integration_id_received_at_idx"
  ON "email_messages" ("workspace_id", "integration_id", "received_at" DESC);
```

- [ ] **Step 3: Commit the migration file**

```bash
git add packages/db/prisma/migrations/
git commit -m "feat(db): imap integration foundations migration"
```

**Note — do NOT apply to any DB yet.** Task 3 does that with the shared Supabase after human approval.

---

## Task 3: Apply migration to shared Supabase + verify

**Files:**

- None (operational task).

- [ ] **Step 1: Verify pre-check locally**

Open the Supabase SQL Editor for the shared DB (staging = prod today) and run:

```sql
SELECT workspace_id, COUNT(*)
FROM integrations
WHERE kind = 'graph'
GROUP BY workspace_id
HAVING COUNT(*) > 1;
```

Expected: **0 rows**. If any rows appear, STOP and reconcile with the operator before proceeding.

- [ ] **Step 2: Apply the migration**

Open `packages/db/prisma/migrations/<timestamp>_imap_integration_foundations/migration.sql` in the editor. Copy the SQL. Paste into Supabase SQL Editor → **Run**. Expected: `Success. No rows returned.` in under 3 s.

- [ ] **Step 3: Verify the schema**

Run in the SQL Editor:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE (table_name = 'integrations' AND column_name IN ('imap_uid_validity','imap_last_seen_uid'))
   OR (table_name = 'email_messages' AND column_name = 'integration_id');

SELECT indexname FROM pg_indexes WHERE tablename = 'email_messages'
  AND indexname LIKE '%integration_id%';
```

Expected: 3 columns (2 nullable, `integration_id` NOT NULL) + 2 indexes matching `%integration_id%`.

- [ ] **Step 4: Mark the migration as applied to Prisma's migration table (if Prisma tracks it)**

The Supabase SQL Editor bypasses Prisma's `_prisma_migrations` bookkeeping. Insert a row so Prisma sees the migration as already applied:

```sql
INSERT INTO "_prisma_migrations" (
  id, checksum, migration_name, started_at, finished_at, applied_steps_count
) VALUES (
  gen_random_uuid()::text,
  '<paste the checksum from the migration.toml or from a fresh migrate diff>',
  '<timestamp>_imap_integration_foundations',
  now(), now(), 1
);
```

To get the checksum, run locally:

```bash
sha256sum packages/db/prisma/migrations/<timestamp>_imap_integration_foundations/migration.sql
```

- [ ] **Step 5: No commit** — this task modifies only the shared DB. Note completion in `progress.md` at the end of the plan (Task 21).

---

## Task 4: Install `imapflow` + `fast-xml-parser` (Context7 first)

**Files:**

- Modify: `apps/web/package.json` (dependencies) — the adapter runs server-side inside the Next app
- Modify: `packages/integrations/package.json` (peerDependencies + optional dep for tests)

- [ ] **Step 1: Verify latest stable version via Context7 MCP** (CLAUDE.md §2 mandatory)

Query Context7 for `imapflow` — check latest version, node engine range, and any breaking changes. Same for `fast-xml-parser`. Record the resolved versions.

- [ ] **Step 2: Install as workspace deps**

```bash
cd packages/integrations && pnpm add imapflow fast-xml-parser
```

Then export from the top-level package if consumers need types:

```bash
pnpm add -w -D @types/sanitize-html # already installed — check first with `pnpm ls @types/sanitize-html`
```

- [ ] **Step 3: Verify no audit issues**

```bash
pnpm audit --audit-level=high
```

Expected: `found 0 vulnerabilities`. If any high/critical appear, stop and document in the PR.

- [ ] **Step 4: Commit**

```bash
git add packages/integrations/package.json apps/web/package.json pnpm-lock.yaml
git commit -m "feat(deps): add imapflow + fast-xml-parser for IMAP adapter"
```

---

## Task 5: Extract shared mail types + sanitize allowlist

**Files:**

- Create: `packages/integrations/src/mail/types.ts`
- Create: `packages/integrations/src/mail/sanitize.ts`
- Create: `packages/integrations/src/mail/index.ts`
- Test: `packages/integrations/src/mail/sanitize.test.ts`

- [ ] **Step 1: Write the failing test for sanitize**

Create `packages/integrations/src/mail/sanitize.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { sanitizeMailHtml, stripMailHtmlToText } from './sanitize';

describe('sanitizeMailHtml', () => {
  it('keeps allowed inline tags and enforces safe link attrs', () => {
    const out = sanitizeMailHtml('<p><a href="https://ex.com">hi</a></p>');
    expect(out).toContain('href="https://ex.com"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain('target="_blank"');
  });

  it('strips <script> and event handlers', () => {
    const out = sanitizeMailHtml('<p>ok</p><script>alert(1)</script><img src=x onerror=alert(1)>');
    expect(out).not.toContain('<script>');
    expect(out).not.toContain('onerror');
  });

  it('accepts cid: scheme on img src (inline attachments)', () => {
    const out = sanitizeMailHtml('<img src="cid:abc@x" alt="a">');
    expect(out).toContain('src="cid:abc@x"');
  });

  it('rejects javascript: URIs', () => {
    const out = sanitizeMailHtml('<a href="javascript:alert(1)">x</a>');
    expect(out).not.toContain('javascript:');
  });
});

describe('stripMailHtmlToText', () => {
  it('collapses whitespace and drops tags', () => {
    expect(stripMailHtmlToText('<p>hello\n  <b>world</b></p>')).toBe('hello world');
  });
});
```

- [ ] **Step 2: Run test — expect FAIL (module missing)**

```bash
pnpm --filter @nexushub/integrations test -- sanitize.test.ts
```

Expected: `Failed to resolve import "./sanitize"`.

- [ ] **Step 3: Create `packages/integrations/src/mail/sanitize.ts`**

Copy the existing allowlist from `packages/integrations/src/graph/parse.ts` (SANITIZE_OPTS + stripToText) into the new shared module:

```ts
import sanitizeHtml from 'sanitize-html';

/**
 * Shared sanitize-html allowlist for inbound mail bodies (Graph + IMAP).
 * Any change here must be reviewed for XSS impact — this pipeline gates
 * every raw email HTML rendered by the Communications UI.
 */
const OPTS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p',
    'br',
    'strong',
    'em',
    'u',
    'a',
    'ul',
    'ol',
    'li',
    'blockquote',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'code',
    'pre',
    'span',
    'div',
    'img',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height'],
    span: ['style'],
    div: ['style'],
  },
  allowedSchemes: ['http', 'https', 'mailto', 'cid'],
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' }),
  },
};

export function sanitizeMailHtml(html: string): string {
  return sanitizeHtml(html, OPTS);
}

export function stripMailHtmlToText(html: string): string {
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, ' ').trim();
}
```

- [ ] **Step 4: Create `packages/integrations/src/mail/types.ts`**

```ts
/**
 * Uniform shape produced by every inbound-mail adapter (Graph, IMAP, …).
 * Consumers of the Communications sync path only depend on this type.
 */
export interface ParsedMailMessage {
  readonly externalId: string;
  readonly subject: string;
  readonly fromEmail: string;
  readonly fromName: string | null;
  readonly toRecipients: readonly string[];
  readonly ccRecipients: readonly string[];
  readonly receivedAt: Date;
  readonly isRead: boolean;
  readonly conversationId: string | null;
  readonly bodyText: string;
  readonly bodyHtmlSanitized: string | null;
}
```

- [ ] **Step 5: Create `packages/integrations/src/mail/index.ts` (barrel)**

```ts
export type { ParsedMailMessage } from './types';
export { sanitizeMailHtml, stripMailHtmlToText } from './sanitize';
```

- [ ] **Step 6: Run test — expect PASS**

```bash
pnpm --filter @nexushub/integrations test -- sanitize.test.ts
```

Expected: 5 tests passing.

- [ ] **Step 7: Commit**

```bash
git add packages/integrations/src/mail/
git commit -m "feat(integrations): shared mail types + sanitize allowlist"
```

---

## Task 6: Refactor Graph parse.ts to use shared mail primitives

**Files:**

- Modify: `packages/integrations/src/graph/parse.ts`
- Verify unchanged: `packages/integrations/src/graph/parse.test.ts` still passes

- [ ] **Step 1: Update `parse.ts` to reuse the shared allowlist**

Replace the file contents with:

```ts
import { sanitizeMailHtml, stripMailHtmlToText, type ParsedMailMessage } from '../mail';

export type ParsedGraphMessage = ParsedMailMessage;

interface GraphAddress {
  emailAddress?: { name?: string; address?: string };
}

interface GraphMessage {
  id: string;
  subject?: string;
  from?: GraphAddress;
  toRecipients?: GraphAddress[];
  ccRecipients?: GraphAddress[];
  receivedDateTime: string;
  isRead?: boolean;
  conversationId?: string;
  bodyPreview?: string;
  body?: { contentType: string; content: string };
}

function extractRecipients(arr: GraphAddress[] | undefined): string[] {
  if (!arr) return [];
  return arr
    .map((a) => a.emailAddress?.address?.toLowerCase())
    .filter((s): s is string => Boolean(s));
}

export function parseGraphMessage(raw: GraphMessage): ParsedGraphMessage {
  const fromEmail = raw.from?.emailAddress?.address?.toLowerCase() ?? '';
  const fromName = raw.from?.emailAddress?.name ?? null;
  const body = raw.body;
  let bodyText = '';
  let bodyHtmlSanitized: string | null = null;
  if (body && typeof body.content === 'string') {
    if (body.contentType === 'html') {
      bodyHtmlSanitized = sanitizeMailHtml(body.content);
      bodyText = stripMailHtmlToText(body.content);
    } else {
      bodyText = body.content;
    }
  }
  return {
    externalId: raw.id,
    subject: raw.subject ?? '',
    fromEmail,
    fromName: fromName && fromName.length > 0 ? fromName : null,
    toRecipients: extractRecipients(raw.toRecipients),
    ccRecipients: extractRecipients(raw.ccRecipients),
    receivedAt: new Date(raw.receivedDateTime),
    isRead: raw.isRead === true,
    conversationId: raw.conversationId ?? null,
    bodyText,
    bodyHtmlSanitized,
  };
}
```

- [ ] **Step 2: Run the Graph test suite — must stay green**

```bash
pnpm --filter @nexushub/integrations test -- graph
```

Expected: all previously-passing Graph tests remain green. If any fail, revert Step 1 and adjust (behavior must be identical).

- [ ] **Step 3: Also check `apps/web` still typechecks (consumers use `ParsedGraphMessage`)**

```bash
pnpm --filter @nexushub/web typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/integrations/src/graph/parse.ts
git commit -m "refactor(integrations): graph adapter reuses shared mail sanitize"
```

---

## Task 7: IMAP `client.ts` — open session with timeout + always-logout

**Files:**

- Create: `packages/integrations/src/imap/client.ts`
- Test: `packages/integrations/src/imap/client.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { openImapSession, ImapConnectionError } from './client';

vi.mock('imapflow', () => {
  return {
    ImapFlow: class {
      connectCalled = 0;
      logoutCalled = 0;
      constructor(public readonly opts: unknown) {}
      async connect() {
        this.connectCalled++;
      }
      async logout() {
        this.logoutCalled++;
      }
    },
  };
});

describe('openImapSession', () => {
  it('constructs ImapFlow with mapped options and calls connect', async () => {
    const s = await openImapSession({
      host: 'imap.example.com',
      port: 993,
      secure: true,
      username: 'user@example.com',
      password: 'pw',
    });
    expect((s as unknown as { connectCalled: number }).connectCalled).toBe(1);
  });

  it('surfaces a typed error when connect throws', async () => {
    const { ImapFlow } = await import('imapflow');
    // any: overriding mocked class instance behavior for this test only
    (ImapFlow as unknown as { prototype: { connect: () => Promise<void> } }).prototype.connect =
      async () => {
        throw new Error('ECONNREFUSED');
      };
    await expect(
      openImapSession({
        host: 'imap.example.com',
        port: 993,
        secure: true,
        username: 'u',
        password: 'p',
      }),
    ).rejects.toBeInstanceOf(ImapConnectionError);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL (module missing)**

```bash
pnpm --filter @nexushub/integrations test -- imap/client
```

Expected: import error.

- [ ] **Step 3: Implement `client.ts`**

```ts
import { ImapFlow } from 'imapflow';

export interface ImapCredentials {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly username: string;
  readonly password: string;
}

export class ImapConnectionError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ImapConnectionError';
  }
}

const CONNECT_TIMEOUT_MS = 15_000;

/**
 * Open a connected ImapFlow session. Caller MUST wrap usage in a try/finally
 * that calls `session.logout()` — this module intentionally does not own the
 * session lifecycle beyond initial connect.
 */
export async function openImapSession(creds: ImapCredentials): Promise<ImapFlow> {
  const client = new ImapFlow({
    host: creds.host,
    port: creds.port,
    secure: creds.secure,
    auth: { user: creds.username, pass: creds.password },
    logger: false,
    disableAutoIdle: true,
    // ImapFlow honors this as the whole handshake budget
    connectionTimeout: CONNECT_TIMEOUT_MS,
    greetingTimeout: CONNECT_TIMEOUT_MS,
  });
  try {
    await client.connect();
    return client;
  } catch (err) {
    throw new ImapConnectionError('IMAP connect failed', err);
  }
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
pnpm --filter @nexushub/integrations test -- imap/client
```

Expected: 2 passing.

- [ ] **Step 5: Commit**

```bash
git add packages/integrations/src/imap/client.ts packages/integrations/src/imap/client.test.ts
git commit -m "feat(integrations): imap client with typed connection error"
```

---

## Task 8: IMAP `autodiscover.ts` — Mozilla ISPDB + `.well-known`

**Files:**

- Create: `packages/integrations/src/imap/autodiscover.ts`
- Test: `packages/integrations/src/imap/autodiscover.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { autodiscoverImap } from './autodiscover';

const ISPDB_OK = `<?xml version="1.0"?>
<clientConfig version="1.1">
  <emailProvider id="ovh.net">
    <incomingServer type="imap">
      <hostname>ssl0.ovh.net</hostname>
      <port>993</port>
      <socketType>SSL</socketType>
      <username>%EMAILADDRESS%</username>
      <authentication>password-cleartext</authentication>
    </incomingServer>
  </emailProvider>
</clientConfig>`;

describe('autodiscoverImap', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('returns the incoming IMAP server from Mozilla ISPDB', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('autoconfig.thunderbird.net')) {
          return new Response(ISPDB_OK, { status: 200 });
        }
        return new Response('', { status: 404 });
      }),
    );
    const r = await autodiscoverImap('me@ovh.net');
    expect(r).toEqual({ host: 'ssl0.ovh.net', port: 993, secure: true });
  });

  it('falls back to .well-known when ISPDB has no entry', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('autoconfig.thunderbird.net')) return new Response('', { status: 404 });
        if (url.includes('.well-known')) return new Response(ISPDB_OK, { status: 200 });
        return new Response('', { status: 404 });
      }),
    );
    const r = await autodiscoverImap('me@custom.tld');
    expect(r?.host).toBe('ssl0.ovh.net');
  });

  it('returns null when all endpoints miss', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 404 })),
    );
    expect(await autodiscoverImap('nobody@nowhere.example')).toBeNull();
  });

  it('returns null on malformed XML', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<not xml', { status: 200 })),
    );
    expect(await autodiscoverImap('me@ovh.net')).toBeNull();
  });

  it('rejects when input is not an email', async () => {
    expect(await autodiscoverImap('not-an-email')).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
pnpm --filter @nexushub/integrations test -- imap/autodiscover
```

- [ ] **Step 3: Implement `autodiscover.ts`**

```ts
import { XMLParser } from 'fast-xml-parser';

export interface AutodiscoverResult {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
}

const HTTP_TIMEOUT_MS = 3_000;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseAttributeValue: false,
  processEntities: false, // no XXE
  isArray: (name) => name === 'incomingServer',
});

function domainOf(email: string): string | null {
  const at = email.indexOf('@');
  if (at < 1 || at === email.length - 1) return null;
  return email.slice(at + 1).toLowerCase();
}

async function fetchWithTimeout(url: string): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'error' });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function pickImap(xml: string): AutodiscoverResult | null {
  let doc: unknown;
  try {
    doc = parser.parse(xml);
  } catch {
    return null;
  }
  // Navigate: clientConfig.emailProvider.incomingServer[] where type=imap
  const cfg = (doc as { clientConfig?: { emailProvider?: { incomingServer?: unknown } } })
    ?.clientConfig?.emailProvider?.incomingServer;
  const servers = Array.isArray(cfg) ? cfg : cfg ? [cfg] : [];
  for (const s of servers) {
    const obj = s as { type?: string; hostname?: string; port?: string; socketType?: string };
    if (obj.type !== 'imap' || !obj.hostname || !obj.port) continue;
    const port = Number(obj.port);
    if (!Number.isFinite(port)) continue;
    const secure = obj.socketType === 'SSL' || obj.socketType === 'TLS' || port === 993;
    return { host: obj.hostname, port, secure };
  }
  return null;
}

export async function autodiscoverImap(email: string): Promise<AutodiscoverResult | null> {
  const domain = domainOf(email);
  if (!domain) return null;
  const urls = [
    `https://autoconfig.thunderbird.net/v1.1/${domain}`,
    `https://autoconfig.${domain}/mail/config-v1.1.xml`,
    `https://${domain}/.well-known/autoconfig/mail/config-v1.1.xml`,
  ];
  for (const url of urls) {
    const xml = await fetchWithTimeout(url);
    if (!xml) continue;
    const hit = pickImap(xml);
    if (hit) return hit;
  }
  return null;
}
```

- [ ] **Step 4: Run — expect PASS (5 tests)**

- [ ] **Step 5: Commit**

```bash
git add packages/integrations/src/imap/autodiscover.ts packages/integrations/src/imap/autodiscover.test.ts
git commit -m "feat(integrations): imap autodiscover via mozilla ispdb + well-known"
```

---

## Task 9: IMAP `parse.ts` — MIME → `ParsedMailMessage`

**Files:**

- Create: `packages/integrations/src/imap/parse.ts`
- Test: `packages/integrations/src/imap/parse.test.ts`

ImapFlow yields already-parsed envelope + `bodyStructure`. To keep tests deterministic and CI dependency-free, we consume the parsed shape ImapFlow gives us (envelope + `source` for a fetched raw RFC822 payload) rather than shelling out to a full MIME parser. When body content is needed, we use ImapFlow's `download('TEXT')` and its own decoding.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { parseImapMessage, type RawImapMessage } from './parse';

const base: RawImapMessage = {
  uid: 42,
  envelope: {
    date: new Date('2026-07-15T10:00:00Z'),
    subject: 'Hello',
    from: [{ address: 'a@Ex.com', name: 'Alice' }],
    to: [{ address: 'b@ex.com' }],
    cc: [],
    inReplyTo: null,
    messageId: '<abc@ex.com>',
  },
  flags: new Set(['\\Seen']),
  bodyText: null,
  bodyHtml: null,
  headers: {},
};

describe('parseImapMessage', () => {
  it('maps envelope + Seen flag to ParsedMailMessage', () => {
    const r = parseImapMessage(base);
    expect(r).toMatchObject({
      externalId: '42',
      subject: 'Hello',
      fromEmail: 'a@ex.com',
      fromName: 'Alice',
      toRecipients: ['b@ex.com'],
      ccRecipients: [],
      isRead: true,
      conversationId: '<abc@ex.com>',
    });
  });

  it('marks unread when Seen flag absent', () => {
    const r = parseImapMessage({ ...base, flags: new Set() });
    expect(r.isRead).toBe(false);
  });

  it('falls back to internalDate when envelope date is missing', () => {
    const r = parseImapMessage({
      ...base,
      envelope: { ...base.envelope, date: null },
      internalDate: new Date('2026-07-14T09:00:00Z'),
    });
    expect(r.receivedAt.toISOString()).toBe('2026-07-14T09:00:00.000Z');
  });

  it('sanitizes HTML body through the shared allowlist', () => {
    const r = parseImapMessage({ ...base, bodyHtml: '<p>ok</p><script>bad</script>' });
    expect(r.bodyHtmlSanitized).toContain('<p>ok</p>');
    expect(r.bodyHtmlSanitized).not.toContain('<script>');
    expect(r.bodyText).toBe('ok');
  });

  it('uses text body directly when no HTML', () => {
    const r = parseImapMessage({ ...base, bodyText: 'plain body' });
    expect(r.bodyText).toBe('plain body');
    expect(r.bodyHtmlSanitized).toBeNull();
  });

  it('uses In-Reply-To when messageId absent', () => {
    const r = parseImapMessage({
      ...base,
      envelope: { ...base.envelope, messageId: null, inReplyTo: '<parent@ex.com>' },
    });
    expect(r.conversationId).toBe('<parent@ex.com>');
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `parse.ts`**

```ts
import { sanitizeMailHtml, stripMailHtmlToText, type ParsedMailMessage } from '../mail';

export interface ImapAddress {
  readonly address?: string;
  readonly name?: string;
}

export interface ImapEnvelope {
  readonly date: Date | null;
  readonly subject: string | null;
  readonly from: readonly ImapAddress[];
  readonly to: readonly ImapAddress[];
  readonly cc: readonly ImapAddress[];
  readonly inReplyTo: string | null;
  readonly messageId: string | null;
}

export interface RawImapMessage {
  readonly uid: number;
  readonly envelope: ImapEnvelope;
  readonly flags: ReadonlySet<string>;
  readonly bodyText: string | null;
  readonly bodyHtml: string | null;
  readonly internalDate?: Date;
  readonly headers?: Record<string, string>;
}

function normalize(list: readonly ImapAddress[]): string[] {
  return list.map((a) => a.address?.toLowerCase()).filter((s): s is string => Boolean(s));
}

export function parseImapMessage(raw: RawImapMessage): ParsedMailMessage {
  const from = raw.envelope.from[0];
  const html = raw.bodyHtml;
  const bodyHtmlSanitized = html ? sanitizeMailHtml(html) : null;
  const bodyText = html ? stripMailHtmlToText(html) : (raw.bodyText ?? '');
  const receivedAt = raw.envelope.date ?? raw.internalDate ?? new Date(0);
  return {
    externalId: String(raw.uid),
    subject: raw.envelope.subject ?? '',
    fromEmail: from?.address?.toLowerCase() ?? '',
    fromName: from?.name?.trim() ? from.name.trim() : null,
    toRecipients: normalize(raw.envelope.to),
    ccRecipients: normalize(raw.envelope.cc),
    receivedAt,
    isRead: raw.flags.has('\\Seen'),
    conversationId: raw.envelope.messageId ?? raw.envelope.inReplyTo ?? null,
    bodyText,
    bodyHtmlSanitized,
  };
}
```

- [ ] **Step 4: Run — expect PASS (6 tests)**

- [ ] **Step 5: Commit**

```bash
git add packages/integrations/src/imap/parse.ts packages/integrations/src/imap/parse.test.ts
git commit -m "feat(integrations): imap message parser producing ParsedMailMessage"
```

---

## Task 10: IMAP `messages.ts` — initial + incremental with UIDVALIDITY

**Files:**

- Create: `packages/integrations/src/imap/messages.ts`
- Test: `packages/integrations/src/imap/messages.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { listInboxInitial, listInboxIncremental, UidValidityChangedError } from './messages';
import type { RawImapMessage } from './parse';

function makeFakeSession(opts: { uidValidity: number; messages: readonly RawImapMessage[] }) {
  return {
    async mailboxOpen(_: string) {
      return { uidValidity: BigInt(opts.uidValidity) };
    },
    async *fetch(_range: string, _opts: unknown, _more: unknown) {
      for (const m of opts.messages) {
        yield {
          uid: m.uid,
          envelope: m.envelope,
          flags: m.flags,
          internalDate: m.internalDate,
          bodyStructure: null,
          source: null,
        };
      }
    },
    async download(_uid: number, _selector: string) {
      return { content: Buffer.from('') };
    },
    async logout() {},
  };
}

const oneMsg: RawImapMessage = {
  uid: 42,
  envelope: {
    date: new Date('2026-07-15T10:00:00Z'),
    subject: 'x',
    from: [{ address: 'a@ex.com' }],
    to: [],
    cc: [],
    inReplyTo: null,
    messageId: '<a@ex.com>',
  },
  flags: new Set(),
  bodyText: null,
  bodyHtml: null,
};

describe('listInboxInitial', () => {
  it('returns messages + uidValidity + max uid', async () => {
    const s = makeFakeSession({ uidValidity: 100, messages: [oneMsg] });
    const r = await listInboxInitial({ session: s as never, sinceDays: 30, maxMessages: 200 });
    expect(r.messages).toHaveLength(1);
    expect(r.uidValidity).toBe(100n);
    expect(r.lastSeenUid).toBe(42n);
  });

  it('returns lastSeenUid = 0n when the mailbox is empty', async () => {
    const s = makeFakeSession({ uidValidity: 100, messages: [] });
    const r = await listInboxInitial({ session: s as never, sinceDays: 30, maxMessages: 200 });
    expect(r.messages).toHaveLength(0);
    expect(r.lastSeenUid).toBe(0n);
  });
});

describe('listInboxIncremental', () => {
  it('throws UidValidityChangedError when server uidValidity differs', async () => {
    const s = makeFakeSession({ uidValidity: 999, messages: [oneMsg] });
    await expect(
      listInboxIncremental({ session: s as never, uidValidity: 100n, lastSeenUid: 40n }),
    ).rejects.toBeInstanceOf(UidValidityChangedError);
  });

  it('fetches only messages with UID greater than lastSeenUid', async () => {
    const s = makeFakeSession({ uidValidity: 100, messages: [oneMsg] });
    const r = await listInboxIncremental({
      session: s as never,
      uidValidity: 100n,
      lastSeenUid: 41n,
    });
    expect(r.messages).toHaveLength(1);
    expect(r.lastSeenUid).toBe(42n);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `messages.ts`**

```ts
import type { ImapFlow, FetchMessageObject } from 'imapflow';
import { parseImapMessage, type RawImapMessage } from './parse';
import type { ParsedMailMessage } from '../mail';

export class UidValidityChangedError extends Error {
  constructor(readonly serverUidValidity: bigint) {
    super('IMAP UIDVALIDITY changed since last sync');
    this.name = 'UidValidityChangedError';
  }
}

export interface InboxFetchResult {
  readonly messages: readonly ParsedMailMessage[];
  readonly uidValidity: bigint;
  readonly lastSeenUid: bigint;
}

interface InitialArgs {
  readonly session: ImapFlow;
  readonly sinceDays: number;
  readonly maxMessages: number;
}

interface IncrementalArgs {
  readonly session: ImapFlow;
  readonly uidValidity: bigint;
  readonly lastSeenUid: bigint;
}

const INCREMENTAL_CAP = 200;

async function bodyOf(
  session: ImapFlow,
  uid: number,
): Promise<{ text: string | null; html: string | null }> {
  try {
    const dl = await session.download(uid, 'TEXT');
    if (!dl?.content) return { text: null, html: null };
    // dl.content is a Buffer in ImapFlow. Consumers of parseImapMessage can
    // read either bodyText or bodyHtml; downgrading to text-only for V1 keeps
    // MIME multipart handling out of scope (attachments are V1.5).
    const raw = Buffer.isBuffer(dl.content) ? dl.content.toString('utf8') : String(dl.content);
    // Heuristic: if it looks like HTML, treat as HTML; else text.
    const trimmed = raw.trimStart();
    if (trimmed.startsWith('<')) return { text: null, html: raw };
    return { text: raw, html: null };
  } catch {
    return { text: null, html: null };
  }
}

function envelopeOf(m: FetchMessageObject): RawImapMessage['envelope'] {
  const env = (m as unknown as { envelope: RawImapMessage['envelope'] }).envelope;
  return {
    date: env.date ?? null,
    subject: env.subject ?? null,
    from: env.from ?? [],
    to: env.to ?? [],
    cc: env.cc ?? [],
    inReplyTo: env.inReplyTo ?? null,
    messageId: env.messageId ?? null,
  };
}

export async function listInboxInitial(args: InitialArgs): Promise<InboxFetchResult> {
  const box = await args.session.mailboxOpen('INBOX');
  const since = new Date(Date.now() - args.sinceDays * 24 * 3_600_000);
  const messages: ParsedMailMessage[] = [];
  let maxUid = 0n;
  for await (const m of args.session.fetch(
    { since },
    { envelope: true, flags: true, internalDate: true },
    { uid: true },
  )) {
    if (messages.length >= args.maxMessages) break;
    const uid = Number((m as { uid: number }).uid);
    const body = await bodyOf(args.session, uid);
    messages.push(
      parseImapMessage({
        uid,
        envelope: envelopeOf(m),
        flags: new Set((m as { flags?: Set<string> }).flags ?? []),
        internalDate: (m as { internalDate?: Date }).internalDate,
        bodyText: body.text,
        bodyHtml: body.html,
      }),
    );
    if (BigInt(uid) > maxUid) maxUid = BigInt(uid);
  }
  return { messages, uidValidity: box.uidValidity as unknown as bigint, lastSeenUid: maxUid };
}

export async function listInboxIncremental(args: IncrementalArgs): Promise<InboxFetchResult> {
  const box = await args.session.mailboxOpen('INBOX');
  const serverUidValidity = box.uidValidity as unknown as bigint;
  if (serverUidValidity !== args.uidValidity) {
    throw new UidValidityChangedError(serverUidValidity);
  }
  const messages: ParsedMailMessage[] = [];
  let maxUid = args.lastSeenUid;
  const range = `${(args.lastSeenUid + 1n).toString()}:*`;
  let count = 0;
  for await (const m of args.session.fetch(
    range,
    { envelope: true, flags: true, internalDate: true },
    { uid: true },
  )) {
    if (count >= INCREMENTAL_CAP) break;
    const uid = Number((m as { uid: number }).uid);
    if (BigInt(uid) <= args.lastSeenUid) continue;
    const body = await bodyOf(args.session, uid);
    messages.push(
      parseImapMessage({
        uid,
        envelope: envelopeOf(m),
        flags: new Set((m as { flags?: Set<string> }).flags ?? []),
        internalDate: (m as { internalDate?: Date }).internalDate,
        bodyText: body.text,
        bodyHtml: body.html,
      }),
    );
    if (BigInt(uid) > maxUid) maxUid = BigInt(uid);
    count++;
  }
  return { messages, uidValidity: serverUidValidity, lastSeenUid: maxUid };
}
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/integrations/src/imap/messages.ts packages/integrations/src/imap/messages.test.ts
git commit -m "feat(integrations): imap inbox fetch (initial + incremental) with UIDVALIDITY guard"
```

---

## Task 11: IMAP `connection-test.ts` + barrel

**Files:**

- Create: `packages/integrations/src/imap/connection-test.ts`
- Create: `packages/integrations/src/imap/index.ts`
- Test: `packages/integrations/src/imap/connection-test.test.ts`
- Modify: `packages/integrations/src/index.ts` (add imap barrel re-export)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { testImapConnection } from './connection-test';

vi.mock('./client', () => ({
  ImapConnectionError: class extends Error {},
  async openImapSession(_: unknown) {
    return {
      async mailboxOpen(_folder: string) {
        return { uidValidity: 1n };
      },
      async logout() {},
    };
  },
}));

describe('testImapConnection', () => {
  it('returns ok when list INBOX succeeds', async () => {
    const r = await testImapConnection({
      host: 'imap.ex',
      port: 993,
      secure: true,
      username: 'u',
      password: 'p',
    });
    expect(r).toEqual({ ok: true });
  });
});
```

Add a second file that mocks a throwing session for each error class:

```ts
// packages/integrations/src/imap/connection-test.errors.test.ts
import { describe, it, expect, vi } from 'vitest';

async function runWithMock(err: Error) {
  vi.resetModules();
  vi.doMock('./client', () => ({
    ImapConnectionError: class extends Error {},
    openImapSession: async () => {
      throw err;
    },
  }));
  const mod = await import('./connection-test');
  return mod.testImapConnection({
    host: 'x',
    port: 993,
    secure: true,
    username: 'u',
    password: 'p',
  });
}

describe('testImapConnection error mapping', () => {
  it('AUTH on auth-related messages', async () => {
    const r = await runWithMock(new Error('Invalid credentials'));
    expect(r).toEqual({ ok: false, code: 'AUTH', message: expect.any(String) });
  });
  it('TLS on TLS-related messages', async () => {
    const r = await runWithMock(new Error('SSL routines: wrong version number'));
    expect(r).toEqual({ ok: false, code: 'TLS', message: expect.any(String) });
  });
  it('HOST on ENOTFOUND / ECONNREFUSED', async () => {
    const r = await runWithMock(new Error('getaddrinfo ENOTFOUND imap.nope'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('HOST');
  });
  it('TIMEOUT on timeout messages', async () => {
    const r = await runWithMock(new Error('Connection timeout'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('TIMEOUT');
  });
  it('UNKNOWN when no pattern matches', async () => {
    const r = await runWithMock(new Error('weird oddity'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('UNKNOWN');
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `connection-test.ts`**

```ts
import { openImapSession, type ImapCredentials } from './client';

export type ConnectionTestResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: 'AUTH' | 'TLS' | 'HOST' | 'TIMEOUT' | 'UNKNOWN';
      readonly message: string;
    };

const AUTH_PATTERNS = [/invalid credential/i, /auth/i, /login/i, /password/i];
const TLS_PATTERNS = [/ssl/i, /tls/i, /certificate/i];
const HOST_PATTERNS = [/ENOTFOUND/, /ECONNREFUSED/, /EHOSTUNREACH/, /ENETUNREACH/];
const TIMEOUT_PATTERNS = [/timeout/i, /ETIMEDOUT/];

function classify(msg: string): {
  code: Exclude<ConnectionTestResult, { ok: true }>['code'];
  message: string;
} {
  if (AUTH_PATTERNS.some((p) => p.test(msg)))
    return { code: 'AUTH', message: 'Identifiants refusés par le serveur.' };
  if (TLS_PATTERNS.some((p) => p.test(msg)))
    return { code: 'TLS', message: 'Erreur TLS/SSL avec le serveur.' };
  if (HOST_PATTERNS.some((p) => p.test(msg))) return { code: 'HOST', message: 'Hôte injoignable.' };
  if (TIMEOUT_PATTERNS.some((p) => p.test(msg)))
    return { code: 'TIMEOUT', message: "Le serveur n'a pas répondu à temps." };
  return { code: 'UNKNOWN', message: 'Erreur inconnue lors de la connexion.' };
}

export async function testImapConnection(creds: ImapCredentials): Promise<ConnectionTestResult> {
  let session;
  try {
    session = await openImapSession(creds);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, ...classify(msg) };
  }
  try {
    await session.mailboxOpen('INBOX');
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, ...classify(msg) };
  } finally {
    try {
      await session.logout();
    } catch {
      /* swallow */
    }
  }
}
```

- [ ] **Step 4: Create `packages/integrations/src/imap/index.ts`**

```ts
export { openImapSession, ImapConnectionError, type ImapCredentials } from './client';
export { autodiscoverImap, type AutodiscoverResult } from './autodiscover';
export {
  parseImapMessage,
  type RawImapMessage,
  type ImapAddress,
  type ImapEnvelope,
} from './parse';
export {
  listInboxInitial,
  listInboxIncremental,
  UidValidityChangedError,
  type InboxFetchResult,
} from './messages';
export { testImapConnection, type ConnectionTestResult } from './connection-test';
```

- [ ] **Step 5: Update top-level `packages/integrations/src/index.ts`**

Append:

```ts
export * from './imap';
```

Also verify existing exports for `./graph` and `./mail` remain intact.

- [ ] **Step 6: Run tests — expect PASS**

```bash
pnpm --filter @nexushub/integrations test -- imap
```

- [ ] **Step 7: Commit**

```bash
git add packages/integrations/src/imap/ packages/integrations/src/index.ts
git commit -m "feat(integrations): imap connection-test + package barrel"
```

---

## Task 12: `getValidImapCredentials(integrationId)` helper

**Files:**

- Create: `apps/web/features/integrations/lib/get-valid-imap-credentials.ts`
- Test: `apps/web/features/integrations/lib/get-valid-imap-credentials.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest';

const decryptSpy = vi.fn();
vi.mock('@/lib/oauth/crypto', () => ({ decryptSecret: decryptSpy }));
vi.mock('@nexushub/db', () => ({
  prisma: {
    integration: { findFirst: vi.fn() },
  },
}));

import { prisma } from '@nexushub/db';
import { getValidImapCredentials } from './get-valid-imap-credentials';

describe('getValidImapCredentials', () => {
  it('throws when integration is missing or not owned', async () => {
    (prisma.integration.findFirst as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(
      getValidImapCredentials({ workspaceId: 'w', userId: 'u', integrationId: 'x' }),
    ).rejects.toThrow(/not found/i);
  });

  it('decrypts and returns credentials for the matching row', async () => {
    (prisma.integration.findFirst as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'x',
      encryptedTokens: 'v1:1:iv:tag:ct',
    });
    decryptSpy.mockReturnValue(
      JSON.stringify({ host: 'h', port: 993, secure: true, username: 'u', password: 'p' }),
    );
    const r = await getValidImapCredentials({ workspaceId: 'w', userId: 'u', integrationId: 'x' });
    expect(r).toEqual({ host: 'h', port: 993, secure: true, username: 'u', password: 'p' });
  });

  it('throws when encryptedTokens is null', async () => {
    (prisma.integration.findFirst as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'x',
      encryptedTokens: null,
    });
    await expect(
      getValidImapCredentials({ workspaceId: 'w', userId: 'u', integrationId: 'x' }),
    ).rejects.toThrow(/no credentials/i);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

```ts
import 'server-only';
import { prisma } from '@nexushub/db';
import { decryptSecret } from '@/lib/oauth/crypto';
import type { ImapCredentials } from '@nexushub/integrations';

interface Args {
  readonly workspaceId: string;
  readonly userId: string;
  readonly integrationId: string;
}

/**
 * Load the encrypted IMAP credentials for an integration owned by (workspace, user),
 * decrypt them, and return the plain object. Ownership check is mandatory
 * (CLAUDE.md §4.4.2 — no multi-tenant leaks).
 * NEVER log the returned value — it contains the mailbox password.
 */
export async function getValidImapCredentials(args: Args): Promise<ImapCredentials> {
  const row = await prisma.integration.findFirst({
    where: {
      id: args.integrationId,
      workspaceId: args.workspaceId,
      ownerUserId: args.userId,
      kind: 'imap',
    },
    select: { id: true, encryptedTokens: true },
  });
  if (!row) throw new Error('IMAP integration not found or not owned by the caller');
  if (!row.encryptedTokens) throw new Error('IMAP integration has no credentials on file');
  const plaintext = decryptSecret(row.encryptedTokens);
  const parsed = JSON.parse(plaintext) as ImapCredentials;
  return parsed;
}
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add apps/web/features/integrations/lib/get-valid-imap-credentials.ts apps/web/features/integrations/lib/get-valid-imap-credentials.test.ts
git commit -m "feat(integrations): server-side helper to decrypt owned IMAP credentials"
```

---

## Task 13: `testImapConnection` server action + rate limiter

**Files:**

- Modify: `apps/web/lib/rate-limit/index.ts` (add `imap_test` key)
- Create: `apps/web/features/integrations/actions/test-imap-connection.ts`
- Test: `apps/web/features/integrations/actions/test-imap-connection.test.ts`

- [ ] **Step 1: Extend the RateLimitKey union**

In `apps/web/lib/rate-limit/index.ts`, modify:

```ts
export type RateLimitKey = 'login' | 'password_reset' | 'invitation' | 'signup_token' | 'imap_test';
```

And add to the `WINDOWS` map:

```ts
imap_test: { limit: 5, window: '5 m' },
```

- [ ] **Step 2: Write the failing action test**

```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/auth', () => ({
  requireUser: vi.fn(async () => ({ userId: 'u', workspaceId: 'w' })),
}));

const rlCheck = vi.fn();
vi.mock('@/lib/rate-limit', () => ({
  getRateLimiter: vi.fn(() => ({ check: rlCheck })),
  getClientIp: vi.fn(() => 'ip'),
}));

const testFn = vi.fn();
vi.mock('@nexushub/integrations', () => ({
  testImapConnection: (...a: unknown[]) => testFn(...a),
}));

import { testImapConnectionAction } from './test-imap-connection';

describe('testImapConnectionAction', () => {
  it('returns 429 when rate limit exhausted', async () => {
    rlCheck.mockResolvedValueOnce({ success: false, remaining: 0, reset: Date.now() + 300_000 });
    const r = await testImapConnectionAction({
      host: 'h',
      port: 993,
      secure: true,
      username: 'u',
      password: 'p',
    });
    expect(r).toEqual({ ok: false, code: 'RATE_LIMIT', message: expect.any(String) });
    expect(testFn).not.toHaveBeenCalled();
  });

  it('forwards to testImapConnection when rate limit ok', async () => {
    rlCheck.mockResolvedValueOnce({ success: true, remaining: 4, reset: Date.now() + 300_000 });
    testFn.mockResolvedValueOnce({ ok: true });
    const r = await testImapConnectionAction({
      host: 'h',
      port: 993,
      secure: true,
      username: 'u',
      password: 'p',
    });
    expect(r).toEqual({ ok: true });
    expect(testFn).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 3: Run — expect FAIL**

- [ ] **Step 4: Implement the action**

```ts
'use server';
import 'server-only';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { getRateLimiter } from '@/lib/rate-limit';
import { testImapConnection, type ConnectionTestResult } from '@nexushub/integrations';

const inputSchema = z.object({
  host: z.string().min(1).max(255),
  port: z.number().int().positive().max(65535),
  secure: z.boolean(),
  username: z.string().min(1).max(320),
  password: z.string().min(1).max(1024),
});

export type TestImapInput = z.infer<typeof inputSchema>;
export type TestImapResult =
  | ConnectionTestResult
  | { readonly ok: false; readonly code: 'RATE_LIMIT'; readonly message: string };

export async function testImapConnectionAction(raw: TestImapInput): Promise<TestImapResult> {
  const ctx = await requireUser();
  const parsed = inputSchema.parse(raw);
  const rl = getRateLimiter('imap_test');
  const rlRes = await rl.check(ctx.userId);
  if (!rlRes.success) {
    return {
      ok: false,
      code: 'RATE_LIMIT',
      message: 'Trop de tentatives de test. Réessaie dans quelques minutes.',
    };
  }
  return testImapConnection(parsed);
}
```

- [ ] **Step 5: Run — expect PASS**

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/rate-limit/index.ts apps/web/features/integrations/actions/test-imap-connection.ts apps/web/features/integrations/actions/test-imap-connection.test.ts
git commit -m "feat(integrations): server action + rate limit for IMAP connection test"
```

---

## Task 14: `addImapMailbox` + `updateImapCredentials` server actions

**Files:**

- Create: `apps/web/features/integrations/actions/add-imap-mailbox.ts`
- Create: `apps/web/features/integrations/actions/update-imap-credentials.ts`
- Test: `apps/web/features/integrations/actions/add-imap-mailbox.test.ts`
- Test: `apps/web/features/integrations/actions/update-imap-credentials.test.ts`

- [ ] **Step 1: Write the failing test for add**

```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/auth', () => ({
  requireUser: vi.fn(async () => ({ userId: 'u', workspaceId: 'w' })),
}));
const encrypt = vi.fn((s: string) => `v1:1:iv:tag:${Buffer.from(s).toString('base64')}`);
vi.mock('@/lib/oauth/crypto', () => ({ encryptSecret: encrypt }));

const create = vi.fn();
const auditCreate = vi.fn();
vi.mock('@nexushub/db', () => ({
  prisma: {
    integration: { create },
    auditLog: { create: auditCreate },
  },
}));

const testFn = vi.fn();
vi.mock('@nexushub/integrations', () => ({
  testImapConnection: (...a: unknown[]) => testFn(...a),
}));

import { addImapMailbox } from './add-imap-mailbox';

describe('addImapMailbox', () => {
  it('rejects when the pre-save test connection fails', async () => {
    testFn.mockResolvedValueOnce({ ok: false, code: 'AUTH', message: 'nope' });
    const r = await addImapMailbox({
      email: 'me@ex.com',
      host: 'h',
      port: 993,
      secure: true,
      password: 'p',
    });
    expect(r.ok).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it('encrypts credentials + creates the row + writes audit event', async () => {
    testFn.mockResolvedValueOnce({ ok: true });
    create.mockResolvedValueOnce({ id: 'int_1' });
    const r = await addImapMailbox({
      email: 'me@ex.com',
      host: 'h',
      port: 993,
      secure: true,
      password: 'p',
    });
    expect(r).toMatchObject({ ok: true, integrationId: 'int_1' });
    expect(encrypt).toHaveBeenCalledOnce();
    const encryptedArg = encrypt.mock.calls[0]?.[0] as string;
    // Never expose plain password to logs; ensure it is inside the encrypted blob only
    expect(encryptedArg).toContain('"password":"p"');
    expect(auditCreate).toHaveBeenCalledOnce();
    const auditPayload = (auditCreate.mock.calls[0]?.[0] as { data: { data: unknown } }).data.data;
    expect(JSON.stringify(auditPayload)).not.toContain('"password"');
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `add-imap-mailbox.ts`**

```ts
'use server';
import 'server-only';
import { z } from 'zod';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { encryptSecret } from '@/lib/oauth/crypto';
import { prisma } from '@nexushub/db';
import { testImapConnection } from '@nexushub/integrations';

const inputSchema = z.object({
  email: z.string().email().max(320),
  host: z.string().min(1).max(255),
  port: z.number().int().positive().max(65535),
  secure: z.boolean(),
  password: z.string().min(1).max(1024),
});

export type AddImapInput = z.infer<typeof inputSchema>;
export type AddImapResult =
  | { readonly ok: true; readonly integrationId: string }
  | { readonly ok: false; readonly message: string };

export async function addImapMailbox(raw: AddImapInput): Promise<AddImapResult> {
  const ctx = await requireUser();
  const parsed = inputSchema.parse(raw);
  const t = await testImapConnection({
    host: parsed.host,
    port: parsed.port,
    secure: parsed.secure,
    username: parsed.email,
    password: parsed.password,
  });
  if (!t.ok) {
    return { ok: false, message: `Connexion refusée (${t.code})` };
  }
  const encrypted = encryptSecret(
    JSON.stringify({
      host: parsed.host,
      port: parsed.port,
      secure: parsed.secure,
      username: parsed.email,
      password: parsed.password,
    }),
  );
  const created = await prisma.integration.create({
    data: {
      workspaceId: ctx.workspaceId,
      ownerUserId: ctx.userId,
      kind: 'imap',
      scope: 'user',
      status: 'active',
      externalAccountId: parsed.email.toLowerCase(),
      externalAccountLabel: parsed.email.toLowerCase(),
      encryptedTokens: encrypted,
      keyVersion: 1,
      grantedScopes: [],
    },
    select: { id: true },
  });
  await prisma.auditLog.create({
    data: {
      workspaceId: ctx.workspaceId,
      actorId: ctx.userId,
      action: 'mailbox_connected',
      data: {
        kind: 'imap',
        email: parsed.email.toLowerCase(),
        host: parsed.host,
        port: parsed.port,
        secure: parsed.secure,
      },
    },
  });
  redirect('/integrations?connected=imap');
  return { ok: true, integrationId: created.id };
}
```

- [ ] **Step 4: Write + implement `update-imap-credentials.ts` (same pattern, `UPDATE` instead of `INSERT`)**

Test first (mirror the add test with an `updateMany` mock that returns `{count: 1}`), then implement:

```ts
'use server';
import 'server-only';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { encryptSecret } from '@/lib/oauth/crypto';
import { prisma } from '@nexushub/db';
import { testImapConnection } from '@nexushub/integrations';

const inputSchema = z.object({
  integrationId: z.string().uuid(),
  host: z.string().min(1).max(255),
  port: z.number().int().positive().max(65535),
  secure: z.boolean(),
  password: z.string().min(1).max(1024),
});

export type UpdateImapInput = z.infer<typeof inputSchema>;
export type UpdateImapResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

export async function updateImapCredentials(raw: UpdateImapInput): Promise<UpdateImapResult> {
  const ctx = await requireUser();
  const parsed = inputSchema.parse(raw);
  const row = await prisma.integration.findFirst({
    where: {
      id: parsed.integrationId,
      workspaceId: ctx.workspaceId,
      ownerUserId: ctx.userId,
      kind: 'imap',
    },
    select: { id: true, externalAccountId: true },
  });
  if (!row) return { ok: false, message: 'Boîte inconnue.' };
  const t = await testImapConnection({
    host: parsed.host,
    port: parsed.port,
    secure: parsed.secure,
    username: row.externalAccountId ?? '',
    password: parsed.password,
  });
  if (!t.ok) return { ok: false, message: `Connexion refusée (${t.code})` };
  const encrypted = encryptSecret(
    JSON.stringify({
      host: parsed.host,
      port: parsed.port,
      secure: parsed.secure,
      username: row.externalAccountId,
      password: parsed.password,
    }),
  );
  await prisma.integration.update({
    where: { id: row.id },
    data: { encryptedTokens: encrypted, status: 'active', lastError: null },
  });
  await prisma.auditLog.create({
    data: {
      workspaceId: ctx.workspaceId,
      actorId: ctx.userId,
      action: 'mailbox_credentials_updated',
      data: { kind: 'imap', integrationId: row.id, host: parsed.host, port: parsed.port },
    },
  });
  return { ok: true };
}
```

- [ ] **Step 5: Run tests — expect PASS**

- [ ] **Step 6: Commit**

```bash
git add apps/web/features/integrations/actions/add-imap-mailbox.ts apps/web/features/integrations/actions/update-imap-credentials.ts apps/web/features/integrations/actions/add-imap-mailbox.test.ts apps/web/features/integrations/actions/update-imap-credentials.test.ts
git commit -m "feat(integrations): add + update IMAP mailbox server actions"
```

---

## Task 15: `disconnectImapMailbox` server action

**Files:**

- Create: `apps/web/features/integrations/actions/disconnect-imap-mailbox.ts`
- Test: `apps/web/features/integrations/actions/disconnect-imap-mailbox.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
vi.mock('@/lib/auth', () => ({
  requireUser: vi.fn(async () => ({ userId: 'u', workspaceId: 'w' })),
}));

const updateMany = vi.fn();
const auditCreate = vi.fn();
vi.mock('@nexushub/db', () => ({
  prisma: {
    integration: { updateMany },
    auditLog: { create: auditCreate },
  },
}));

import { disconnectImapMailbox } from './disconnect-imap-mailbox';

describe('disconnectImapMailbox', () => {
  it('rejects when the integration is not owned by the caller', async () => {
    updateMany.mockResolvedValueOnce({ count: 0 });
    const r = await disconnectImapMailbox({ integrationId: 'x' });
    expect(r).toEqual({ ok: false, message: expect.any(String) });
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('revokes and clears credentials + UID state and writes audit', async () => {
    updateMany.mockResolvedValueOnce({ count: 1 });
    const r = await disconnectImapMailbox({ integrationId: 'x' });
    expect(r).toEqual({ ok: true });
    const args = updateMany.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(args.data).toMatchObject({
      status: 'revoked',
      encryptedTokens: null,
      imapUidValidity: null,
      imapLastSeenUid: null,
    });
    expect(auditCreate).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

```ts
'use server';
import 'server-only';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { prisma } from '@nexushub/db';

const inputSchema = z.object({ integrationId: z.string().uuid() });

export type DisconnectResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

export async function disconnectImapMailbox(
  raw: z.infer<typeof inputSchema>,
): Promise<DisconnectResult> {
  const ctx = await requireUser();
  const parsed = inputSchema.parse(raw);
  const r = await prisma.integration.updateMany({
    where: {
      id: parsed.integrationId,
      workspaceId: ctx.workspaceId,
      ownerUserId: ctx.userId,
      kind: 'imap',
    },
    data: {
      status: 'revoked',
      encryptedTokens: null,
      imapUidValidity: null,
      imapLastSeenUid: null,
    },
  });
  if (r.count === 0) return { ok: false, message: 'Boîte inconnue.' };
  await prisma.auditLog.create({
    data: {
      workspaceId: ctx.workspaceId,
      actorId: ctx.userId,
      action: 'mailbox_disconnected',
      data: { kind: 'imap', integrationId: parsed.integrationId },
    },
  });
  return { ok: true };
}
```

- [ ] **Step 4: Run — expect PASS. Commit.**

```bash
git add apps/web/features/integrations/actions/disconnect-imap-mailbox.ts apps/web/features/integrations/actions/disconnect-imap-mailbox.test.ts
git commit -m "feat(integrations): disconnect IMAP mailbox server action"
```

---

## Task 16: `sync-imap-inbox` action + parallel sync trigger on `/communications`

**Files:**

- Create: `apps/web/features/communications/actions/sync-imap-inbox.ts`
- Test: `apps/web/features/communications/actions/sync-imap-inbox.test.ts`
- Modify: `apps/web/app/(app)/communications/page.tsx` (parallelize sync of graph + imap)

- [ ] **Step 1: Write the failing test — mirror sync-graph-inbox scenarios**

```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/auth', () => ({
  requireUser: vi.fn(async () => ({ userId: 'u', workspaceId: 'w' })),
}));

const findFirstIntegration = vi.fn();
const updateIntegration = vi.fn();
const upsertMessage = vi.fn();
const clientsFindMany = vi.fn(async () => []);

vi.mock('@nexushub/db', () => ({
  prisma: {
    integration: { findFirst: findFirstIntegration, update: updateIntegration },
    client: { findMany: clientsFindMany },
    emailMessage: { upsert: upsertMessage },
  },
}));

vi.mock('@/features/integrations/lib/get-valid-imap-credentials', () => ({
  getValidImapCredentials: vi.fn(async () => ({
    host: 'h',
    port: 993,
    secure: true,
    username: 'u@ex',
    password: 'p',
  })),
}));

const openSession = vi.fn(async () => ({ logout: vi.fn() }));
const listInitial = vi.fn();
const listIncremental = vi.fn();

vi.mock('@nexushub/integrations', () => ({
  openImapSession: (...a: unknown[]) => openSession(...a),
  listInboxInitial: (...a: unknown[]) => listInitial(...a),
  listInboxIncremental: (...a: unknown[]) => listIncremental(...a),
  UidValidityChangedError: class extends Error {},
}));

import { syncImapInbox } from './sync-imap-inbox';

describe('syncImapInbox', () => {
  it('bails out when throttled', async () => {
    findFirstIntegration.mockResolvedValueOnce({
      id: 'i1',
      imapUidValidity: null,
      imapLastSeenUid: null,
      lastSyncedAt: new Date(Date.now() - 5_000),
    });
    const r = await syncImapInbox('i1');
    expect(r).toEqual({ ok: true, throttled: true });
    expect(openSession).not.toHaveBeenCalled();
  });

  it('does initial fetch when uidValidity is null', async () => {
    findFirstIntegration.mockResolvedValueOnce({
      id: 'i1',
      imapUidValidity: null,
      imapLastSeenUid: null,
      lastSyncedAt: null,
    });
    listInitial.mockResolvedValueOnce({
      messages: [
        {
          externalId: '1',
          subject: 's',
          fromEmail: 'a@ex.com',
          fromName: null,
          toRecipients: [],
          ccRecipients: [],
          receivedAt: new Date(),
          isRead: false,
          conversationId: null,
          bodyText: '',
          bodyHtmlSanitized: null,
        },
      ],
      uidValidity: 100n,
      lastSeenUid: 1n,
    });
    const r = await syncImapInbox('i1');
    expect(r).toMatchObject({ ok: true, fetched: 1 });
    expect(upsertMessage).toHaveBeenCalledOnce();
    expect(updateIntegration).toHaveBeenCalledOnce();
  });

  it('records error + bumps lastSyncedAt on failure', async () => {
    findFirstIntegration.mockResolvedValueOnce({
      id: 'i1',
      imapUidValidity: null,
      imapLastSeenUid: null,
      lastSyncedAt: null,
    });
    listInitial.mockRejectedValueOnce(new Error('boom'));
    const r = await syncImapInbox('i1');
    expect(r.ok).toBe(false);
    expect(updateIntegration).toHaveBeenCalledOnce();
    const data = updateIntegration.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(data.data.lastError).toBe('boom');
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `sync-imap-inbox.ts`**

```ts
'use server';
import 'server-only';
import { prisma } from '@nexushub/db';
import { requireUser } from '@/lib/auth';
import { getValidImapCredentials } from '@/features/integrations/lib/get-valid-imap-credentials';
import {
  openImapSession,
  listInboxInitial,
  listInboxIncremental,
  UidValidityChangedError,
  type ParsedMailMessage,
} from '@nexushub/integrations';
import { buildDomainIndex, matchClientByDomain } from '../lib/auto-associate';

export type SyncImapResult =
  | { readonly ok: true; readonly fetched: number; readonly uidValidityChanged?: boolean }
  | { readonly ok: true; readonly throttled: true }
  | { readonly ok: false; readonly message: string };

const THROTTLE_MS = 30_000;
const INITIAL_DAYS = 30;
const INITIAL_MAX = 200;

export async function syncImapInbox(integrationId: string): Promise<SyncImapResult> {
  const ctx = await requireUser();
  const integration = await prisma.integration.findFirst({
    where: {
      id: integrationId,
      workspaceId: ctx.workspaceId,
      ownerUserId: ctx.userId,
      kind: 'imap',
      status: 'active',
    },
    select: { id: true, imapUidValidity: true, imapLastSeenUid: true, lastSyncedAt: true },
  });
  if (!integration) return { ok: false, message: 'Boîte IMAP introuvable.' };
  if (integration.lastSyncedAt && Date.now() - integration.lastSyncedAt.getTime() < THROTTLE_MS) {
    return { ok: true, throttled: true };
  }

  let creds;
  try {
    creds = await getValidImapCredentials({
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      integrationId,
    });
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'creds error' };
  }

  const clients = await prisma.client.findMany({
    where: { workspaceId: ctx.workspaceId, deletedAt: null },
    select: { id: true, domains: true },
    orderBy: { createdAt: 'asc' },
  });
  const domainIndex = buildDomainIndex(clients.map((c) => ({ id: c.id, emailDomains: c.domains })));

  let fetched: readonly ParsedMailMessage[] = [];
  let uidValidity = integration.imapUidValidity;
  let lastSeenUid = integration.imapLastSeenUid;
  let uidValidityChanged = false;

  try {
    const session = await openImapSession(creds);
    try {
      if (uidValidity === null || lastSeenUid === null) {
        const r = await listInboxInitial({
          session,
          sinceDays: INITIAL_DAYS,
          maxMessages: INITIAL_MAX,
        });
        fetched = r.messages;
        uidValidity = r.uidValidity;
        lastSeenUid = r.lastSeenUid;
      } else {
        try {
          const r = await listInboxIncremental({ session, uidValidity, lastSeenUid });
          fetched = r.messages;
          uidValidity = r.uidValidity;
          lastSeenUid = r.lastSeenUid;
        } catch (e) {
          if (e instanceof UidValidityChangedError) {
            uidValidityChanged = true;
            const r = await listInboxInitial({
              session,
              sinceDays: INITIAL_DAYS,
              maxMessages: INITIAL_MAX,
            });
            fetched = r.messages;
            uidValidity = r.uidValidity;
            lastSeenUid = r.lastSeenUid;
          } else throw e;
        }
      }
    } finally {
      try {
        await session.logout();
      } catch {
        /* swallow */
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'IMAP fetch failed';
    await prisma.integration.update({
      where: { id: integration.id },
      data: { lastSyncedAt: new Date(), lastError: message, status: 'error' },
    });
    return { ok: false, message };
  }

  for (const m of fetched) {
    const clientId = matchClientByDomain(m.fromEmail, domainIndex);
    await prisma.emailMessage.upsert({
      where: {
        workspaceId_integrationId_externalId: {
          workspaceId: ctx.workspaceId,
          integrationId: integration.id,
          externalId: m.externalId,
        },
      },
      create: {
        workspaceId: ctx.workspaceId,
        integrationId: integration.id,
        externalId: m.externalId,
        folder: 'inbox',
        subject: m.subject,
        fromEmail: m.fromEmail,
        fromName: m.fromName,
        toRecipients: [...m.toRecipients],
        ccRecipients: [...m.ccRecipients],
        bodyText: m.bodyText,
        bodyHtmlSanitized: m.bodyHtmlSanitized,
        receivedAt: m.receivedAt,
        isRead: m.isRead,
        conversationId: m.conversationId,
        ...(clientId ? { clientId } : {}),
      },
      update: {
        subject: m.subject,
        bodyText: m.bodyText,
        bodyHtmlSanitized: m.bodyHtmlSanitized,
        isRead: m.isRead,
        deletedAt: null,
      },
    });
  }

  await prisma.integration.update({
    where: { id: integration.id },
    data: {
      lastSyncedAt: new Date(),
      lastError: null,
      status: 'active',
      imapUidValidity: uidValidity ?? null,
      imapLastSeenUid: lastSeenUid ?? null,
    },
  });
  return {
    ok: true,
    fetched: fetched.length,
    ...(uidValidityChanged ? { uidValidityChanged: true } : {}),
  };
}
```

- [ ] **Step 4: Update `apps/web/app/(app)/communications/page.tsx` — parallel sync**

Locate the current single-sync block:

```ts
if (
  integration.status === 'active' &&
  (!integration.lastSyncedAt || Date.now() - integration.lastSyncedAt.getTime() > SYNC_FRESHNESS_MS)
) {
  await syncGraphInbox();
}
```

Replace with a parallel sync of all mailboxes owned by the user:

```ts
// Sync every active mailbox (graph + imap) the user owns in parallel.
// Promise.allSettled so a failing IMAP does not stall the Graph sync.
const activeMailboxes = await prisma.integration.findMany({
  where: {
    workspaceId: ctx.workspaceId,
    ownerUserId: ctx.userId,
    kind: { in: ['graph', 'imap'] },
    status: 'active',
  },
  select: { id: true, kind: true, lastSyncedAt: true },
});
await Promise.allSettled(
  activeMailboxes
    .filter((m) => !m.lastSyncedAt || Date.now() - m.lastSyncedAt.getTime() > SYNC_FRESHNESS_MS)
    .map((m) => (m.kind === 'graph' ? syncGraphInbox() : syncImapInbox(m.id))),
);
```

Import `syncImapInbox`:

```ts
import { syncImapInbox } from '@/features/communications/actions/sync-imap-inbox';
```

Also update the empty-state gate — from the current findFirst restricted to graph, change the gate to _any_ active integration:

```ts
// Replace the existing gate (currently: findFirst kind:'graph').
// Show the empty state only when the user has NO active/error mailbox at all.
const hasAnyMailbox = await prisma.integration.count({
  where: {
    workspaceId: ctx.workspaceId,
    ownerUserId: ctx.userId,
    kind: { in: ['graph', 'imap'] },
    status: { in: ['active', 'error'] },
  },
});
if (hasAnyMailbox === 0) {
  return (
    <div className="mx-auto max-w-[1100px]">
      <header className="mb-6">
        <h1 className="text-[28px] font-extrabold tracking-tight">Communications</h1>
      </header>
      <EmptyNoIntegration />
    </div>
  );
}
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
pnpm --filter @nexushub/web test -- sync-imap-inbox
pnpm --filter @nexushub/web typecheck
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/features/communications/actions/sync-imap-inbox.ts apps/web/features/communications/actions/sync-imap-inbox.test.ts apps/web/app/\(app\)/communications/page.tsx
git commit -m "feat(comm): sync-imap-inbox + parallel graph+imap sync on /communications"
```

---

## Task 17: `MailboxCard` + `MailboxList` (replace `OutlookCard`)

**Files:**

- Create: `apps/web/features/integrations/components/mailbox-card.tsx`
- Create: `apps/web/features/integrations/components/mailbox-list.tsx`
- Create (stub): `apps/web/features/integrations/components/add-mailbox-modal.tsx` (body filled in by Task 18)
- Delete: `apps/web/features/integrations/components/outlook-card.tsx`
- Modify: `apps/web/features/integrations/components/integrations-grid.tsx` (import + usage)
- Modify: `apps/web/app/(app)/integrations/page.tsx` (query all mailboxes)

**Ordering note:** `MailboxList` imports `AddMailboxModal` (implemented in Task 18). To keep the working tree building at every commit, Step 1 below creates a **stub** `add-mailbox-modal.tsx` whose body is a no-op React component. Task 18 replaces the file's body.

- [ ] **Step 1a: Create the AddMailboxModal stub (temporary — replaced in Task 18)**

`apps/web/features/integrations/components/add-mailbox-modal.tsx`:

```tsx
'use client';

interface Props {
  readonly onClose: () => void;
  readonly reconnectFor: { integrationId: string; email: string } | null;
}

// Stub — real implementation lands in Task 18.
export function AddMailboxModal(_props: Props): null {
  return null;
}
```

- [ ] **Step 1: Implement `MailboxCard`**

```tsx
'use client';
import { useTransition } from 'react';
import { disconnectImapMailbox } from '../actions/disconnect-imap-mailbox';
import { disconnectGraph } from '../actions/disconnect-graph';

export interface MailboxCardData {
  readonly integrationId: string;
  readonly kind: 'graph' | 'imap';
  readonly label: string;
  readonly status: 'active' | 'error' | 'revoked';
  readonly lastSyncedAt: string | null;
  readonly lastError: string | null;
}

export function MailboxCard({
  data,
  onReconnect,
}: {
  data: MailboxCardData;
  onReconnect?: () => void;
}) {
  const [pending, start] = useTransition();
  const badgeColor =
    data.status === 'active'
      ? 'var(--color-success)'
      : data.status === 'error'
        ? 'var(--color-warning)'
        : 'var(--color-text-muted)';
  return (
    <div
      className="flex items-center justify-between gap-4 rounded-xl border px-4 py-3"
      style={{
        borderColor: 'var(--color-border-light)',
        background: 'var(--color-bg-card)',
      }}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span aria-hidden style={{ color: badgeColor }}>
          ●
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{data.label}</div>
          <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {data.kind === 'graph' ? 'Microsoft' : 'IMAP'}
            {data.lastSyncedAt
              ? ` · sync ${new Date(data.lastSyncedAt).toLocaleString('fr-FR')}`
              : ''}
            {data.status === 'error' && data.lastError ? ` · ${data.lastError}` : ''}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {data.status === 'error' && onReconnect ? (
          <button
            type="button"
            onClick={onReconnect}
            className="rounded-md border px-3 py-1 text-xs font-medium"
            style={{ borderColor: 'var(--color-border-light)' }}
          >
            Reconnecter
          </button>
        ) : null}
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              if (data.kind === 'graph') await disconnectGraph();
              else await disconnectImapMailbox({ integrationId: data.integrationId });
            })
          }
          className="rounded-md border px-3 py-1 text-xs font-medium"
          style={{ borderColor: 'var(--color-border-light)' }}
        >
          {pending ? '…' : 'Déconnecter'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Implement `MailboxList`**

```tsx
'use client';
import { useState } from 'react';
import { MailboxCard, type MailboxCardData } from './mailbox-card';
import { AddMailboxModal } from './add-mailbox-modal';

export function MailboxList({ mailboxes }: { mailboxes: readonly MailboxCardData[] }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [reconnectTarget, setReconnectTarget] = useState<MailboxCardData | null>(null);
  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Boîtes email</h2>
        <button
          type="button"
          onClick={() => {
            setReconnectTarget(null);
            setModalOpen(true);
          }}
          className="rounded-lg px-3 py-1.5 text-sm font-medium"
          style={{
            background: 'var(--accent-gradient)',
            color: 'var(--color-text-on-accent, white)',
          }}
        >
          + Ajouter une boîte
        </button>
      </div>
      {mailboxes.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
          Aucune boîte connectée. Ajoute-en une pour voir tes mails dans Communications.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {mailboxes.map((m) => (
            <MailboxCard
              key={m.integrationId}
              data={m}
              onReconnect={
                m.kind === 'imap'
                  ? () => {
                      setReconnectTarget(m);
                      setModalOpen(true);
                    }
                  : undefined
              }
            />
          ))}
        </div>
      )}
      {modalOpen ? (
        <AddMailboxModal
          onClose={() => setModalOpen(false)}
          reconnectFor={
            reconnectTarget
              ? { integrationId: reconnectTarget.integrationId, email: reconnectTarget.label }
              : null
          }
        />
      ) : null}
    </section>
  );
}
```

- [ ] **Step 3: Update `apps/web/app/(app)/integrations/page.tsx`**

Replace the current single Graph query with:

```ts
const mailboxRows = await prisma.integration.findMany({
  where: {
    workspaceId: ctx.workspaceId,
    ownerUserId: ctx.userId,
    kind: { in: ['graph', 'imap'] },
    status: { in: ['active', 'error'] },
  },
  select: {
    id: true,
    kind: true,
    externalAccountLabel: true,
    status: true,
    lastSyncedAt: true,
    lastError: true,
  },
  orderBy: { createdAt: 'asc' },
});

const mailboxes: readonly MailboxCardData[] = mailboxRows.map((m) => ({
  integrationId: m.id,
  kind: m.kind as 'graph' | 'imap',
  label: m.externalAccountLabel ?? '(sans nom)',
  status: m.status as 'active' | 'error' | 'revoked',
  lastSyncedAt: m.lastSyncedAt ? m.lastSyncedAt.toISOString() : null,
  lastError: m.lastError ?? null,
}));
```

Replace `<IntegrationsGrid outlook={outlook} />` with:

```tsx
<MailboxList mailboxes={mailboxes} />
<IntegrationsGrid /* other integrations e.g. Slack */ />
```

Delete the now-unused `outlook-card.tsx` if `IntegrationsGrid` no longer imports it. If `IntegrationsGrid` currently only rendered Outlook, refactor it to only render non-mailbox integrations going forward. Verify with `grep -R OutlookCard apps/web` → 0 hits.

- [ ] **Step 4: Typecheck + run tests**

```bash
pnpm --filter @nexushub/web typecheck
pnpm --filter @nexushub/web test
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/features/integrations/components/mailbox-card.tsx apps/web/features/integrations/components/mailbox-list.tsx apps/web/features/integrations/components/integrations-grid.tsx apps/web/app/\(app\)/integrations/page.tsx
git rm apps/web/features/integrations/components/outlook-card.tsx
git commit -m "feat(integrations): unified MailboxCard/MailboxList replaces OutlookCard"
```

---

## Task 18: `AddMailboxModal` (type picker + IMAP form with autodiscover)

**Files:**

- Create: `apps/web/features/integrations/components/add-mailbox-modal.tsx`
- Create: `apps/web/features/integrations/actions/autodiscover.ts` (thin server action wrapper)

Note the modal is a client component that calls both actions (`autodiscoverImap` server action + `testImapConnectionAction` + `addImapMailbox` / `updateImapCredentials`). Reused Radix `Dialog` primitive already in the codebase (search `components/ui/dialog` — reuse rather than reinstall).

- [ ] **Step 1: Create the autodiscover server action**

```ts
'use server';
import 'server-only';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { autodiscoverImap, type AutodiscoverResult } from '@nexushub/integrations';

const schema = z.object({ email: z.string().email().max(320) });

export async function autodiscoverImapAction(
  raw: z.infer<typeof schema>,
): Promise<AutodiscoverResult | null> {
  await requireUser(); // no rate limit — this hits the mailbox provider only, low risk
  const parsed = schema.parse(raw);
  return autodiscoverImap(parsed.email);
}
```

- [ ] **Step 2: Implement the modal**

```tsx
'use client';
import { useState, useTransition } from 'react';
import { startGraphOAuth } from '../actions/start-graph-oauth';
import { autodiscoverImapAction } from '../actions/autodiscover';
import { testImapConnectionAction } from '../actions/test-imap-connection';
import { addImapMailbox } from '../actions/add-imap-mailbox';
import { updateImapCredentials } from '../actions/update-imap-credentials';

interface Props {
  readonly onClose: () => void;
  readonly reconnectFor: { integrationId: string; email: string } | null;
}

type Step = 'pick' | 'imap-form';
type TestState = { tested: boolean; ok: boolean; message: string | null };

export function AddMailboxModal({ onClose, reconnectFor }: Props) {
  const [step, setStep] = useState<Step>(reconnectFor ? 'imap-form' : 'pick');
  const [pending, start] = useTransition();
  const [email, setEmail] = useState(reconnectFor?.email ?? '');
  const [host, setHost] = useState('');
  const [port, setPort] = useState(993);
  const [secure, setSecure] = useState(true);
  const [password, setPassword] = useState('');
  const [autoDetected, setAutoDetected] = useState(false);
  const [test, setTest] = useState<TestState>({ tested: false, ok: false, message: null });
  const [saveError, setSaveError] = useState<string | null>(null);

  async function onEmailBlur() {
    if (!email.includes('@') || reconnectFor) return;
    start(async () => {
      const r = await autodiscoverImapAction({ email });
      if (r) {
        setHost(r.host);
        setPort(r.port);
        setSecure(r.secure);
        setAutoDetected(true);
      } else {
        setAutoDetected(false);
      }
    });
  }

  async function runTest() {
    setTest({ tested: false, ok: false, message: null });
    start(async () => {
      const r = await testImapConnectionAction({ host, port, secure, username: email, password });
      if (r.ok) setTest({ tested: true, ok: true, message: 'Connexion OK.' });
      else setTest({ tested: true, ok: false, message: `${r.code}: ${r.message}` });
    });
  }

  async function save() {
    setSaveError(null);
    start(async () => {
      const res = reconnectFor
        ? await updateImapCredentials({
            integrationId: reconnectFor.integrationId,
            host,
            port,
            secure,
            password,
          })
        : await addImapMailbox({ email, host, port, secure, password });
      if (res.ok) onClose();
      else setSaveError(res.message);
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl p-6"
        style={{
          background: 'var(--color-bg-card)',
          border: '1px solid var(--color-border-light)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {step === 'pick' ? (
          <>
            <h3 className="mb-4 text-lg font-semibold">Ajouter une boîte email</h3>
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={() =>
                  start(async () => {
                    await startGraphOAuth();
                  })
                }
                className="rounded-lg border px-4 py-3 text-left"
                style={{ borderColor: 'var(--color-border-light)' }}
              >
                <div className="font-medium">Microsoft (Outlook / Exchange Online)</div>
                <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  OAuth — recommandé pour les comptes Microsoft 365.
                </div>
              </button>
              <button
                type="button"
                onClick={() => setStep('imap-form')}
                className="rounded-lg border px-4 py-3 text-left"
                style={{ borderColor: 'var(--color-border-light)' }}
              >
                <div className="font-medium">IMAP (Fastmail, OVH, autre)</div>
                <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  Formulaire manuel — auto-détection sur email connu.
                </div>
              </button>
            </div>
          </>
        ) : (
          <>
            <h3 className="mb-4 text-lg font-semibold">
              {reconnectFor ? 'Reconnecter' : 'Ajouter'} une boîte IMAP
            </h3>
            <label className="mb-2 block text-sm">
              <span className="mb-1 block font-medium">Adresse email</span>
              <input
                type="email"
                value={email}
                disabled={!!reconnectFor}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={onEmailBlur}
                className="w-full rounded-md border px-3 py-2 text-sm"
                style={{
                  borderColor: 'var(--color-border-light)',
                  background: 'var(--color-bg-input)',
                }}
              />
            </label>

            {autoDetected ? (
              <p className="mb-3 text-xs" style={{ color: 'var(--color-success)' }}>
                ✓ Détecté : {host}:{port} ({secure ? 'TLS' : 'clair'})
              </p>
            ) : (
              <div className="mb-3 grid grid-cols-[1fr_100px] gap-2">
                <label className="block text-sm">
                  <span className="mb-1 block font-medium">Serveur IMAP</span>
                  <input
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                    className="w-full rounded-md border px-3 py-2 text-sm"
                    style={{
                      borderColor: 'var(--color-border-light)',
                      background: 'var(--color-bg-input)',
                    }}
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block font-medium">Port</span>
                  <input
                    type="number"
                    value={port}
                    onChange={(e) => setPort(Number(e.target.value))}
                    className="w-full rounded-md border px-3 py-2 text-sm"
                    style={{
                      borderColor: 'var(--color-border-light)',
                      background: 'var(--color-bg-input)',
                    }}
                  />
                </label>
                <label className="col-span-2 flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={secure}
                    onChange={(e) => setSecure(e.target.checked)}
                  />
                  <span>TLS (recommandé)</span>
                </label>
              </div>
            )}

            <label className="mb-2 block text-sm">
              <span className="mb-1 block font-medium">Mot de passe</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm"
                style={{
                  borderColor: 'var(--color-border-light)',
                  background: 'var(--color-bg-input)',
                }}
              />
            </label>
            <p className="mb-4 text-xs" style={{ color: 'var(--color-text-muted)' }}>
              Si ton compte a la 2FA activée, utilise un mot de passe d&apos;application.
            </p>

            {test.tested ? (
              <p
                className="mb-3 text-xs"
                style={{ color: test.ok ? 'var(--color-success)' : 'var(--color-danger)' }}
              >
                {test.message}
              </p>
            ) : null}
            {saveError ? (
              <p className="mb-3 text-xs" style={{ color: 'var(--color-danger)' }}>
                {saveError}
              </p>
            ) : null}

            <div className="flex items-center justify-end gap-2">
              <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm">
                Annuler
              </button>
              <button
                type="button"
                onClick={runTest}
                disabled={pending || !host || !port || !password}
                className="rounded-md border px-3 py-1.5 text-sm"
                style={{ borderColor: 'var(--color-border-light)' }}
              >
                {pending ? '…' : 'Tester la connexion'}
              </button>
              <button
                type="button"
                onClick={save}
                disabled={pending || !test.tested || !test.ok}
                className="rounded-md px-3 py-1.5 text-sm font-medium"
                style={{
                  background: 'var(--accent-gradient)',
                  color: 'var(--color-text-on-accent, white)',
                }}
              >
                {pending ? '…' : 'Enregistrer'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @nexushub/web typecheck
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/features/integrations/components/add-mailbox-modal.tsx apps/web/features/integrations/actions/autodiscover.ts
git commit -m "feat(integrations): AddMailboxModal with autodiscover + test-connection gate"
```

---

## Task 19: `MailboxFilter` dropdown on `/communications`

**Files:**

- Create: `apps/web/features/communications/components/mailbox-filter.tsx`
- Modify: `apps/web/stores/` — add a `mailbox-filter-store.ts` (mirror the client filter store)
- Modify: `apps/web/app/(app)/communications/page.tsx` — parse `?mailbox=<id>` and pass to Prisma query
- Test: `apps/web/features/communications/components/mailbox-filter.test.tsx`

- [ ] **Step 1: Create the Zustand store**

```ts
// apps/web/stores/mailbox-filter-store.ts
import { create } from 'zustand';

interface State {
  readonly mailboxId: string | null;
  readonly setMailboxId: (id: string | null) => void;
}

export const useMailboxFilterStore = create<State>((set) => ({
  mailboxId: null,
  setMailboxId: (id) => set({ mailboxId: id }),
}));
```

- [ ] **Step 2: Implement `MailboxFilter`**

```tsx
'use client';
import { useEffect } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useMailboxFilterStore } from '@/stores/mailbox-filter-store';

interface Option {
  readonly id: string;
  readonly label: string;
}

export function MailboxFilter({
  options,
  initialMailboxId,
}: {
  options: readonly Option[];
  initialMailboxId: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { mailboxId, setMailboxId } = useMailboxFilterStore();

  // Sync store from URL on first mount
  useEffect(() => {
    setMailboxId(initialMailboxId);
  }, [initialMailboxId, setMailboxId]);

  return (
    <label className="flex items-center gap-2 text-sm">
      <span style={{ color: 'var(--color-text-muted)' }}>Boîte :</span>
      <select
        value={mailboxId ?? ''}
        onChange={(e) => {
          const next = e.target.value || null;
          setMailboxId(next);
          const params = new URLSearchParams(searchParams.toString());
          if (next) params.set('mailbox', next);
          else params.delete('mailbox');
          router.push(`${pathname}${params.toString() ? `?${params}` : ''}`);
        }}
        className="rounded-md border px-2 py-1 text-sm"
        style={{ borderColor: 'var(--color-border-light)', background: 'var(--color-bg-input)' }}
      >
        <option value="">Toutes</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
```

- [ ] **Step 3: Wire into `/communications/page.tsx`**

- Parse `sp.mailbox` (string | undefined).
- Fetch mailbox options (Integration rows kind∈graph/imap status∈active/error) for the toolbar.
- Extend the Prisma `where` clause for `EmailMessage` with `...(mailboxFilter ? { integrationId: mailboxFilter } : {})`.
- Render `<MailboxFilter options={...} initialMailboxId={mailboxFilter} />` inside the toolbar next to the client chip.

- [ ] **Step 4: Test — verify URL sync**

Write a quick RTL test:

```ts
// packages/web tests are Vitest + jsdom; verify the change handler updates URL
// (or defer to E2E in Task 22 if RTL setup for App Router is heavy).
```

If your test setup does not have `useRouter` easily mockable, skip the RTL test and rely on the E2E in Task 22.

- [ ] **Step 5: Commit**

```bash
git add apps/web/features/communications/components/mailbox-filter.tsx apps/web/stores/mailbox-filter-store.ts apps/web/app/\(app\)/communications/page.tsx
git commit -m "feat(comm): mailbox filter dropdown with URL sync + zustand"
```

---

## Task 20: Source badge in `MailList` on 'Toutes' view

**Files:**

- Modify: `apps/web/features/communications/components/mail-list.tsx` (add optional source badge)
- Modify: `apps/web/features/communications/lib/mail-dto.ts` (include `mailboxLabel`)

- [ ] **Step 1: Extend DTO to include mailbox label**

Look at current `toMailDTO` — augment its input type to include `integration: { externalAccountLabel: string | null } | null` and its output to include:

```ts
export interface MailDTO {
  // ... existing fields
  readonly mailboxLabel: string | null;
}
```

In `page.tsx`, extend the `select` for `emailMessage.findMany`:

```ts
select: {
  // ... existing
  integration: { select: { externalAccountLabel: true } },
},
```

Map it into `toMailDTO` and pass `showMailboxBadge={!mailboxFilter}` to `MailList`.

- [ ] **Step 2: Update `MailList` to render the badge**

In the row where `fromName` is rendered, add (conditionally):

```tsx
{
  showMailboxBadge && mail.mailboxLabel ? (
    <span className="ml-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
      · {mail.mailboxLabel}
    </span>
  ) : null;
}
```

- [ ] **Step 3: Typecheck + tests**

```bash
pnpm --filter @nexushub/web typecheck
pnpm --filter @nexushub/web test
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/features/communications/components/mail-list.tsx apps/web/features/communications/lib/mail-dto.ts apps/web/app/\(app\)/communications/page.tsx
git commit -m "feat(comm): show source mailbox badge on 'Toutes' view"
```

---

## Task 21: Runbook + PRD + progress.md + CLAUDE.md follow-ups

**Files:**

- Create: `docs/runbooks/imap-integration.md`
- Modify: `docs/runbooks/microsoft-graph-integration.md` (cross-link + note the shared sanitize module)
- Modify: `PRD-NexusHub.md` (note IMAP in Communications V1)
- Modify: `progress.md` (mark IMAP tasks + note migration applied to shared DB)
- Modify: `CLAUDE.md` (journal entry)

- [ ] **Step 1: Write the runbook**

Create `docs/runbooks/imap-integration.md` with these sections: **Preconditions**, **Env vars** (none new — reuses `ENCRYPTION_KEY`, Upstash `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`, `NEXT_PUBLIC_APP_URL`), **Migration** (Task 3 procedure exact SQL + pre-check + verification), **Common connect problems** (AUTH → app password, TLS → wrong port/secure combo, HOST → typo/DNS), **Disconnect** (does not delete `EmailMessage` rows), **Rollback** (revoke all `imap` rows: `UPDATE integrations SET status='revoked', encrypted_tokens=NULL WHERE kind='imap'`; then optional down-migration).

- [ ] **Step 2: Cross-link the Graph runbook**

Append a note at the top of `docs/runbooks/microsoft-graph-integration.md`:

```markdown
> **See also:** [`imap-integration.md`](./imap-integration.md) for the generic IMAP flow. Both adapters share the sanitize allowlist at `packages/integrations/src/mail/sanitize.ts` — any change there affects both mail sources.
```

- [ ] **Step 3: PRD update**

In `PRD-NexusHub.md`, in the Communications section, update the V1 email sources line to read:

```
Mail V1 : lecture (INBOX) via Microsoft Graph (Outlook/M365) OU IMAP générique (OVH, Fastmail, iCloud, self-hosted…). Mail V1.5 : envoi + pièces jointes.
```

- [ ] **Step 4: progress.md**

Add an entry under Communications:

```markdown
- [x] IMAP mailbox integration — read-only V1, multi-mailbox per user, autodiscover, unified UI, filter dropdown. Migration `<timestamp>_imap_integration_foundations` applied to shared Supabase on YYYY-MM-DD.
```

- [ ] **Step 5: CLAUDE.md journal**

Append a row to §11:

| Date       | Modification                                                      | Auteur             |
| ---------- | ----------------------------------------------------------------- | ------------------ |
| 2026-07-15 | Adapter IMAP générique (Communications iter 2) + sanitize partagé | Angelo L. + Claude |

- [ ] **Step 6: Commit**

```bash
git add docs/runbooks/imap-integration.md docs/runbooks/microsoft-graph-integration.md PRD-NexusHub.md progress.md CLAUDE.md
git commit -m "docs(imap): runbook + PRD + progress + claude.md journal"
```

---

## Task 22: E2E smoke tests

**Files:**

- Create: `e2e/tests/imap-integration.spec.ts`

- [ ] **Step 1: Write the smoke**

```ts
import { test, expect } from '@playwright/test';

test.describe('IMAP integration @smoke', () => {
  test('shows Add mailbox modal and picks IMAP flow', async ({ page }) => {
    await page.goto('/integrations');
    await page.getByRole('button', { name: /Ajouter une boîte/i }).click();
    await expect(page.getByText('Ajouter une boîte email')).toBeVisible();
    await page.getByRole('button', { name: /IMAP/i }).click();
    await expect(page.getByText(/Ajouter une boîte IMAP/i)).toBeVisible();
    // Cancel — no persistent state
    await page.getByRole('button', { name: /Annuler/i }).click();
  });

  test('/communications toolbar exposes the mailbox filter', async ({ page }) => {
    await page.goto('/communications');
    // Filter is only rendered when the user has at least one mailbox — assert
    // the DOM element exists (may be an empty select if no boxes yet).
    const filter = page.getByLabel(/Boîte/);
    await expect(filter).toBeVisible();
  });
});
```

- [ ] **Step 2: Run E2E locally**

```bash
pnpm e2e -- --grep @smoke
```

Expected: both smokes pass. If the local dev server needs env vars, the existing `e2e/playwright.config.ts` handles it — no new config.

- [ ] **Step 3: Commit**

```bash
git add e2e/tests/imap-integration.spec.ts
git commit -m "test(e2e): IMAP integration smokes (add-mailbox modal + filter dropdown)"
```

---

## Task 23: Final verification + PR

**Files:**

- None (operational).

- [ ] **Step 1: Run the full test matrix from the worktree root**

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm --filter @nexushub/web build
```

Expected: all green.

- [ ] **Step 2: Diff review — verify no secret leaked, no `console.log` of credentials**

```bash
git diff main -- '*.ts' '*.tsx' | grep -E '(password|encryptedTokens|IMAP.*secret)' | less
```

Expected: only encrypted references + zod schemas + explicit `password` prop wiring. No literal password value, no console.

- [ ] **Step 3: Push and open PR**

```bash
git push -u origin feature/imap-integration
gh pr create --title "feat(communications): IMAP integration (Communications iter 2)" --body "$(cat <<'EOF'
## Summary
- Extend Integration table with `kind='imap'` + 2 nullable IMAP-specific fields
- Add `EmailMessage.integrationId` FK (migration backfills from single Graph per workspace)
- New IMAP adapter at `packages/integrations/src/imap/` (client, autodiscover, parse, messages, connection-test)
- Shared mail primitives at `packages/integrations/src/mail/` (sanitize allowlist + `ParsedMailMessage` type) — Graph adapter refactored to reuse them
- Server actions: test / add / update / disconnect / sync IMAP mailbox
- `/integrations`: unified `Boîtes email` section with add-mailbox modal (autodiscover + test-connection gate)
- `/communications`: parallel sync (graph + imap) + mailbox filter dropdown + source badge on 'Toutes' view

## Test plan
- [x] Unit + Integration green (pnpm test)
- [x] Typecheck green (pnpm typecheck)
- [x] Build green (pnpm --filter @nexushub/web build)
- [x] E2E smokes green (pnpm e2e -- --grep @smoke)
- [ ] Preview deploy: connect an IMAP mailbox (OVH Exchange), verify emails appear in /communications, verify filter dropdown works
- [ ] Migration applied to shared Supabase before merge

## Security notes
- Credentials AES-256-GCM encrypted (reuses ENCRYPTION_KEY)
- Rate-limited `imap_test` (5 / user / 5 min via Upstash)
- TLS default on; opt-out requires explicit user consent
- Ownership check in every server action (multi-tenant leak test included)
- Audit events: mailbox_connected, mailbox_credentials_updated, mailbox_disconnected

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Manually verify in preview**

Open the preview URL, `/integrations` → `+ Ajouter une boîte` → IMAP → connect OVH mailbox → back on `/integrations` shows the new card ● active → `/communications` shows mails, dropdown `Boîte : Toutes ▾` includes the new mailbox and filters correctly.
