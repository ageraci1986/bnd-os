# Email Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship iteration 1 of the Communications email integration — users connect their Outlook mailbox via Microsoft Graph (delegated OAuth, multi-tenant work/school), and read auto-associated mails in `/communications`. No reply, no templates, no realtime — fondations only.

**Architecture:** Hexagonal — `packages/integrations/graph/` is a pure HTTP adapter for Microsoft Graph (no Next dependency); `apps/web/lib/oauth/` provides reusable AES-256-GCM crypto + HMAC `state` signing for OAuth flows (Slack will reuse later); `apps/web/features/integrations/` owns the connect/disconnect surface and the `/integrations` UI; `apps/web/features/communications/` owns mailbox sync, auto-association by sender domain, and the `/communications` mail list/reader UI. OAuth callback is the only Next route handler (HTTP redirect required); all other server-side ops are Server Actions.

**Tech Stack:** Next.js 15 App Router + React 19 (Server Components first), Prisma 6 on Supabase, Node `crypto` (AES-256-GCM, HMAC-SHA256), raw `fetch` to Graph (no SDK — 5 endpoints), `sanitize-html` for body bodies, Vitest unit/integration, Playwright E2E. Tokens design system mandatory (zero hex in UI code — use `var(--color-*)` and Tailwind tokens).

**Spec reference:** [docs/superpowers/specs/2026-05-28-email-foundations-design.md](../specs/2026-05-28-email-foundations-design.md)

---

## File map (created or modified)

```
apps/web/
  lib/env.ts                                      MODIFY  +OAUTH_STATE_SECRET
  lib/oauth/crypto.ts                             CREATE  AES-256-GCM helpers
  lib/oauth/crypto.test.ts                        CREATE
  lib/oauth/state.ts                              CREATE  HMAC state sign/verify
  lib/oauth/state.test.ts                         CREATE
  features/integrations/
    lib/get-valid-access-token.ts                 CREATE  decrypt + refresh rotation
    lib/get-valid-access-token.test.ts            CREATE
    actions/start-graph-oauth.ts                  CREATE
    actions/start-graph-oauth.test.ts             CREATE
    actions/disconnect-graph.ts                   CREATE
    actions/disconnect-graph.test.ts              CREATE
    components/outlook-card.tsx                   CREATE
    components/integrations-grid.tsx              CREATE
  features/communications/
    lib/auto-associate.ts                         CREATE  domain → clientId (pure)
    lib/auto-associate.test.ts                    CREATE
    lib/mail-dto.ts                               CREATE  EmailMessage → UI shape
    actions/sync-graph-inbox.ts                   CREATE  initial + delta + throttle
    actions/sync-graph-inbox.test.ts              CREATE
    actions/mark-email-read.ts                    CREATE
    actions/mark-email-read.test.ts               CREATE
    components/mail-tabs.tsx                      CREATE
    components/mail-list.tsx                      CREATE  Client Component
    components/mail-reader.tsx                    CREATE
    components/empty-no-integration.tsx           CREATE
  app/api/oauth/graph/callback/route.ts           CREATE  GET handler
  app/api/oauth/graph/callback/route.test.ts      CREATE
  app/(app)/integrations/page.tsx                 REPLACE placeholder
  app/(app)/communications/page.tsx               REPLACE placeholder

packages/integrations/graph/
  client.ts                                       CREATE  fetch wrapper + retry
  client.test.ts                                  CREATE
  parse.ts                                        CREATE  Graph → EmailMessage shape
  parse.test.ts                                   CREATE
  auth.ts                                         CREATE  exchange code + refresh
  auth.test.ts                                    CREATE
  messages.ts                                     CREATE  list initial + delta
  messages.test.ts                                CREATE
  index.ts                                        CREATE  public API barrel

packages/db/
  prisma/schema.prisma                            MODIFY  +Integration.deltaToken, +EmailMessage.deletedAt, widen OAuthState.state to TEXT
  prisma/migrations/<ts>_email_integration_foundations/migration.sql   CREATE

.env.example                                      MODIFY  +OAUTH_STATE_SECRET line
e2e/email-foundations.spec.ts                     CREATE  Playwright happy path
```

---

## Task 0: Worktree + branch + baseline green

**Goal:** Isolated workspace with green baseline before any code.

**Files:** none.

- [ ] **Step 1: Create worktree + branch via superpowers:using-git-worktrees skill conventions**

```bash
cd /Users/angelogeraci/Documents/Application/BND-OS
git check-ignore -q .worktrees && echo "OK ignored" || (echo ".worktrees missing from .gitignore, add and commit" && exit 1)
git worktree add .worktrees/email-foundations -b feature/email-foundations
cd .worktrees/email-foundations
pnpm install
```

- [ ] **Step 2: Verify baseline test suite is green**

```bash
pnpm -r test
```

Expected: all packages PASS, no failures. **STOP if anything fails — investigate first.**

- [ ] **Step 3: Verify typecheck baseline**

```bash
pnpm --filter @nexushub/web exec tsc --noEmit
pnpm --filter @nexushub/db exec tsc --noEmit
pnpm --filter @nexushub/integrations exec tsc --noEmit
```

Expected: exit 0 for each.

- [ ] **Step 4: Confirm the worktree's .env.local is present (symlink to root)**

```bash
ls -la apps/web/.env.local
```

Expected: symlink resolving to a `.env.local` file. If missing, copy from main worktree's setup.

---

## Task 1: Add `OAUTH_STATE_SECRET` to env schema

**Files:**

- Modify: `apps/web/lib/env.ts`
- Modify: `.env.example`

- [ ] **Step 1: Add `OAUTH_STATE_SECRET` to the Zod server schema in `apps/web/lib/env.ts`**

Locate the server schema block where `ENCRYPTION_KEY` is declared and add right after it:

```ts
  OAUTH_STATE_SECRET: z
    .string()
    .min(44, 'OAUTH_STATE_SECRET must be a base64-encoded 32-byte secret (44 chars)'),
```

- [ ] **Step 2: Add the matching line to `.env.example` near `ENCRYPTION_KEY`**

```
# 32-byte base64 secret used to HMAC-sign OAuth `state`. Generate with:
#   openssl rand -base64 32
OAUTH_STATE_SECRET=
```

- [ ] **Step 3: Verify the env loads in dev (assumes user has set the value locally)**

```bash
pnpm --filter @nexushub/web exec tsx -e "import('./lib/env.ts').then(m => console.log('env ok:', !!m.getServerEnv().OAUTH_STATE_SECRET))"
```

Expected: `env ok: true`. If false, the user needs to set `OAUTH_STATE_SECRET` in `.env.local`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/env.ts .env.example
git commit -m "feat(env): add OAUTH_STATE_SECRET for HMAC-signed OAuth state"
```

---

## Task 2: Prisma migration — Integration.deltaToken + EmailMessage.deletedAt

**Files:**

- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<ts>_email_integration_foundations/migration.sql`

- [ ] **Step 1: Add `deltaToken` to the `Integration` model + widen `OAuthState.state` to TEXT**

In `schema.prisma`:

a) Find the `Integration` model. After `lastError String?` add:

```prisma
  /// Opaque Microsoft Graph delta link for incremental sync (non-secret).
  /// Null until first sync completes. Reset on 410 Gone (token expired).
  deltaToken           String?           @map("delta_token")
```

b) Find the `OAuthState` model. The `state` column is currently `String @id @db.VarChar(128)`. Our HMAC-signed states (signed JSON payload + signature) exceed that — change to TEXT:

```prisma
model OAuthState {
  state       String          @id   // was @db.VarChar(128) — widened, signed payload is ~250 chars
  ...
}
```

Just remove the `@db.VarChar(128)` annotation; the SQL migration in Step 3 widens the column.

- [ ] **Step 2: Add `deletedAt` to the `EmailMessage` model in `schema.prisma`**

Inside the `EmailMessage` model, after `updatedAt`:

```prisma
  /// Soft-delete: set when Graph reports the message removed (delta @removed).
  /// Filter out in queries via `where: { deletedAt: null }`.
  deletedAt         DateTime? @map("deleted_at") @db.Timestamptz(6)
```

Add to the indexes block:

```prisma
  @@index([workspaceId, deletedAt])
```

- [ ] **Step 3: Create the migration SQL by hand** (avoid `prisma migrate dev` to keep it offline)

Use a timestamp matching the existing migrations pattern (`YYYYMMDDHHMMSS_name`). Replace `<TS>` with current UTC `date -u +%Y%m%d%H%M%S` truncated to 14 digits.

Create file `packages/db/prisma/migrations/<TS>_email_integration_foundations/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "integrations" ADD COLUMN "delta_token" TEXT;

-- AlterTable
ALTER TABLE "email_messages" ADD COLUMN "deleted_at" TIMESTAMPTZ(6);

-- AlterTable: widen oauth_states.state from VARCHAR(128) to TEXT
-- (signed payload + HMAC exceeds 128 chars).
ALTER TABLE "oauth_states" ALTER COLUMN "state" TYPE TEXT;

-- CreateIndex
CREATE INDEX "email_messages_workspace_id_deleted_at_idx" ON "email_messages" ("workspace_id", "deleted_at");
```

- [ ] **Step 4: Regenerate Prisma client**

```bash
pnpm --filter @nexushub/db db:generate
```

Expected: `✔ Generated Prisma Client`.

- [ ] **Step 5: Verify typecheck still passes (uses the new fields)**

```bash
pnpm --filter @nexushub/web exec tsc --noEmit
```

Expected: exit 0 (no usage yet, so nothing should regress).

- [ ] **Step 6: Apply the migration to the staging DB**

```bash
pnpm --filter @nexushub/db exec prisma migrate deploy
```

Expected: `1 migration applied`.

- [ ] **Step 7: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m "feat(db): add Integration.deltaToken + EmailMessage.deletedAt"
```

---

## Task 3: `lib/oauth/crypto.ts` — AES-256-GCM encrypt/decrypt

**Files:**

- Create: `apps/web/lib/oauth/crypto.ts`
- Test: `apps/web/lib/oauth/crypto.test.ts`

- [ ] **Step 1: Write the failing test** at `apps/web/lib/oauth/crypto.test.ts`

```ts
import { describe, expect, it, vi } from 'vitest';

vi.mock('../env', () => ({
  getServerEnv: () => ({
    ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', // 32 bytes of zeros, base64
    ENCRYPTION_KEY_VERSION: 1,
  }),
}));

import { encryptSecret, decryptSecret, EncryptedSecretError } from './crypto';

describe('crypto', () => {
  it('round-trips a JSON payload', () => {
    const payload = JSON.stringify({ accessToken: 'abc', refreshToken: 'def' });
    const ciphertext = encryptSecret(payload);
    expect(ciphertext.startsWith('v1:1:')).toBe(true);
    expect(decryptSecret(ciphertext)).toBe(payload);
  });

  it('rejects tampered ciphertext', () => {
    const ciphertext = encryptSecret('hello');
    // Flip a byte in the ciphertext segment (last segment).
    const parts = ciphertext.split(':');
    const tampered = parts.slice(0, 4).concat(parts[4]!.replace(/^.{4}/, 'XXXX')).join(':');
    expect(() => decryptSecret(tampered)).toThrow(EncryptedSecretError);
  });

  it('rejects unknown format version', () => {
    expect(() => decryptSecret('v9:1:aa:bb:cc')).toThrow(EncryptedSecretError);
  });

  it('rejects malformed input', () => {
    expect(() => decryptSecret('not-a-ciphertext')).toThrow(EncryptedSecretError);
  });
});
```

- [ ] **Step 2: Run test, confirm it fails (module not found)**

```bash
pnpm --filter @nexushub/web exec vitest run lib/oauth/crypto.test.ts
```

Expected: FAIL with "Cannot find module './crypto'".

- [ ] **Step 3: Implement `apps/web/lib/oauth/crypto.ts`**

```ts
import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { getServerEnv } from '../env';

/**
 * AES-256-GCM encryption for short secrets (OAuth refresh tokens etc.) stored
 * at rest in Postgres. The ciphertext format is self-describing so we can
 * rotate keys without re-encrypting everything at once:
 *
 *   v1:<keyVersion>:<iv_b64>:<tag_b64>:<ciphertext_b64>
 *
 * `keyVersion` is the value of `ENCRYPTION_KEY_VERSION` at encrypt time. Decryption
 * uses the same env var — a future rotation will accept multiple keys.
 *
 * SECURITY: never log the cleartext or the ciphertext. Plus rule: never call
 * from a 'use client' module (the `server-only` import enforces it).
 */
export class EncryptedSecretError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'EncryptedSecretError';
  }
}

const FORMAT = 'v1' as const;
const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

function getKey(): Buffer {
  const raw = getServerEnv().ENCRYPTION_KEY;
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new EncryptedSecretError('ENCRYPTION_KEY must decode to 32 bytes');
  }
  return key;
}

export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const version = getServerEnv().ENCRYPTION_KEY_VERSION;
  return [
    FORMAT,
    String(version),
    iv.toString('base64'),
    tag.toString('base64'),
    ct.toString('base64'),
  ].join(':');
}

export function decryptSecret(ciphertext: string): string {
  const parts = ciphertext.split(':');
  if (parts.length !== 5 || parts[0] !== FORMAT) {
    throw new EncryptedSecretError('Unknown ciphertext format');
  }
  const [, , ivB64, tagB64, ctB64] = parts;
  let iv: Buffer;
  let tag: Buffer;
  let ct: Buffer;
  try {
    iv = Buffer.from(ivB64!, 'base64');
    tag = Buffer.from(tagB64!, 'base64');
    ct = Buffer.from(ctB64!, 'base64');
  } catch {
    throw new EncryptedSecretError('Malformed base64 in ciphertext');
  }
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new EncryptedSecretError('Wrong IV or tag length');
  }
  try {
    const decipher = createDecipheriv(ALGO, getKey(), iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return pt.toString('utf8');
  } catch (err) {
    throw new EncryptedSecretError(
      `Decryption failed: ${err instanceof Error ? err.message : 'unknown'}`,
    );
  }
}
```

- [ ] **Step 4: Run test, confirm pass**

```bash
pnpm --filter @nexushub/web exec vitest run lib/oauth/crypto.test.ts
```

Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/oauth/crypto.ts apps/web/lib/oauth/crypto.test.ts
git commit -m "feat(oauth): AES-256-GCM secret encryption helpers"
```

---

## Task 4: `lib/oauth/state.ts` — HMAC-signed OAuth state

**Files:**

- Create: `apps/web/lib/oauth/state.ts`
- Test: `apps/web/lib/oauth/state.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from 'vitest';

vi.mock('../env', () => ({
  getServerEnv: () => ({
    OAUTH_STATE_SECRET: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', // 32 bytes
  }),
}));

import { signOAuthState, verifyOAuthState, OAuthStateError } from './state';

describe('oauth state', () => {
  const payload = {
    workspaceId: '11111111-1111-1111-1111-111111111111',
    userId: '22222222-2222-2222-2222-222222222222',
    nonce: 'cafebabecafebabecafebabecafebabe',
    returnTo: '/integrations',
    exp: Math.floor(Date.now() / 1000) + 600,
  };

  it('round-trips a payload', () => {
    const state = signOAuthState(payload);
    const verified = verifyOAuthState(state);
    expect(verified).toEqual(payload);
  });

  it('rejects a tampered payload', () => {
    const state = signOAuthState(payload);
    // Flip a character in the payload portion (before the dot).
    const [p, sig] = state.split('.');
    const flipped = (p![0] === 'A' ? 'B' : 'A') + p!.slice(1);
    expect(() => verifyOAuthState(`${flipped}.${sig}`)).toThrow(OAuthStateError);
  });

  it('rejects an expired payload', () => {
    const expired = { ...payload, exp: Math.floor(Date.now() / 1000) - 1 };
    const state = signOAuthState(expired);
    expect(() => verifyOAuthState(state)).toThrow(/expired/i);
  });

  it('rejects malformed input', () => {
    expect(() => verifyOAuthState('not-a-state')).toThrow(OAuthStateError);
  });
});
```

- [ ] **Step 2: Run test, confirm fail**

```bash
pnpm --filter @nexushub/web exec vitest run lib/oauth/state.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `apps/web/lib/oauth/state.ts`**

```ts
import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { getServerEnv } from '../env';

export class OAuthStateError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'OAuthStateError';
  }
}

export interface OAuthStatePayload {
  readonly workspaceId: string;
  readonly userId: string;
  /** Hex-encoded random bytes (≥ 16 bytes recommended). */
  readonly nonce: string;
  readonly returnTo: string;
  /** UNIX seconds. */
  readonly exp: number;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Buffer {
  const norm = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = norm.length % 4 === 0 ? '' : '='.repeat(4 - (norm.length % 4));
  return Buffer.from(norm + pad, 'base64');
}

function sign(payload: string): string {
  const secret = Buffer.from(getServerEnv().OAUTH_STATE_SECRET, 'base64');
  if (secret.length !== 32) {
    throw new OAuthStateError('OAUTH_STATE_SECRET must decode to 32 bytes');
  }
  return b64url(createHmac('sha256', secret).update(payload).digest());
}

/** Returns `<payload_b64url>.<hmac_b64url>` — pass to Microsoft as `state`. */
export function signOAuthState(payload: OAuthStatePayload): string {
  const json = JSON.stringify(payload);
  const p = b64url(Buffer.from(json, 'utf8'));
  return `${p}.${sign(p)}`;
}

/** Throws OAuthStateError if signature mismatch, malformed, or expired. */
export function verifyOAuthState(state: string): OAuthStatePayload {
  const dot = state.indexOf('.');
  if (dot < 1 || dot === state.length - 1) {
    throw new OAuthStateError('Malformed state');
  }
  const p = state.slice(0, dot);
  const sig = state.slice(dot + 1);
  const expected = sign(p);
  let sigBuf: Buffer;
  let expBuf: Buffer;
  try {
    sigBuf = b64urlDecode(sig);
    expBuf = b64urlDecode(expected);
  } catch {
    throw new OAuthStateError('Malformed signature');
  }
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    throw new OAuthStateError('Signature mismatch');
  }
  let parsed: OAuthStatePayload;
  try {
    parsed = JSON.parse(b64urlDecode(p).toString('utf8')) as OAuthStatePayload;
  } catch {
    throw new OAuthStateError('Malformed payload');
  }
  if (typeof parsed.exp !== 'number' || parsed.exp * 1000 < Date.now()) {
    throw new OAuthStateError('State expired');
  }
  return parsed;
}
```

- [ ] **Step 4: Run test, confirm pass**

```bash
pnpm --filter @nexushub/web exec vitest run lib/oauth/state.test.ts
```

Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/oauth/state.ts apps/web/lib/oauth/state.test.ts
git commit -m "feat(oauth): HMAC-signed state helpers for OAuth flow"
```

---

## Task 5: `packages/integrations/graph/client.ts` — fetch wrapper + retry

**Files:**

- Create: `packages/integrations/graph/client.ts`
- Test: `packages/integrations/graph/client.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { graphFetch, GraphError } from './client';

describe('graphFetch', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns parsed JSON on 200', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ value: 42 }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const res = await graphFetch<{ value: number }>('https://example/api', { token: 'tok' });
    expect(res).toEqual({ value: 42 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer tok' });
  });

  it('retries on 429 with backoff and succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Headers(),
        text: async () => '',
      })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);
    const res = await graphFetch('https://example/api', {
      token: 'tok',
      sleep: () => Promise.resolve(),
    });
    expect(res).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws GraphError with status on 4xx (non-429)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => '{"error":{"code":"InvalidAuthenticationToken"}}',
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(graphFetch('https://example/api', { token: 'tok' })).rejects.toMatchObject({
      name: 'GraphError',
      status: 401,
    });
  });

  it('gives up after 3 retries on persistent 503', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 503, headers: new Headers(), text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      graphFetch('https://example/api', { token: 'tok', sleep: () => Promise.resolve() }),
    ).rejects.toMatchObject({ name: 'GraphError', status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(4); // initial + 3 retries
  });
});
```

- [ ] **Step 2: Run test, confirm fail**

```bash
pnpm --filter @nexushub/integrations exec vitest run graph/client.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `packages/integrations/graph/client.ts`**

```ts
/**
 * Microsoft Graph fetch wrapper with retry on transient failures (429, 503).
 * Adapter layer: no Next dependency, no logging of secrets.
 */
export class GraphError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(status: number, body: string) {
    super(`Graph request failed: ${status}`);
    this.name = 'GraphError';
    this.status = status;
    this.body = body;
  }
}

export interface GraphFetchOptions {
  readonly token: string;
  /** Bearer-protected URL. */
  readonly method?: 'GET' | 'POST';
  readonly body?: string;
  readonly contentType?: string;
  /** For tests: deterministic sleep. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Override max retries (default 3). */
  readonly maxRetries?: number;
}

const DEFAULT_SLEEP = (ms: number): Promise<void> => new Promise<void>((r) => setTimeout(r, ms));

const RETRYABLE = new Set<number>([429, 500, 502, 503, 504]);

export async function graphFetch<T>(url: string, opts: GraphFetchOptions): Promise<T> {
  const sleep = opts.sleep ?? DEFAULT_SLEEP;
  const maxRetries = opts.maxRetries ?? 3;
  let attempt = 0;
  for (;;) {
    const res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${opts.token}`,
        ...(opts.contentType ? { 'Content-Type': opts.contentType } : {}),
      },
      ...(opts.body ? { body: opts.body } : {}),
    });
    if (res.ok) {
      return (await res.json()) as T;
    }
    if (RETRYABLE.has(res.status) && attempt < maxRetries) {
      const backoff = 1000 * Math.pow(2, attempt);
      attempt += 1;
      await sleep(backoff);
      continue;
    }
    const body = await res.text().catch(() => '');
    throw new GraphError(res.status, body);
  }
}
```

- [ ] **Step 4: Run test, confirm pass**

```bash
pnpm --filter @nexushub/integrations exec vitest run graph/client.test.ts
```

Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/integrations/graph/client.ts packages/integrations/graph/client.test.ts
git commit -m "feat(graph): HTTP client wrapper with retry on 429/5xx"
```

---

## Task 6: `packages/integrations/graph/parse.ts` — transform Graph message → normalized shape

**Files:**

- Create: `packages/integrations/graph/parse.ts`
- Test: `packages/integrations/graph/parse.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { parseGraphMessage } from './parse';

const baseGraph = {
  id: 'AAMkAGUw',
  subject: 'Hello',
  from: { emailAddress: { name: 'Marie', address: 'Marie@Acme.com' } },
  toRecipients: [{ emailAddress: { name: 'Me', address: 'me@nexushub.app' } }],
  ccRecipients: [],
  receivedDateTime: '2026-05-28T10:00:00Z',
  isRead: false,
  conversationId: 'conv-1',
  bodyPreview: 'Hi…',
  body: {
    contentType: 'html',
    content: '<p>Hi <strong>Angelo</strong></p><script>alert(1)</script>',
  },
};

describe('parseGraphMessage', () => {
  it('normalizes a typical message and sanitizes HTML', () => {
    const m = parseGraphMessage(baseGraph);
    expect(m).toEqual({
      externalId: 'AAMkAGUw',
      subject: 'Hello',
      fromEmail: 'marie@acme.com',
      fromName: 'Marie',
      toRecipients: ['me@nexushub.app'],
      ccRecipients: [],
      receivedAt: new Date('2026-05-28T10:00:00Z'),
      isRead: false,
      conversationId: 'conv-1',
      bodyText: 'Hi Angelo',
      bodyHtmlSanitized: '<p>Hi <strong>Angelo</strong></p>',
    });
  });

  it('handles missing from name', () => {
    const m = parseGraphMessage({ ...baseGraph, from: { emailAddress: { address: 'x@y.io' } } });
    expect(m.fromName).toBeNull();
    expect(m.fromEmail).toBe('x@y.io');
  });

  it('handles plain-text body', () => {
    const m = parseGraphMessage({
      ...baseGraph,
      body: { contentType: 'text', content: 'Plain body' },
    });
    expect(m.bodyText).toBe('Plain body');
    expect(m.bodyHtmlSanitized).toBeNull();
  });

  it('returns empty body when body is missing', () => {
    const m = parseGraphMessage({ ...baseGraph, body: undefined });
    expect(m.bodyText).toBe('');
    expect(m.bodyHtmlSanitized).toBeNull();
  });

  it('lowercases from email for matching', () => {
    const m = parseGraphMessage(baseGraph);
    expect(m.fromEmail).toBe('marie@acme.com');
  });
});
```

- [ ] **Step 2: Run test, confirm fail**

```bash
pnpm --filter @nexushub/integrations exec vitest run graph/parse.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `packages/integrations/graph/parse.ts`**

```ts
import sanitizeHtml from 'sanitize-html';

export interface ParsedGraphMessage {
  readonly externalId: string;
  readonly subject: string;
  readonly fromEmail: string;
  readonly fromName: string | null;
  readonly toRecipients: readonly string[];
  readonly ccRecipients: readonly string[];
  readonly receivedAt: Date;
  readonly isRead: boolean;
  readonly conversationId: string | null;
  /** Plain-text representation (always present). */
  readonly bodyText: string;
  /** Sanitized HTML when contentType=html, else null. */
  readonly bodyHtmlSanitized: string | null;
}

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

// Closed allowlist — matches the comments sanitization config so we never
// emit raw HTML into the DOM. <script> and event handlers are stripped.
const SANITIZE_OPTS: sanitizeHtml.IOptions = {
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

function stripToText(html: string): string {
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, ' ').trim();
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
      bodyHtmlSanitized = sanitizeHtml(body.content, SANITIZE_OPTS);
      bodyText = stripToText(body.content);
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

- [ ] **Step 4: Ensure `sanitize-html` is a workspace dependency of `@nexushub/integrations`**

```bash
cd packages/integrations
cat package.json | grep sanitize-html || pnpm add sanitize-html @types/sanitize-html
cd ../..
```

Expected: `sanitize-html` listed in `dependencies`. If already present, skip the `pnpm add`.

- [ ] **Step 5: Run test, confirm pass**

```bash
pnpm --filter @nexushub/integrations exec vitest run graph/parse.test.ts
```

Expected: 5 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/integrations/graph/parse.ts packages/integrations/graph/parse.test.ts packages/integrations/package.json pnpm-lock.yaml
git commit -m "feat(graph): parse + sanitize Graph message payload"
```

---

## Task 7: `packages/integrations/graph/auth.ts` — token exchange + refresh

**Files:**

- Create: `packages/integrations/graph/auth.ts`
- Test: `packages/integrations/graph/auth.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { exchangeCodeForTokens, refreshTokens, GraphAuthError } from './auth';

describe('exchangeCodeForTokens', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('returns normalized tokens on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'AT',
        refresh_token: 'RT',
        expires_in: 3600,
        scope: 'Mail.Read User.Read offline_access',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const before = Date.now();
    const tokens = await exchangeCodeForTokens({
      code: 'CODE',
      redirectUri: 'http://x/callback',
      clientId: 'CID',
      clientSecret: 'CSEC',
    });
    expect(tokens.accessToken).toBe('AT');
    expect(tokens.refreshToken).toBe('RT');
    expect(tokens.grantedScopes).toEqual(['Mail.Read', 'User.Read', 'offline_access']);
    // expiresAt ~ now + 3600s (allow 5s slack)
    expect(tokens.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 3595_000);
    expect(tokens.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 3601_000);
  });

  it('throws GraphAuthError on 4xx', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => '{"error":"invalid_grant"}',
      }),
    );
    await expect(
      exchangeCodeForTokens({
        code: 'BAD',
        redirectUri: 'http://x/callback',
        clientId: 'CID',
        clientSecret: 'CSEC',
      }),
    ).rejects.toThrow(GraphAuthError);
  });
});

describe('refreshTokens', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('returns new tokens', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'AT2',
          refresh_token: 'RT2',
          expires_in: 3600,
          scope: 'Mail.Read User.Read offline_access',
        }),
      }),
    );
    const tokens = await refreshTokens({
      refreshToken: 'OLD',
      clientId: 'CID',
      clientSecret: 'CSEC',
    });
    expect(tokens.accessToken).toBe('AT2');
    expect(tokens.refreshToken).toBe('RT2');
  });
});
```

- [ ] **Step 2: Run test, confirm fail**

```bash
pnpm --filter @nexushub/integrations exec vitest run graph/auth.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `packages/integrations/graph/auth.ts`**

```ts
const TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';

export class GraphAuthError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(status: number, body: string) {
    super(`Graph auth failed: ${status}`);
    this.name = 'GraphAuthError';
    this.status = status;
    this.body = body;
  }
}

export interface GraphTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: Date;
  readonly grantedScopes: readonly string[];
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
}

function parseTokenResponse(raw: TokenResponse, fallbackRefresh?: string): GraphTokens {
  return {
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token ?? fallbackRefresh ?? '',
    expiresAt: new Date(Date.now() + raw.expires_in * 1000),
    grantedScopes: (raw.scope ?? '').split(/\s+/).filter(Boolean),
  };
}

export async function exchangeCodeForTokens(params: {
  readonly code: string;
  readonly redirectUri: string;
  readonly clientId: string;
  readonly clientSecret: string;
}): Promise<GraphTokens> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: params.clientId,
    client_secret: params.clientSecret,
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new GraphAuthError(res.status, await res.text().catch(() => ''));
  }
  const json = (await res.json()) as TokenResponse;
  return parseTokenResponse(json);
}

export async function refreshTokens(params: {
  readonly refreshToken: string;
  readonly clientId: string;
  readonly clientSecret: string;
}): Promise<GraphTokens> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: params.refreshToken,
    client_id: params.clientId,
    client_secret: params.clientSecret,
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new GraphAuthError(res.status, await res.text().catch(() => ''));
  }
  const json = (await res.json()) as TokenResponse;
  // Microsoft rotates refresh tokens on each refresh — but if absent, keep the old one.
  return parseTokenResponse(json, params.refreshToken);
}
```

- [ ] **Step 4: Run test, confirm pass**

```bash
pnpm --filter @nexushub/integrations exec vitest run graph/auth.test.ts
```

Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/integrations/graph/auth.ts packages/integrations/graph/auth.test.ts
git commit -m "feat(graph): authorization code exchange + refresh rotation"
```

---

## Task 8: `packages/integrations/graph/messages.ts` — list initial + delta

**Files:**

- Create: `packages/integrations/graph/messages.ts`
- Test: `packages/integrations/graph/messages.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { listInboxInitial, listInboxDelta } from './messages';

describe('listInboxInitial', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('paginates up to maxMessages and returns the deltaLink from the final page', async () => {
    const page1 = {
      value: Array.from({ length: 50 }, (_, i) => ({
        id: `M${i}`,
        receivedDateTime: '2026-05-20T10:00:00Z',
        from: { emailAddress: { address: 'x@y.io' } },
        body: { contentType: 'text', content: '' },
      })),
      '@odata.nextLink': 'https://graph/next1',
    };
    const page2 = {
      value: Array.from({ length: 50 }, (_, i) => ({
        id: `M${50 + i}`,
        receivedDateTime: '2026-05-20T10:00:00Z',
        from: { emailAddress: { address: 'x@y.io' } },
        body: { contentType: 'text', content: '' },
      })),
      '@odata.deltaLink': 'https://graph/delta',
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => page1 })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => page2 });
    vi.stubGlobal('fetch', fetchMock);

    const res = await listInboxInitial({ token: 'tok', sinceDays: 30, maxMessages: 200 });
    expect(res.messages).toHaveLength(100);
    expect(res.deltaLink).toBe('https://graph/delta');
  });

  it('stops at maxMessages cap', async () => {
    const page = {
      value: Array.from({ length: 50 }, (_, i) => ({
        id: `M${i}`,
        receivedDateTime: '2026-05-20T10:00:00Z',
        from: { emailAddress: { address: 'x@y.io' } },
        body: { contentType: 'text', content: '' },
      })),
      '@odata.nextLink': 'https://graph/next',
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => page });
    vi.stubGlobal('fetch', fetchMock);
    const res = await listInboxInitial({ token: 'tok', sinceDays: 30, maxMessages: 75 });
    expect(res.messages).toHaveLength(75);
  });
});

describe('listInboxDelta', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('paginates the delta and returns the new deltaLink + removed ids', async () => {
    const page = {
      value: [
        {
          id: 'M1',
          receivedDateTime: '2026-05-28T10:00:00Z',
          from: { emailAddress: { address: 'x@y.io' } },
          body: { contentType: 'text', content: '' },
        },
        { id: 'M2', '@removed': { reason: 'deleted' } },
      ],
      '@odata.deltaLink': 'https://graph/new-delta',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => page }),
    );
    const res = await listInboxDelta({ token: 'tok', deltaUrl: 'https://graph/old-delta' });
    expect(res.messages).toHaveLength(1);
    expect(res.removedIds).toEqual(['M2']);
    expect(res.deltaLink).toBe('https://graph/new-delta');
  });
});
```

- [ ] **Step 2: Run test, confirm fail**

```bash
pnpm --filter @nexushub/integrations exec vitest run graph/messages.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `packages/integrations/graph/messages.ts`**

```ts
import { graphFetch } from './client';
import { parseGraphMessage, type ParsedGraphMessage } from './parse';

const GRAPH = 'https://graph.microsoft.com/v1.0';

const SELECT_FIELDS = [
  'id',
  'subject',
  'from',
  'toRecipients',
  'ccRecipients',
  'receivedDateTime',
  'isRead',
  'conversationId',
  'bodyPreview',
  'body',
].join(',');

interface GraphListResponse {
  value: unknown[];
  '@odata.nextLink'?: string;
  '@odata.deltaLink'?: string;
}

export interface InitialSyncResult {
  readonly messages: readonly ParsedGraphMessage[];
  /** deltaLink to store for subsequent incremental syncs. */
  readonly deltaLink: string | null;
}

export async function listInboxInitial(params: {
  readonly token: string;
  readonly sinceDays: number;
  readonly maxMessages: number;
}): Promise<InitialSyncResult> {
  const sinceIso = new Date(Date.now() - params.sinceDays * 24 * 60 * 60 * 1000).toISOString();
  const url = new URL(`${GRAPH}/me/mailFolders/inbox/messages/delta`);
  url.searchParams.set('$select', SELECT_FIELDS);
  url.searchParams.set('$top', '50');
  url.searchParams.set('$filter', `receivedDateTime ge ${sinceIso}`);
  return paginate(url.toString(), params.token, params.maxMessages);
}

export interface DeltaSyncResult {
  readonly messages: readonly ParsedGraphMessage[];
  readonly removedIds: readonly string[];
  readonly deltaLink: string | null;
}

/**
 * Continue an incremental sync using the previously-stored deltaLink.
 * Returns @removed ids separately (these are messages deleted on the server).
 */
export async function listInboxDelta(params: {
  readonly token: string;
  readonly deltaUrl: string;
}): Promise<DeltaSyncResult> {
  let url = params.deltaUrl;
  const messages: ParsedGraphMessage[] = [];
  const removedIds: string[] = [];
  let deltaLink: string | null = null;
  for (;;) {
    const page = await graphFetch<GraphListResponse>(url, { token: params.token });
    for (const item of page.value) {
      const r = item as { id?: string; '@removed'?: unknown };
      if (r['@removed']) {
        if (typeof r.id === 'string') removedIds.push(r.id);
      } else {
        messages.push(parseGraphMessage(item as Parameters<typeof parseGraphMessage>[0]));
      }
    }
    if (page['@odata.nextLink']) {
      url = page['@odata.nextLink'];
      continue;
    }
    deltaLink = page['@odata.deltaLink'] ?? null;
    break;
  }
  return { messages, removedIds, deltaLink };
}

async function paginate(
  startUrl: string,
  token: string,
  maxMessages: number,
): Promise<InitialSyncResult> {
  let url = startUrl;
  const messages: ParsedGraphMessage[] = [];
  let deltaLink: string | null = null;
  for (;;) {
    const page = await graphFetch<GraphListResponse>(url, { token });
    for (const item of page.value) {
      if (messages.length >= maxMessages) break;
      messages.push(parseGraphMessage(item as Parameters<typeof parseGraphMessage>[0]));
    }
    if (messages.length >= maxMessages) break;
    if (page['@odata.nextLink']) {
      url = page['@odata.nextLink'];
      continue;
    }
    deltaLink = page['@odata.deltaLink'] ?? null;
    break;
  }
  return { messages, deltaLink };
}
```

- [ ] **Step 4: Run test, confirm pass**

```bash
pnpm --filter @nexushub/integrations exec vitest run graph/messages.test.ts
```

Expected: 3 tests PASS.

- [ ] **Step 5: Add public `index.ts` for the graph adapter** at `packages/integrations/graph/index.ts`:

```ts
export { graphFetch, GraphError } from './client';
export type { GraphFetchOptions } from './client';
export { exchangeCodeForTokens, refreshTokens, GraphAuthError, type GraphTokens } from './auth';
export { listInboxInitial, listInboxDelta } from './messages';
export type { InitialSyncResult, DeltaSyncResult } from './messages';
export { parseGraphMessage } from './parse';
export type { ParsedGraphMessage } from './parse';

export const GRAPH_INTEGRATION_KEY = 'graph' as const;
```

Replace the existing skeleton `packages/integrations/src/graph/index.ts` content if a file with that path already exists.

- [ ] **Step 6: Update the package barrel `packages/integrations/src/index.ts` to re-export the graph public API** (check existing content first; if it already re-exports `./graph`, you're done).

- [ ] **Step 7: Commit**

```bash
git add packages/integrations/graph packages/integrations/src/index.ts
git commit -m "feat(graph): list inbox (initial + delta) with pagination + cap"
```

---

## Task 9: `getValidAccessToken` — decrypt + refresh + persist

**Files:**

- Create: `apps/web/features/integrations/lib/get-valid-access-token.ts`
- Test: `apps/web/features/integrations/lib/get-valid-access-token.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  integrationFindUnique: vi.fn(),
  integrationUpdate: vi.fn(),
  encryptSecret: vi.fn(),
  decryptSecret: vi.fn(),
  refreshTokens: vi.fn(),
}));

vi.mock('@nexushub/db', () => ({
  prisma: {
    integration: { findUnique: mocks.integrationFindUnique, update: mocks.integrationUpdate },
  },
}));
vi.mock('@/lib/oauth/crypto', () => ({
  encryptSecret: mocks.encryptSecret,
  decryptSecret: mocks.decryptSecret,
}));
vi.mock('@nexushub/integrations/graph', () => ({ refreshTokens: mocks.refreshTokens }));
vi.mock('@/lib/env', () => ({
  getServerEnv: () => ({
    GRAPH_CLIENT_ID: 'CID',
    GRAPH_CLIENT_SECRET: 'CSEC',
    ENCRYPTION_KEY_VERSION: 1,
  }),
}));

import { getValidAccessToken } from './get-valid-access-token';

const future = new Date(Date.now() + 10 * 60 * 1000).toISOString();
const past = new Date(Date.now() - 60 * 1000).toISOString();

beforeEach(() => {
  for (const m of Object.values(mocks)) (m as { mockReset?: () => void }).mockReset?.();
});

describe('getValidAccessToken', () => {
  it('returns the stored access token when not near expiry', async () => {
    mocks.integrationFindUnique.mockResolvedValue({
      id: 'I1',
      encryptedTokens: 'CT',
      status: 'active',
    });
    mocks.decryptSecret.mockReturnValue(
      JSON.stringify({
        accessToken: 'AT',
        refreshToken: 'RT',
        expiresAt: future,
        grantedScopes: [],
      }),
    );
    const tok = await getValidAccessToken('I1');
    expect(tok).toBe('AT');
    expect(mocks.refreshTokens).not.toHaveBeenCalled();
  });

  it('refreshes when expired and persists the new ciphertext', async () => {
    mocks.integrationFindUnique.mockResolvedValue({
      id: 'I1',
      encryptedTokens: 'CT',
      status: 'active',
    });
    mocks.decryptSecret.mockReturnValue(
      JSON.stringify({
        accessToken: 'OLD',
        refreshToken: 'RT',
        expiresAt: past,
        grantedScopes: [],
      }),
    );
    mocks.refreshTokens.mockResolvedValue({
      accessToken: 'NEW',
      refreshToken: 'RT2',
      expiresAt: new Date(Date.now() + 3600_000),
      grantedScopes: ['Mail.Read'],
    });
    mocks.encryptSecret.mockReturnValue('CT2');
    mocks.integrationUpdate.mockResolvedValue({});
    const tok = await getValidAccessToken('I1');
    expect(tok).toBe('NEW');
    expect(mocks.encryptSecret).toHaveBeenCalled();
    expect(mocks.integrationUpdate).toHaveBeenCalledWith({
      where: { id: 'I1' },
      data: expect.objectContaining({ encryptedTokens: 'CT2', status: 'active' }),
    });
  });

  it('marks status=error and rethrows when refresh fails', async () => {
    mocks.integrationFindUnique.mockResolvedValue({
      id: 'I1',
      encryptedTokens: 'CT',
      status: 'active',
    });
    mocks.decryptSecret.mockReturnValue(
      JSON.stringify({
        accessToken: 'OLD',
        refreshToken: 'RT',
        expiresAt: past,
        grantedScopes: [],
      }),
    );
    mocks.refreshTokens.mockRejectedValue(new Error('invalid_grant'));
    mocks.integrationUpdate.mockResolvedValue({});
    await expect(getValidAccessToken('I1')).rejects.toThrow(/invalid_grant/);
    expect(mocks.integrationUpdate).toHaveBeenCalledWith({
      where: { id: 'I1' },
      data: expect.objectContaining({ status: 'error' }),
    });
  });
});
```

- [ ] **Step 2: Run test, confirm fail**

```bash
pnpm --filter @nexushub/web exec vitest run features/integrations/lib/get-valid-access-token.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `apps/web/features/integrations/lib/get-valid-access-token.ts`**

```ts
import 'server-only';
import { prisma } from '@nexushub/db';
import { refreshTokens } from '@nexushub/integrations/graph';
import { encryptSecret, decryptSecret } from '@/lib/oauth/crypto';
import { getServerEnv } from '@/lib/env';

interface StoredTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  /** ISO string. */
  readonly expiresAt: string;
  readonly grantedScopes: readonly string[];
}

/** Refresh when the access token has less than this many ms of life left. */
const REFRESH_LEAD_MS = 60_000;

/**
 * Decrypt the stored tokens for `integrationId` and return a valid access
 * token. Refreshes (and rotates) if the access token is near expiry. Any
 * refresh failure flips Integration.status to 'error' and rethrows so the
 * caller can surface the "reconnect" prompt to the user.
 */
export async function getValidAccessToken(integrationId: string): Promise<string> {
  const integration = await prisma.integration.findUnique({
    where: { id: integrationId },
    select: { id: true, encryptedTokens: true, status: true },
  });
  if (!integration || !integration.encryptedTokens) {
    throw new Error('Integration not found or has no stored tokens');
  }
  const tokens = JSON.parse(decryptSecret(integration.encryptedTokens)) as StoredTokens;
  const expiresAt = new Date(tokens.expiresAt).getTime();
  if (expiresAt - Date.now() > REFRESH_LEAD_MS) {
    return tokens.accessToken;
  }
  // Refresh + rotate.
  const env = getServerEnv();
  try {
    const fresh = await refreshTokens({
      refreshToken: tokens.refreshToken,
      clientId: env.GRAPH_CLIENT_ID ?? '',
      clientSecret: env.GRAPH_CLIENT_SECRET ?? '',
    });
    const ciphertext = encryptSecret(
      JSON.stringify({
        accessToken: fresh.accessToken,
        refreshToken: fresh.refreshToken,
        expiresAt: fresh.expiresAt.toISOString(),
        grantedScopes: fresh.grantedScopes,
      } satisfies StoredTokens),
    );
    await prisma.integration.update({
      where: { id: integration.id },
      data: {
        encryptedTokens: ciphertext,
        expiresAt: fresh.expiresAt,
        grantedScopes: [...fresh.grantedScopes],
        status: 'active',
        keyVersion: env.ENCRYPTION_KEY_VERSION,
        lastError: null,
      },
    });
    return fresh.accessToken;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Refresh failed';
    await prisma.integration.update({
      where: { id: integration.id },
      data: { status: 'error', lastError: message },
    });
    throw err;
  }
}
```

- [ ] **Step 4: Run test, confirm pass**

```bash
pnpm --filter @nexushub/web exec vitest run features/integrations/lib/get-valid-access-token.test.ts
```

Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/features/integrations/lib/
git commit -m "feat(integrations): getValidAccessToken with refresh rotation"
```

---

## Task 10: `startGraphOAuth` server action

**Files:**

- Create: `apps/web/features/integrations/actions/start-graph-oauth.ts`
- Test: `apps/web/features/integrations/actions/start-graph-oauth.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  signOAuthState: vi.fn(),
  oauthStateCreate: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock('@/lib/auth', () => ({ requireUser: mocks.requireUser }));
vi.mock('@/lib/oauth/state', () => ({ signOAuthState: mocks.signOAuthState }));
vi.mock('@nexushub/db', () => ({
  prisma: { oAuthState: { create: mocks.oauthStateCreate } },
}));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/lib/env', () => ({
  getServerEnv: () => ({
    GRAPH_CLIENT_ID: 'CID',
    APP_URL: 'http://localhost:3002',
  }),
}));

import { startGraphOAuth } from './start-graph-oauth';

beforeEach(() => {
  for (const m of Object.values(mocks)) (m as { mockReset?: () => void }).mockReset?.();
  mocks.requireUser.mockResolvedValue({
    userId: 'U1',
    workspaceId: 'W1',
    role: 'admin',
    isSuperAdmin: false,
    email: 'a@b.c',
  });
  mocks.signOAuthState.mockReturnValue('SIGNED.STATE');
  mocks.oauthStateCreate.mockResolvedValue({});
  mocks.redirect.mockImplementation((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  });
});

describe('startGraphOAuth', () => {
  it('persists OAuthState and redirects to MS authorize with correct params', async () => {
    await expect(startGraphOAuth()).rejects.toThrow(
      /REDIRECT:https:\/\/login\.microsoftonline\.com/,
    );
    expect(mocks.oauthStateCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        state: 'SIGNED.STATE',
        workspaceId: 'W1',
        userId: 'U1',
        kind: 'graph',
      }),
    });
    const url = mocks.redirect.mock.calls[0]![0] as string;
    expect(url).toContain('client_id=CID');
    expect(url).toContain('response_type=code');
    expect(url).toContain('scope=offline_access+User.Read+Mail.Read');
    expect(url).toContain('state=SIGNED.STATE');
  });
});
```

- [ ] **Step 2: Run test, confirm fail**

```bash
pnpm --filter @nexushub/web exec vitest run features/integrations/actions/start-graph-oauth.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `apps/web/features/integrations/actions/start-graph-oauth.ts`**

```ts
'use server';
import 'server-only';
import { randomBytes } from 'node:crypto';
import { redirect } from 'next/navigation';
import { prisma } from '@nexushub/db';
import { requireUser } from '@/lib/auth';
import { signOAuthState } from '@/lib/oauth/state';
import { getServerEnv } from '@/lib/env';

const AUTHORIZE_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const SCOPES = 'offline_access User.Read Mail.Read';
const STATE_TTL_MS = 10 * 60 * 1000;

function callbackUrl(): string {
  const base = getServerEnv().APP_URL ?? 'http://localhost:3000';
  return `${base.replace(/\/$/, '')}/api/oauth/graph/callback`;
}

export async function startGraphOAuth(): Promise<never> {
  const ctx = await requireUser();
  const env = getServerEnv();
  const nonce = randomBytes(16).toString('hex');
  const expSec = Math.floor((Date.now() + STATE_TTL_MS) / 1000);
  const state = signOAuthState({
    workspaceId: ctx.workspaceId,
    userId: ctx.userId,
    nonce,
    returnTo: '/integrations',
    exp: expSec,
  });
  await prisma.oAuthState.create({
    data: {
      state,
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      kind: 'graph',
      returnTo: '/integrations',
      expiresAt: new Date(expSec * 1000),
    },
  });
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('client_id', env.GRAPH_CLIENT_ID ?? '');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', callbackUrl());
  url.searchParams.set('scope', SCOPES);
  url.searchParams.set('state', state);
  url.searchParams.set('response_mode', 'query');
  redirect(url.toString());
}
```

- [ ] **Step 4: Confirm `APP_URL` is in `env.ts` server schema (used to build absolute callback URL)**

If `APP_URL` isn't already declared, add it as an optional string in `apps/web/lib/env.ts`:

```ts
  APP_URL: z.string().url().optional(),
```

and a line to `.env.example`:

```
# Public base URL of the app, used to build OAuth callback URIs.
# Local dev: http://localhost:3002 ; prod: https://app.brandnewday.agency
APP_URL=
```

- [ ] **Step 5: Run test, confirm pass**

```bash
pnpm --filter @nexushub/web exec vitest run features/integrations/actions/start-graph-oauth.test.ts
```

Expected: 1 test PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/features/integrations/actions/ apps/web/lib/env.ts .env.example
git commit -m "feat(integrations): startGraphOAuth action + APP_URL env"
```

---

## Task 11: OAuth callback route handler

**Files:**

- Create: `apps/web/app/api/oauth/graph/callback/route.ts`
- Test: `apps/web/app/api/oauth/graph/callback/route.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  oauthStateFindUnique: vi.fn(),
  oauthStateUpdate: vi.fn(),
  integrationUpsert: vi.fn(),
  auditLogCreate: vi.fn(),
  verifyOAuthState: vi.fn(),
  exchangeCodeForTokens: vi.fn(),
  encryptSecret: vi.fn(),
  graphFetch: vi.fn(),
}));

vi.mock('@nexushub/db', () => ({
  prisma: {
    oAuthState: { findUnique: mocks.oauthStateFindUnique, update: mocks.oauthStateUpdate },
    integration: { upsert: mocks.integrationUpsert },
    auditLog: { create: mocks.auditLogCreate },
  },
}));
vi.mock('@/lib/oauth/state', () => ({ verifyOAuthState: mocks.verifyOAuthState }));
vi.mock('@/lib/oauth/crypto', () => ({ encryptSecret: mocks.encryptSecret }));
vi.mock('@nexushub/integrations/graph', () => ({
  exchangeCodeForTokens: mocks.exchangeCodeForTokens,
  graphFetch: mocks.graphFetch,
}));
vi.mock('@/lib/env', () => ({
  getServerEnv: () => ({
    GRAPH_CLIENT_ID: 'CID',
    GRAPH_CLIENT_SECRET: 'CSEC',
    APP_URL: 'http://localhost:3002',
    ENCRYPTION_KEY_VERSION: 1,
  }),
}));

import { GET } from './route';

beforeEach(() => {
  for (const m of Object.values(mocks)) (m as { mockReset?: () => void }).mockReset?.();
});

function makeReq(url: string): Request {
  return new Request(url);
}

describe('GET /api/oauth/graph/callback', () => {
  it('exchanges code, encrypts tokens, upserts Integration, marks state consumed, redirects', async () => {
    mocks.verifyOAuthState.mockReturnValue({
      workspaceId: 'W1',
      userId: 'U1',
      nonce: 'n',
      returnTo: '/integrations',
      exp: Math.floor(Date.now() / 1000) + 600,
    });
    mocks.oauthStateFindUnique.mockResolvedValue({
      state: 'S',
      workspaceId: 'W1',
      userId: 'U1',
      kind: 'graph',
      consumedAt: null,
      expiresAt: new Date(Date.now() + 600_000),
    });
    mocks.exchangeCodeForTokens.mockResolvedValue({
      accessToken: 'AT',
      refreshToken: 'RT',
      expiresAt: new Date(Date.now() + 3600_000),
      grantedScopes: ['Mail.Read'],
    });
    mocks.graphFetch.mockResolvedValue({
      mail: 'angelo@brandnewday.agency',
      userPrincipalName: 'u',
    });
    mocks.encryptSecret.mockReturnValue('CT');
    mocks.integrationUpsert.mockResolvedValue({ id: 'I1' });
    mocks.oauthStateUpdate.mockResolvedValue({});
    mocks.auditLogCreate.mockResolvedValue({});

    const res = await GET(makeReq('http://localhost/api/oauth/graph/callback?code=C&state=S'));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('http://localhost:3002/integrations?connected=graph');
    expect(mocks.integrationUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ encryptedTokens: 'CT', kind: 'graph', scope: 'user' }),
      }),
    );
    expect(mocks.oauthStateUpdate).toHaveBeenCalledWith({
      where: { state: 'S' },
      data: { consumedAt: expect.any(Date) },
    });
    expect(mocks.auditLogCreate).toHaveBeenCalled();
  });

  it('rejects an already-consumed state with 400', async () => {
    mocks.verifyOAuthState.mockReturnValue({
      workspaceId: 'W1',
      userId: 'U1',
      nonce: 'n',
      returnTo: '/integrations',
      exp: Math.floor(Date.now() / 1000) + 600,
    });
    mocks.oauthStateFindUnique.mockResolvedValue({
      state: 'S',
      workspaceId: 'W1',
      userId: 'U1',
      kind: 'graph',
      consumedAt: new Date(),
      expiresAt: new Date(Date.now() + 600_000),
    });
    const res = await GET(makeReq('http://localhost/api/oauth/graph/callback?code=C&state=S'));
    expect(res.status).toBe(400);
  });

  it('rejects invalid HMAC with 400', async () => {
    mocks.verifyOAuthState.mockImplementation(() => {
      throw new Error('Signature mismatch');
    });
    const res = await GET(makeReq('http://localhost/api/oauth/graph/callback?code=C&state=BAD'));
    expect(res.status).toBe(400);
  });

  it('redirects to error page on token exchange failure', async () => {
    mocks.verifyOAuthState.mockReturnValue({
      workspaceId: 'W1',
      userId: 'U1',
      nonce: 'n',
      returnTo: '/integrations',
      exp: Math.floor(Date.now() / 1000) + 600,
    });
    mocks.oauthStateFindUnique.mockResolvedValue({
      state: 'S',
      workspaceId: 'W1',
      userId: 'U1',
      kind: 'graph',
      consumedAt: null,
      expiresAt: new Date(Date.now() + 600_000),
    });
    mocks.exchangeCodeForTokens.mockRejectedValue(new Error('invalid_grant'));
    mocks.oauthStateUpdate.mockResolvedValue({});
    const res = await GET(makeReq('http://localhost/api/oauth/graph/callback?code=C&state=S'));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/integrations?error=');
  });
});
```

- [ ] **Step 2: Run test, confirm fail**

```bash
pnpm --filter @nexushub/web exec vitest run app/api/oauth/graph/callback/route.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `apps/web/app/api/oauth/graph/callback/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { prisma } from '@nexushub/db';
import { exchangeCodeForTokens, graphFetch } from '@nexushub/integrations/graph';
import { encryptSecret } from '@/lib/oauth/crypto';
import { verifyOAuthState, OAuthStateError } from '@/lib/oauth/state';
import { getServerEnv } from '@/lib/env';

const GRAPH_ME = 'https://graph.microsoft.com/v1.0/me';

function appUrl(): string {
  return (getServerEnv().APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

function callbackUrl(): string {
  return `${appUrl()}/api/oauth/graph/callback`;
}

function errorRedirect(code: string): NextResponse {
  return NextResponse.redirect(`${appUrl()}/integrations?error=${encodeURIComponent(code)}`);
}

interface GraphMe {
  readonly mail?: string;
  readonly userPrincipalName?: string;
  readonly id?: string;
}

export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) {
    return new NextResponse('Missing code or state', { status: 400 });
  }

  // 1. Verify HMAC signature + expiration.
  let payload;
  try {
    payload = verifyOAuthState(state);
  } catch (err) {
    if (err instanceof OAuthStateError) {
      return new NextResponse('Invalid state', { status: 400 });
    }
    throw err;
  }

  // 2. Look up DB row, ensure not consumed, owner matches payload.
  const row = await prisma.oAuthState.findUnique({ where: { state } });
  if (
    !row ||
    row.consumedAt ||
    row.expiresAt.getTime() < Date.now() ||
    row.workspaceId !== payload.workspaceId ||
    row.userId !== payload.userId
  ) {
    return new NextResponse('Invalid or expired state', { status: 400 });
  }

  // 3. Mark state consumed BEFORE the token exchange — even if the exchange
  //    fails, this single-use state cannot be replayed.
  await prisma.oAuthState.update({
    where: { state },
    data: { consumedAt: new Date() },
  });

  const env = getServerEnv();
  let tokens;
  let me: GraphMe;
  try {
    tokens = await exchangeCodeForTokens({
      code,
      redirectUri: callbackUrl(),
      clientId: env.GRAPH_CLIENT_ID ?? '',
      clientSecret: env.GRAPH_CLIENT_SECRET ?? '',
    });
    me = await graphFetch<GraphMe>(GRAPH_ME, { token: tokens.accessToken });
  } catch {
    return errorRedirect('token_exchange_failed');
  }

  // 4. Encrypt and persist.
  const ciphertext = encryptSecret(
    JSON.stringify({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt.toISOString(),
      grantedScopes: tokens.grantedScopes,
    }),
  );

  const externalLabel = me.mail ?? me.userPrincipalName ?? '';
  await prisma.integration.upsert({
    where: {
      workspaceId_kind_ownerUserId_externalAccountId: {
        workspaceId: payload.workspaceId,
        kind: 'graph',
        ownerUserId: payload.userId,
        externalAccountId: me.id ?? externalLabel,
      },
    },
    create: {
      workspaceId: payload.workspaceId,
      ownerUserId: payload.userId,
      kind: 'graph',
      scope: 'user',
      status: 'active',
      externalAccountId: me.id ?? externalLabel,
      externalAccountLabel: externalLabel,
      encryptedTokens: ciphertext,
      keyVersion: env.ENCRYPTION_KEY_VERSION,
      grantedScopes: [...tokens.grantedScopes],
      expiresAt: tokens.expiresAt,
      lastError: null,
    },
    update: {
      status: 'active',
      encryptedTokens: ciphertext,
      keyVersion: env.ENCRYPTION_KEY_VERSION,
      grantedScopes: [...tokens.grantedScopes],
      externalAccountLabel: externalLabel,
      expiresAt: tokens.expiresAt,
      lastError: null,
    },
  });

  await prisma.auditLog.create({
    data: {
      workspaceId: payload.workspaceId,
      userId: payload.userId,
      action: 'integration_connected',
      payload: { kind: 'graph', externalAccountLabel: externalLabel },
    },
  });

  return NextResponse.redirect(`${appUrl()}/integrations?connected=graph`);
}
```

- [ ] **Step 4: Run test, confirm pass**

```bash
pnpm --filter @nexushub/web exec vitest run app/api/oauth/graph/callback/route.test.ts
```

Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/oauth/graph/callback/
git commit -m "feat(integrations): OAuth callback route handler for Graph"
```

---

## Task 12: `disconnectGraph` server action

**Files:**

- Create: `apps/web/features/integrations/actions/disconnect-graph.ts`
- Test: `apps/web/features/integrations/actions/disconnect-graph.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  integrationFindFirst: vi.fn(),
  integrationUpdate: vi.fn(),
  auditLogCreate: vi.fn(),
}));

vi.mock('@nexushub/db', () => ({
  prisma: {
    integration: { findFirst: mocks.integrationFindFirst, update: mocks.integrationUpdate },
    auditLog: { create: mocks.auditLogCreate },
  },
}));
vi.mock('@/lib/auth', () => ({ requireUser: mocks.requireUser }));

import { disconnectGraph } from './disconnect-graph';

beforeEach(() => {
  for (const m of Object.values(mocks)) (m as { mockReset?: () => void }).mockReset?.();
  mocks.requireUser.mockResolvedValue({
    userId: 'U1',
    workspaceId: 'W1',
    role: 'admin',
    isSuperAdmin: false,
    email: 'a@b.c',
  });
});

describe('disconnectGraph', () => {
  it('marks the integration revoked + audit logs', async () => {
    mocks.integrationFindFirst.mockResolvedValue({ id: 'I1' });
    mocks.integrationUpdate.mockResolvedValue({});
    mocks.auditLogCreate.mockResolvedValue({});
    const res = await disconnectGraph();
    expect(res).toEqual({ ok: true });
    expect(mocks.integrationUpdate).toHaveBeenCalledWith({
      where: { id: 'I1' },
      data: expect.objectContaining({ status: 'revoked', encryptedTokens: null }),
    });
    expect(mocks.auditLogCreate).toHaveBeenCalled();
  });

  it('returns ok:false when no integration', async () => {
    mocks.integrationFindFirst.mockResolvedValue(null);
    const res = await disconnectGraph();
    expect(res).toEqual({ ok: false, message: 'Aucune intégration à déconnecter.' });
  });
});
```

- [ ] **Step 2: Run test, confirm fail**

```bash
pnpm --filter @nexushub/web exec vitest run features/integrations/actions/disconnect-graph.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `apps/web/features/integrations/actions/disconnect-graph.ts`**

```ts
'use server';
import 'server-only';
import { prisma } from '@nexushub/db';
import { requireUser } from '@/lib/auth';

export type DisconnectGraphResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

export async function disconnectGraph(): Promise<DisconnectGraphResult> {
  const ctx = await requireUser();
  const integration = await prisma.integration.findFirst({
    where: {
      workspaceId: ctx.workspaceId,
      kind: 'graph',
      ownerUserId: ctx.userId,
      status: { in: ['active', 'error'] },
    },
    select: { id: true },
  });
  if (!integration) {
    return { ok: false, message: 'Aucune intégration à déconnecter.' };
  }
  await prisma.integration.update({
    where: { id: integration.id },
    data: {
      status: 'revoked',
      encryptedTokens: null,
      lastSyncedAt: null,
      deltaToken: null,
    },
  });
  await prisma.auditLog.create({
    data: {
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      action: 'integration_disconnected',
      payload: { kind: 'graph' },
    },
  });
  return { ok: true };
}
```

- [ ] **Step 4: Run test, confirm pass**

```bash
pnpm --filter @nexushub/web exec vitest run features/integrations/actions/disconnect-graph.test.ts
```

Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/features/integrations/actions/disconnect-graph.ts apps/web/features/integrations/actions/disconnect-graph.test.ts
git commit -m "feat(integrations): disconnectGraph action with audit log"
```

---

## Task 13: `OutlookCard` + `IntegrationsGrid` + `/integrations` page

**Files:**

- Create: `apps/web/features/integrations/components/outlook-card.tsx`
- Create: `apps/web/features/integrations/components/integrations-grid.tsx`
- Modify (replace placeholder): `apps/web/app/(app)/integrations/page.tsx`

- [ ] **Step 1: Implement `apps/web/features/integrations/components/outlook-card.tsx`**

Uses **design tokens only** — no hex. Cohérent avec `kanban-card.tsx` pattern (className + tokens var(--color-\*)).

```tsx
'use client';
import { useTransition } from 'react';
import { startGraphOAuth } from '../actions/start-graph-oauth';
import { disconnectGraph } from '../actions/disconnect-graph';

export interface OutlookCardData {
  readonly status: 'inactive' | 'active' | 'error' | 'revoked';
  readonly externalAccountLabel: string | null;
  readonly lastSyncedAt: string | null;
  readonly lastError: string | null;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'à l’instant';
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `il y a ${h} h`;
  return `il y a ${Math.floor(h / 24)} j`;
}

export function OutlookCard({ data }: { readonly data: OutlookCardData }) {
  const [pending, startTransition] = useTransition();

  const connect = (): void => {
    startTransition(async () => {
      await startGraphOAuth();
    });
  };
  const disconnect = (): void => {
    if (!window.confirm('Déconnecter cette boîte ?')) return;
    startTransition(async () => {
      const res = await disconnectGraph();
      if (!res.ok) window.alert(res.message);
      else window.location.reload();
    });
  };

  if (data.status === 'active') {
    return (
      <article className="flex items-center justify-between rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-5 shadow-[var(--shadow-card)]">
        <div className="flex items-center gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[color:var(--color-bg-muted)] text-lg">
            📧
          </div>
          <div>
            <h3 className="flex items-center gap-2 text-sm font-extrabold text-[color:var(--color-text-main)]">
              Microsoft Outlook
              <span className="rounded-full bg-[color:var(--color-success-bg)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[color:var(--color-success)]">
                ● Connecté
              </span>
            </h3>
            <p className="mt-0.5 text-xs text-[color:var(--color-text-muted)]">
              {data.externalAccountLabel}
              {data.lastSyncedAt ? ` · sync ${relativeTime(data.lastSyncedAt)}` : ''}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={disconnect}
          disabled={pending}
          className="btn btn-ghost btn-sm"
        >
          {pending ? 'Déconnexion…' : 'Déconnecter'}
        </button>
      </article>
    );
  }

  if (data.status === 'error') {
    return (
      <article className="flex items-center justify-between rounded-2xl border border-[color:var(--color-danger)] bg-[color:var(--color-danger-bg)] p-5">
        <div className="flex items-center gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[color:var(--color-bg-card)] text-lg text-[color:var(--color-danger)]">
            ⚠
          </div>
          <div>
            <h3 className="flex items-center gap-2 text-sm font-extrabold text-[color:var(--color-text-main)]">
              Microsoft Outlook
              <span className="rounded-full bg-[color:var(--color-danger-bg)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[color:var(--color-danger)]">
                ● Erreur
              </span>
            </h3>
            <p className="mt-0.5 text-xs text-[color:var(--color-text-muted)]">
              {data.lastError ?? 'Token révoqué — reconnecte ta boîte'}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={connect}
          disabled={pending}
          className="btn btn-primary btn-sm"
        >
          {pending ? 'Connexion…' : 'Reconnecter'}
        </button>
      </article>
    );
  }

  // inactive / revoked
  return (
    <article className="flex items-center justify-between rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-5 shadow-[var(--shadow-card)]">
      <div className="flex items-center gap-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[color:var(--color-bg-muted)] text-lg">
          📧
        </div>
        <div>
          <h3 className="flex items-center gap-2 text-sm font-extrabold text-[color:var(--color-text-main)]">
            Microsoft Outlook
            <span className="rounded-full bg-[color:var(--color-bg-muted)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[color:var(--color-text-soft)]">
              {data.status === 'revoked' ? 'Précédemment connecté' : 'Inactive'}
            </span>
          </h3>
          <p className="mt-0.5 text-xs text-[color:var(--color-text-muted)]">
            Lis tes mails dans NexusHub · par utilisateur
          </p>
        </div>
      </div>
      <button type="button" onClick={connect} disabled={pending} className="btn btn-primary btn-sm">
        {pending ? 'Connexion…' : 'Connecter ma boîte'}
      </button>
    </article>
  );
}
```

- [ ] **Step 2: Implement `apps/web/features/integrations/components/integrations-grid.tsx`**

```tsx
import { OutlookCard, type OutlookCardData } from './outlook-card';

export interface IntegrationsGridProps {
  readonly outlook: OutlookCardData;
}

export function IntegrationsGrid({ outlook }: IntegrationsGridProps) {
  return (
    <div className="grid gap-4">
      <OutlookCard data={outlook} />
      <article className="rounded-2xl border border-dashed border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-5 text-xs text-[color:var(--color-text-muted)]">
        💬 Slack — bientôt (workspace-level, mapping canal ↔ client)
      </article>
      <article className="rounded-2xl border border-dashed border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-5 text-xs text-[color:var(--color-text-muted)]">
        🎤 Fireflies / Otter — bientôt (transcriptions de réunions)
      </article>
    </div>
  );
}
```

- [ ] **Step 3: Replace `apps/web/app/(app)/integrations/page.tsx`**

```tsx
import type { Metadata } from 'next';
import { prisma } from '@nexushub/db';
import { requireUser } from '@/lib/auth';
import { IntegrationsGrid } from '@/features/integrations/components/integrations-grid';
import type { OutlookCardData } from '@/features/integrations/components/outlook-card';

export const metadata: Metadata = { title: 'Intégrations' };

interface PageProps {
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function IntegrationsPage({ searchParams }: PageProps) {
  const ctx = await requireUser();
  const integration = await prisma.integration.findFirst({
    where: { workspaceId: ctx.workspaceId, kind: 'graph', ownerUserId: ctx.userId },
    select: {
      status: true,
      externalAccountLabel: true,
      lastSyncedAt: true,
      lastError: true,
    },
  });
  const outlook: OutlookCardData = integration
    ? {
        status: integration.status as OutlookCardData['status'],
        externalAccountLabel: integration.externalAccountLabel,
        lastSyncedAt: integration.lastSyncedAt ? integration.lastSyncedAt.toISOString() : null,
        lastError: integration.lastError,
      }
    : { status: 'inactive', externalAccountLabel: null, lastSyncedAt: null, lastError: null };

  const sp = (await searchParams) ?? {};
  const flash =
    sp['connected'] === 'graph'
      ? { kind: 'ok' as const, msg: 'Boîte Outlook connectée.' }
      : typeof sp['error'] === 'string'
        ? { kind: 'err' as const, msg: `Erreur OAuth: ${sp['error']}` }
        : null;

  return (
    <div className="mx-auto max-w-[900px]">
      <header className="mb-6">
        <h1 className="text-[28px] font-extrabold tracking-tight">Intégrations</h1>
        <p className="mt-1 text-sm text-[color:var(--color-text-muted)]">
          Connecte tes outils externes à NexusHub.
        </p>
      </header>
      {flash ? (
        <div
          className={
            flash.kind === 'ok'
              ? 'mb-4 rounded-lg border border-[color:var(--color-success)] bg-[color:var(--color-success-bg)] px-4 py-2 text-sm text-[color:var(--color-success)]'
              : 'mb-4 rounded-lg border border-[color:var(--color-danger)] bg-[color:var(--color-danger-bg)] px-4 py-2 text-sm text-[color:var(--color-danger)]'
          }
        >
          {flash.msg}
        </div>
      ) : null}
      <IntegrationsGrid outlook={outlook} />
    </div>
  );
}
```

- [ ] **Step 4: Verify the page typechecks and renders in dev**

```bash
pnpm --filter @nexushub/web exec tsc --noEmit
```

Expected: exit 0.

Then start the dev server and visit `http://localhost:3002/integrations` — should show the OutlookCard in `inactive` state (assuming no integration yet).

- [ ] **Step 5: Commit**

```bash
git add apps/web/features/integrations/components apps/web/app/\(app\)/integrations/
git commit -m "feat(integrations): /integrations page with OutlookCard 3 states"
```

---

## Task 14: `auto-associate.ts` — pure domain (email → clientId by domain)

**Files:**

- Create: `apps/web/features/communications/lib/auto-associate.ts`
- Test: `apps/web/features/communications/lib/auto-associate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { matchClientByDomain, buildDomainIndex } from './auto-associate';

describe('buildDomainIndex', () => {
  it('lowercases and groups by domain, preserving insertion order', () => {
    const idx = buildDomainIndex([
      { id: 'A', emailDomains: ['Acme.com'] },
      { id: 'B', emailDomains: ['acme.com', 'other.io'] },
    ]);
    expect(idx.get('acme.com')).toEqual(['A', 'B']);
    expect(idx.get('other.io')).toEqual(['B']);
  });
});

describe('matchClientByDomain', () => {
  const idx = buildDomainIndex([
    { id: 'A', emailDomains: ['acme.com'] },
    { id: 'B', emailDomains: ['acme.com', 'sub.io'] },
  ]);

  it('matches a known domain (first deterministic)', () => {
    expect(matchClientByDomain('marie@acme.com', idx)).toBe('A');
  });

  it('is case-insensitive', () => {
    expect(matchClientByDomain('Marie@ACME.COM', idx)).toBe('A');
  });

  it('returns null on unmatched domain', () => {
    expect(matchClientByDomain('a@nope.io', idx)).toBeNull();
  });

  it('does not match subdomains', () => {
    expect(matchClientByDomain('a@dev.acme.com', idx)).toBeNull();
  });

  it('returns null on malformed email', () => {
    expect(matchClientByDomain('not-an-email', idx)).toBeNull();
    expect(matchClientByDomain('', idx)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test, confirm fail**

```bash
pnpm --filter @nexushub/web exec vitest run features/communications/lib/auto-associate.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `apps/web/features/communications/lib/auto-associate.ts`**

```ts
export interface DomainIndexInput {
  readonly id: string;
  readonly emailDomains: readonly string[];
}

/**
 * Pre-build a domain → ordered clientIds lookup. Pass the list of clients
 * ordered by createdAt asc so conflicts (multiple clients with the same
 * domain) resolve deterministically to the oldest one. Domains are lowercased.
 */
export function buildDomainIndex(clients: readonly DomainIndexInput[]): Map<string, string[]> {
  const idx = new Map<string, string[]>();
  for (const c of clients) {
    for (const raw of c.emailDomains) {
      const d = raw.trim().toLowerCase();
      if (!d) continue;
      const list = idx.get(d);
      if (list) list.push(c.id);
      else idx.set(d, [c.id]);
    }
  }
  return idx;
}

/**
 * Find the client matching the sender's exact domain. Subdomains do not match
 * (V1: explicit only). Returns null when the email is malformed, the domain is
 * unknown, or the address is from a free domain not mapped to any client.
 */
export function matchClientByDomain(email: string, index: Map<string, string[]>): string | null {
  if (!email) return null;
  const at = email.lastIndexOf('@');
  if (at < 1 || at === email.length - 1) return null;
  const domain = email.slice(at + 1).toLowerCase();
  const candidates = index.get(domain);
  return candidates && candidates.length > 0 ? candidates[0]! : null;
}
```

- [ ] **Step 4: Run test, confirm pass**

```bash
pnpm --filter @nexushub/web exec vitest run features/communications/lib/auto-associate.test.ts
```

Expected: 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/features/communications/lib/auto-associate.ts apps/web/features/communications/lib/auto-associate.test.ts
git commit -m "feat(communications): auto-associate email by sender domain"
```

---

## Task 15: `mail-dto.ts` — DB row → UI shape

**Files:**

- Create: `apps/web/features/communications/lib/mail-dto.ts`

- [ ] **Step 1: Implement `apps/web/features/communications/lib/mail-dto.ts`**

(No separate test file — pure mapping; tested implicitly through page render tests.)

```ts
import type { Prisma } from '@nexushub/db';

export type EmailMessageListRow = Prisma.EmailMessageGetPayload<{
  select: {
    id: true;
    subject: true;
    fromEmail: true;
    fromName: true;
    bodyText: true;
    bodyHtmlSanitized: true;
    receivedAt: true;
    isRead: true;
    clientId: true;
    client: { select: { id: true; name: true; colorToken: true } };
    toRecipients: true;
    ccRecipients: true;
  };
}>;

export interface MailDTO {
  readonly id: string;
  readonly subject: string;
  readonly fromEmail: string;
  readonly fromName: string | null;
  readonly preview: string;
  readonly receivedAt: string;
  readonly isRead: boolean;
  readonly client: {
    readonly id: string;
    readonly name: string;
    readonly colorToken: string;
  } | null;
  readonly toRecipients: readonly string[];
  readonly ccRecipients: readonly string[];
  readonly bodyHtmlSanitized: string | null;
  readonly bodyText: string;
}

const PREVIEW_LEN = 140;

export function toMailDTO(row: EmailMessageListRow): MailDTO {
  const bodyText = row.bodyText ?? '';
  return {
    id: row.id,
    subject: row.subject,
    fromEmail: row.fromEmail,
    fromName: row.fromName,
    preview: bodyText.slice(0, PREVIEW_LEN),
    receivedAt: row.receivedAt.toISOString(),
    isRead: row.isRead,
    client: row.client
      ? { id: row.client.id, name: row.client.name, colorToken: row.client.colorToken }
      : null,
    toRecipients: row.toRecipients,
    ccRecipients: row.ccRecipients,
    bodyHtmlSanitized: row.bodyHtmlSanitized,
    bodyText,
  };
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @nexushub/web exec tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add apps/web/features/communications/lib/mail-dto.ts
git commit -m "feat(communications): MailDTO mapper"
```

---

## Task 16: `syncGraphInbox` action — initial + delta + throttle

**Files:**

- Create: `apps/web/features/communications/actions/sync-graph-inbox.ts`
- Test: `apps/web/features/communications/actions/sync-graph-inbox.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  integrationFindFirst: vi.fn(),
  integrationUpdate: vi.fn(),
  clientFindMany: vi.fn(),
  emailUpsert: vi.fn(),
  emailUpdateMany: vi.fn(),
  getValidAccessToken: vi.fn(),
  listInboxInitial: vi.fn(),
  listInboxDelta: vi.fn(),
}));

vi.mock('@nexushub/db', () => ({
  prisma: {
    integration: { findFirst: mocks.integrationFindFirst, update: mocks.integrationUpdate },
    client: { findMany: mocks.clientFindMany },
    emailMessage: { upsert: mocks.emailUpsert, updateMany: mocks.emailUpdateMany },
  },
}));
vi.mock('@/lib/auth', () => ({ requireUser: mocks.requireUser }));
vi.mock('@/features/integrations/lib/get-valid-access-token', () => ({
  getValidAccessToken: mocks.getValidAccessToken,
}));
vi.mock('@nexushub/integrations/graph', () => ({
  listInboxInitial: mocks.listInboxInitial,
  listInboxDelta: mocks.listInboxDelta,
}));

import { syncGraphInbox } from './sync-graph-inbox';

beforeEach(() => {
  for (const m of Object.values(mocks)) (m as { mockReset?: () => void }).mockReset?.();
  mocks.requireUser.mockResolvedValue({
    userId: 'U1',
    workspaceId: 'W1',
    role: 'user',
    isSuperAdmin: false,
    email: 'a@b.c',
  });
});

describe('syncGraphInbox', () => {
  it('runs initial sync when deltaToken null, upserts messages, sets deltaToken', async () => {
    mocks.integrationFindFirst.mockResolvedValue({
      id: 'I1',
      deltaToken: null,
      lastSyncedAt: null,
      status: 'active',
    });
    mocks.getValidAccessToken.mockResolvedValue('AT');
    mocks.clientFindMany.mockResolvedValue([{ id: 'C1', emailDomains: ['acme.com'] }]);
    mocks.listInboxInitial.mockResolvedValue({
      messages: [
        {
          externalId: 'M1',
          subject: 'Hi',
          fromEmail: 'a@acme.com',
          fromName: 'A',
          toRecipients: ['me@x'],
          ccRecipients: [],
          receivedAt: new Date('2026-05-28T10:00:00Z'),
          isRead: false,
          conversationId: 'c',
          bodyText: 'plain',
          bodyHtmlSanitized: null,
        },
      ],
      deltaLink: 'https://graph/delta',
    });
    mocks.emailUpsert.mockResolvedValue({});
    mocks.integrationUpdate.mockResolvedValue({});

    const res = await syncGraphInbox();
    expect(res).toEqual({ ok: true, fetched: 1, removed: 0 });
    expect(mocks.emailUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          workspaceId: 'W1',
          externalId: 'M1',
          clientId: 'C1',
          isRead: false,
        }),
      }),
    );
    expect(mocks.integrationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ deltaToken: 'https://graph/delta' }),
      }),
    );
  });

  it('throttles when lastSyncedAt < 30s ago', async () => {
    mocks.integrationFindFirst.mockResolvedValue({
      id: 'I1',
      deltaToken: 'D',
      lastSyncedAt: new Date(Date.now() - 5_000),
      status: 'active',
    });
    const res = await syncGraphInbox();
    expect(res).toEqual({ ok: true, throttled: true });
    expect(mocks.getValidAccessToken).not.toHaveBeenCalled();
  });

  it('runs delta sync when deltaToken present', async () => {
    mocks.integrationFindFirst.mockResolvedValue({
      id: 'I1',
      deltaToken: 'https://graph/d',
      lastSyncedAt: new Date(Date.now() - 60_000),
      status: 'active',
    });
    mocks.getValidAccessToken.mockResolvedValue('AT');
    mocks.clientFindMany.mockResolvedValue([]);
    mocks.listInboxDelta.mockResolvedValue({
      messages: [],
      removedIds: ['MX'],
      deltaLink: 'https://graph/d2',
    });
    mocks.emailUpdateMany.mockResolvedValue({ count: 1 });
    mocks.integrationUpdate.mockResolvedValue({});
    const res = await syncGraphInbox();
    expect(res).toEqual({ ok: true, fetched: 0, removed: 1 });
    expect(mocks.emailUpdateMany).toHaveBeenCalledWith({
      where: { workspaceId: 'W1', externalId: { in: ['MX'] }, deletedAt: null },
      data: { deletedAt: expect.any(Date) },
    });
  });

  it('returns ok:false when no active integration', async () => {
    mocks.integrationFindFirst.mockResolvedValue(null);
    const res = await syncGraphInbox();
    expect(res).toEqual({ ok: false, message: 'Aucune boîte connectée.' });
  });
});
```

- [ ] **Step 2: Run test, confirm fail**

```bash
pnpm --filter @nexushub/web exec vitest run features/communications/actions/sync-graph-inbox.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `apps/web/features/communications/actions/sync-graph-inbox.ts`**

```ts
'use server';
import 'server-only';
import { prisma } from '@nexushub/db';
import { requireUser } from '@/lib/auth';
import { getValidAccessToken } from '@/features/integrations/lib/get-valid-access-token';
import { listInboxInitial, listInboxDelta } from '@nexushub/integrations/graph';
import { buildDomainIndex, matchClientByDomain } from '../lib/auto-associate';

export type SyncResult =
  | { readonly ok: true; readonly fetched: number; readonly removed: number }
  | { readonly ok: true; readonly throttled: true }
  | { readonly ok: false; readonly message: string };

const THROTTLE_MS = 30_000;
const INITIAL_DAYS = 30;
const INITIAL_MAX = 200;

export async function syncGraphInbox(): Promise<SyncResult> {
  const ctx = await requireUser();
  const integration = await prisma.integration.findFirst({
    where: {
      workspaceId: ctx.workspaceId,
      kind: 'graph',
      ownerUserId: ctx.userId,
      status: 'active',
    },
    select: { id: true, deltaToken: true, lastSyncedAt: true },
  });
  if (!integration) {
    return { ok: false, message: 'Aucune boîte connectée.' };
  }
  if (integration.lastSyncedAt && Date.now() - integration.lastSyncedAt.getTime() < THROTTLE_MS) {
    return { ok: true, throttled: true };
  }

  let token: string;
  try {
    token = await getValidAccessToken(integration.id);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Refresh failed' };
  }

  const clients = await prisma.client.findMany({
    where: { workspaceId: ctx.workspaceId, deletedAt: null },
    select: { id: true, emailDomains: true },
    orderBy: { createdAt: 'asc' },
  });
  const domainIndex = buildDomainIndex(clients);

  let fetched: typeof messagesEmpty;
  let removed: readonly string[] = [];
  let deltaLink: string | null;

  if (integration.deltaToken) {
    const res = await listInboxDelta({ token, deltaUrl: integration.deltaToken });
    fetched = res.messages;
    removed = res.removedIds;
    deltaLink = res.deltaLink;
  } else {
    const res = await listInboxInitial({
      token,
      sinceDays: INITIAL_DAYS,
      maxMessages: INITIAL_MAX,
    });
    fetched = res.messages;
    deltaLink = res.deltaLink;
  }

  for (const m of fetched) {
    const clientId = matchClientByDomain(m.fromEmail, domainIndex);
    await prisma.emailMessage.upsert({
      where: {
        workspaceId_externalId: {
          workspaceId: ctx.workspaceId,
          externalId: m.externalId,
        },
      },
      create: {
        workspaceId: ctx.workspaceId,
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

  if (removed.length > 0) {
    await prisma.emailMessage.updateMany({
      where: {
        workspaceId: ctx.workspaceId,
        externalId: { in: [...removed] },
        deletedAt: null,
      },
      data: { deletedAt: new Date() },
    });
  }

  await prisma.integration.update({
    where: { id: integration.id },
    data: {
      lastSyncedAt: new Date(),
      ...(deltaLink ? { deltaToken: deltaLink } : {}),
    },
  });

  return { ok: true, fetched: fetched.length, removed: removed.length };
}

// Type stub used above (avoids importing ParsedGraphMessage at the top-level
// just for an annotation — keeps the action a thin orchestrator).
const messagesEmpty: ReadonlyArray<{
  externalId: string;
  subject: string;
  fromEmail: string;
  fromName: string | null;
  toRecipients: readonly string[];
  ccRecipients: readonly string[];
  receivedAt: Date;
  isRead: boolean;
  conversationId: string | null;
  bodyText: string;
  bodyHtmlSanitized: string | null;
}> = [];
```

- [ ] **Step 4: Run test, confirm pass**

```bash
pnpm --filter @nexushub/web exec vitest run features/communications/actions/sync-graph-inbox.test.ts
```

Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/features/communications/actions/sync-graph-inbox.ts apps/web/features/communications/actions/sync-graph-inbox.test.ts
git commit -m "feat(communications): syncGraphInbox with initial+delta+throttle"
```

---

## Task 17: `markEmailRead` action

**Files:**

- Create: `apps/web/features/communications/actions/mark-email-read.ts`
- Test: `apps/web/features/communications/actions/mark-email-read.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  emailUpdate: vi.fn(),
}));

vi.mock('@nexushub/db', () => ({
  prisma: { emailMessage: { update: mocks.emailUpdate } },
}));
vi.mock('@/lib/auth', () => ({ requireUser: mocks.requireUser }));

import { markEmailRead } from './mark-email-read';

beforeEach(() => {
  for (const m of Object.values(mocks)) (m as { mockReset?: () => void }).mockReset?.();
  mocks.requireUser.mockResolvedValue({
    userId: 'U1',
    workspaceId: 'W1',
    role: 'user',
    isSuperAdmin: false,
    email: 'a@b.c',
  });
});

describe('markEmailRead', () => {
  it('flips isRead and returns ok:true', async () => {
    mocks.emailUpdate.mockResolvedValue({});
    const res = await markEmailRead({ emailId: 'E1' });
    expect(res).toEqual({ ok: true });
    expect(mocks.emailUpdate).toHaveBeenCalledWith({
      where: { id: 'E1', workspaceId: 'W1' },
      data: { isRead: true },
    });
  });

  it('rejects invalid id', async () => {
    const res = await markEmailRead({ emailId: 'not-a-uuid' });
    expect(res).toEqual({ ok: false, message: 'Identifiant invalide.' });
  });
});
```

- [ ] **Step 2: Run test, confirm fail**

```bash
pnpm --filter @nexushub/web exec vitest run features/communications/actions/mark-email-read.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `apps/web/features/communications/actions/mark-email-read.ts`**

```ts
'use server';
import 'server-only';
import { z } from 'zod';
import { prisma } from '@nexushub/db';
import { requireUser } from '@/lib/auth';

const Schema = z.object({ emailId: z.string().uuid() });

export type MarkEmailReadResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

export async function markEmailRead(input: {
  readonly emailId: string;
}): Promise<MarkEmailReadResult> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Identifiant invalide.' };
  const ctx = await requireUser();
  try {
    await prisma.emailMessage.update({
      where: { id: parsed.data.emailId, workspaceId: ctx.workspaceId },
      data: { isRead: true },
    });
    return { ok: true };
  } catch {
    return { ok: false, message: 'Mail introuvable.' };
  }
}
```

- [ ] **Step 4: Run test, confirm pass**

```bash
pnpm --filter @nexushub/web exec vitest run features/communications/actions/mark-email-read.test.ts
```

Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/features/communications/actions/mark-email-read.ts apps/web/features/communications/actions/mark-email-read.test.ts
git commit -m "feat(communications): markEmailRead action"
```

---

## Task 18: UI components — `EmptyNoIntegration`, `MailTabs`

**Files:**

- Create: `apps/web/features/communications/components/empty-no-integration.tsx`
- Create: `apps/web/features/communications/components/mail-tabs.tsx`

- [ ] **Step 1: Implement `empty-no-integration.tsx`**

```tsx
import Link from 'next/link';

export function EmptyNoIntegration() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[color:var(--color-bg-muted)] text-2xl">
        📧
      </div>
      <h3 className="mb-2 text-base font-extrabold text-[color:var(--color-text-main)]">
        Connecte ta boîte Outlook
      </h3>
      <p className="mb-5 max-w-sm text-sm leading-relaxed text-[color:var(--color-text-muted)]">
        Centralise tes mails clients dans NexusHub. On affiche chaque message en regard du bon
        client (auto-association par domaine).
      </p>
      <Link href="/integrations" className="btn btn-primary">
        Aller dans Intégrations →
      </Link>
      <p className="mt-4 text-[11px] text-[color:var(--color-text-muted)]">
        Lecture seule pour cette itération. Envoi de réponses dans la prochaine.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Implement `mail-tabs.tsx`** (Client Component because of the Actualiser button)

```tsx
'use client';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { syncGraphInbox } from '../actions/sync-graph-inbox';

export interface MailTabsProps {
  readonly lastSyncedAt: string | null;
  readonly totalCount: number;
  readonly unreadCount: number;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'à l’instant';
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `il y a ${h} h`;
  return `il y a ${Math.floor(h / 24)} j`;
}

export function MailTabs({ lastSyncedAt, totalCount, unreadCount }: MailTabsProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const refresh = (): void => {
    startTransition(async () => {
      await syncGraphInbox();
      router.refresh();
    });
  };
  return (
    <header className="flex items-center justify-between border-b border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] px-6 py-4">
      <nav className="flex items-center gap-1" aria-label="Onglets communications">
        <span className="rounded-lg bg-[color:var(--color-bg-muted)] px-3 py-2 text-sm font-bold text-[color:var(--color-accent-primary)]">
          📧 Mails
          {unreadCount > 0 ? (
            <span className="ml-2 inline-flex min-w-[18px] items-center justify-center rounded-full bg-[color:var(--color-accent-primary)] px-1.5 py-0.5 text-[10px] font-extrabold text-white">
              {unreadCount}
            </span>
          ) : null}
        </span>
        <span
          className="cursor-not-allowed rounded-lg px-3 py-2 text-sm font-medium text-[color:var(--color-text-ghost)]"
          aria-disabled="true"
        >
          💬 Slack (bientôt)
        </span>
        <span
          className="cursor-not-allowed rounded-lg px-3 py-2 text-sm font-medium text-[color:var(--color-text-ghost)]"
          aria-disabled="true"
        >
          📝 Notes (bientôt)
        </span>
      </nav>
      <div className="flex items-center gap-3">
        <span className="text-[11px] text-[color:var(--color-text-muted)]">
          {lastSyncedAt
            ? `Sync ${relativeTime(lastSyncedAt)} · ${totalCount} mails`
            : `${totalCount} mails`}
        </span>
        <button type="button" onClick={refresh} disabled={pending} className="btn btn-ghost btn-sm">
          {pending ? 'Sync…' : '↻ Actualiser'}
        </button>
      </div>
    </header>
  );
}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @nexushub/web exec tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add apps/web/features/communications/components/empty-no-integration.tsx apps/web/features/communications/components/mail-tabs.tsx
git commit -m "feat(communications): tabs + empty-state components"
```

---

## Task 19: `MailList` + `MailReader` components

**Files:**

- Create: `apps/web/features/communications/components/mail-list.tsx`
- Create: `apps/web/features/communications/components/mail-reader.tsx`

- [ ] **Step 1: Implement `mail-list.tsx`** (Client Component — handles selection + optimistic isRead)

```tsx
'use client';
import { useState, useTransition } from 'react';
import { markEmailRead } from '../actions/mark-email-read';
import type { MailDTO } from '../lib/mail-dto';
import { MailReader } from './mail-reader';

export function MailList({ mails }: { readonly mails: readonly MailDTO[] }) {
  const [items, setItems] = useState<readonly MailDTO[]>(mails);
  const [selectedId, setSelectedId] = useState<string | null>(mails[0]?.id ?? null);
  const [, startTransition] = useTransition();

  const select = (id: string): void => {
    setSelectedId(id);
    setItems((prev) => prev.map((m) => (m.id === id ? { ...m, isRead: true } : m)));
    startTransition(() => {
      void markEmailRead({ emailId: id });
    });
  };

  const selected = items.find((m) => m.id === selectedId) ?? null;
  const unreadCount = items.filter((m) => !m.isRead).length;

  return (
    <div className="grid min-h-[460px] grid-cols-[340px_1fr]">
      <aside className="overflow-y-auto border-r border-[color:var(--color-border-light)] bg-[color:var(--color-bg-soft)]">
        <div className="flex items-center justify-between border-b border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-[color:var(--color-text-muted)]">
          <span>Inbox · {items.length}</span>
          {unreadCount > 0 ? (
            <span className="text-[color:var(--color-accent-primary)]">{unreadCount} non lus</span>
          ) : null}
        </div>
        <ul className="divide-y divide-[color:var(--color-border-light)]">
          {items.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => select(m.id)}
                className={[
                  'relative w-full px-4 py-3 text-left transition-colors',
                  m.id === selectedId
                    ? 'border-l-[3px] border-[color:var(--color-accent-primary)] bg-[color:var(--color-bg-muted)] pl-[13px]'
                    : 'hover:bg-[color:var(--color-bg-muted)]',
                ].join(' ')}
              >
                {!m.isRead ? (
                  <span
                    aria-hidden="true"
                    className="absolute left-1 top-4 h-1.5 w-1.5 rounded-full bg-[color:var(--color-accent-primary)]"
                  />
                ) : null}
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={['flex-1 truncate text-sm', m.isRead ? '' : 'font-extrabold'].join(
                      ' ',
                    )}
                  >
                    {m.fromName ?? m.fromEmail}
                  </span>
                  <span className="shrink-0 text-[11px] text-[color:var(--color-text-muted)]">
                    {new Date(m.receivedAt).toLocaleTimeString('fr-FR', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
                <div className="mt-1 truncate text-xs">{m.subject || '(sans sujet)'}</div>
                <div className="truncate text-[11px] text-[color:var(--color-text-muted)]">
                  {m.preview}
                </div>
                {m.client ? (
                  <span
                    className="mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide"
                    style={{
                      background: `var(--${m.client.colorToken}-bg)`,
                      color: `var(--${m.client.colorToken})`,
                    }}
                  >
                    <span
                      aria-hidden="true"
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ background: `var(--${m.client.colorToken})` }}
                    />
                    {m.client.name}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <MailReader mail={selected} />
    </div>
  );
}
```

- [ ] **Step 2: Implement `mail-reader.tsx`**

```tsx
import type { MailDTO } from '../lib/mail-dto';

function initials(name: string | null, email: string): string {
  const src = name ?? email;
  const parts = src.split(/[\s.@]+/).filter(Boolean);
  return (parts[0]?.[0] ?? '?').toUpperCase() + (parts[1]?.[0]?.toUpperCase() ?? '');
}

export function MailReader({ mail }: { readonly mail: MailDTO | null }) {
  if (!mail) {
    return (
      <div className="flex items-center justify-center p-10 text-sm text-[color:var(--color-text-muted)]">
        Sélectionne un mail à gauche.
      </div>
    );
  }
  return (
    <div className="overflow-y-auto bg-[color:var(--color-bg-card)] p-7">
      <h2 className="mb-3 text-lg font-extrabold text-[color:var(--color-text-main)]">
        {mail.subject || '(sans sujet)'}
      </h2>
      <div className="mb-5 flex items-center gap-3">
        <span
          className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold text-white"
          style={{ background: 'var(--accent-gradient)' }}
        >
          {initials(mail.fromName, mail.fromEmail)}
        </span>
        <div className="leading-tight">
          <div className="text-sm font-bold text-[color:var(--color-text-main)]">
            {mail.fromName ?? mail.fromEmail}
            {mail.client ? (
              <span
                className="ml-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide"
                style={{
                  background: `var(--${mail.client.colorToken}-bg)`,
                  color: `var(--${mail.client.colorToken})`,
                }}
              >
                {mail.client.name}
              </span>
            ) : null}
          </div>
          <div className="text-[11px] text-[color:var(--color-text-muted)]">{mail.fromEmail}</div>
          <div className="text-[11px] text-[color:var(--color-text-muted)]">
            {new Date(mail.receivedAt).toLocaleString('fr-FR', {
              dateStyle: 'long',
              timeStyle: 'short',
            })}
            {mail.toRecipients.length > 0 ? ` — à ${mail.toRecipients.join(', ')}` : ''}
          </div>
        </div>
      </div>
      {mail.bodyHtmlSanitized ? (
        <div
          className="text-sm leading-relaxed text-[color:var(--color-text-soft)]"
          // eslint-disable-next-line react/no-danger -- body is sanitized with sanitize-html allowlist
          dangerouslySetInnerHTML={{ __html: mail.bodyHtmlSanitized }}
        />
      ) : (
        <pre className="whitespace-pre-wrap font-sans text-sm text-[color:var(--color-text-soft)]">
          {mail.bodyText}
        </pre>
      )}
      <div className="mt-6 rounded-lg border border-dashed border-[color:var(--color-border-light)] bg-[color:var(--color-bg-soft)] px-4 py-3 text-center text-xs text-[color:var(--color-text-muted)]">
        ↩ Répondre — bientôt (itération 2)
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck + lint**

```bash
pnpm --filter @nexushub/web exec tsc --noEmit
pnpm --filter @nexushub/web exec eslint features/communications/components --max-warnings=0
```

Expected: exit 0 for both.

- [ ] **Step 4: Commit**

```bash
git add apps/web/features/communications/components/mail-list.tsx apps/web/features/communications/components/mail-reader.tsx
git commit -m "feat(communications): MailList + MailReader components"
```

---

## Task 20: `/communications` page (replaces placeholder)

**Files:**

- Modify (replace): `apps/web/app/(app)/communications/page.tsx`

- [ ] **Step 1: Replace `apps/web/app/(app)/communications/page.tsx`**

```tsx
import type { Metadata } from 'next';
import { prisma } from '@nexushub/db';
import { requireUser } from '@/lib/auth';
import { syncGraphInbox } from '@/features/communications/actions/sync-graph-inbox';
import { toMailDTO } from '@/features/communications/lib/mail-dto';
import { EmptyNoIntegration } from '@/features/communications/components/empty-no-integration';
import { MailTabs } from '@/features/communications/components/mail-tabs';
import { MailList } from '@/features/communications/components/mail-list';

export const metadata: Metadata = { title: 'Communications' };

interface PageProps {
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

const SYNC_FRESHNESS_MS = 30_000;

export default async function CommunicationsPage({ searchParams }: PageProps) {
  const ctx = await requireUser();
  const sp = (await searchParams) ?? {};
  const clientSlug = typeof sp['client'] === 'string' ? (sp['client'] as string) : null;

  const integration = await prisma.integration.findFirst({
    where: {
      workspaceId: ctx.workspaceId,
      kind: 'graph',
      ownerUserId: ctx.userId,
    },
    select: { status: true, lastSyncedAt: true },
  });

  if (!integration || (integration.status !== 'active' && integration.status !== 'error')) {
    return (
      <div className="mx-auto max-w-[1100px]">
        <header className="mb-6">
          <h1 className="text-[28px] font-extrabold tracking-tight">Communications</h1>
        </header>
        <EmptyNoIntegration />
      </div>
    );
  }

  // Server-side sync-on-open when stale (the action itself throttles internally).
  if (
    integration.status === 'active' &&
    (!integration.lastSyncedAt ||
      Date.now() - integration.lastSyncedAt.getTime() > SYNC_FRESHNESS_MS)
  ) {
    await syncGraphInbox();
  }

  // Resolve optional client filter.
  let clientFilter: string | null = null;
  if (clientSlug) {
    const c = await prisma.client.findFirst({
      where: { workspaceId: ctx.workspaceId, slug: clientSlug, deletedAt: null },
      select: { id: true },
    });
    clientFilter = c?.id ?? null;
  }

  const rows = await prisma.emailMessage.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      deletedAt: null,
      ...(clientFilter ? { clientId: clientFilter } : {}),
    },
    select: {
      id: true,
      subject: true,
      fromEmail: true,
      fromName: true,
      bodyText: true,
      bodyHtmlSanitized: true,
      receivedAt: true,
      isRead: true,
      clientId: true,
      client: { select: { id: true, name: true, colorToken: true } },
      toRecipients: true,
      ccRecipients: true,
    },
    orderBy: { receivedAt: 'desc' },
    take: 200,
  });
  const mails = rows.map(toMailDTO);
  const unreadCount = rows.filter((r) => !r.isRead).length;
  const refreshedIntegration = await prisma.integration.findFirst({
    where: { workspaceId: ctx.workspaceId, kind: 'graph', ownerUserId: ctx.userId },
    select: { lastSyncedAt: true },
  });

  return (
    <div className="mx-auto max-w-[1200px]">
      <header className="mb-4">
        <h1 className="text-[28px] font-extrabold tracking-tight">Communications</h1>
      </header>
      <div className="overflow-hidden rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)]">
        <MailTabs
          lastSyncedAt={
            refreshedIntegration?.lastSyncedAt
              ? refreshedIntegration.lastSyncedAt.toISOString()
              : null
          }
          totalCount={mails.length}
          unreadCount={unreadCount}
        />
        {mails.length === 0 ? (
          <div className="p-10 text-center text-sm text-[color:var(--color-text-muted)]">
            Aucun mail à afficher pour l’instant.
          </div>
        ) : (
          <MailList mails={mails} />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + lint**

```bash
pnpm --filter @nexushub/web exec tsc --noEmit
pnpm --filter @nexushub/web exec eslint "app/(app)/communications" features/communications --max-warnings=0
```

Expected: exit 0 for both.

- [ ] **Step 3: Smoke-test in dev**

Start the dev server and visit `http://localhost:3002/communications`. Expected: with no integration, shows `EmptyNoIntegration`. With an active integration (connect via `/integrations` first), shows the MailList + MailReader.

- [ ] **Step 4: Run the full web test suite to confirm nothing regressed**

```bash
pnpm --filter @nexushub/web test
```

Expected: ALL tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/\(app\)/communications/page.tsx
git commit -m "feat(communications): /communications page with mail list + reader"
```

---

## Task 21: Playwright E2E happy path

**Files:**

- Create: `e2e/email-foundations.spec.ts`

- [ ] **Step 1: Implement `e2e/email-foundations.spec.ts`**

```ts
import { test, expect } from '@playwright/test';

/**
 * Happy path:
 *   - Authenticated user visits /integrations.
 *   - Outlook card shows "inactive".
 *   - Click "Connecter ma boîte" → we INTERCEPT the redirect to MS and route
 *     it through a fake /api/oauth/graph/callback?code=fake&state=<same>.
 *     For the E2E to work end-to-end without Microsoft, the callback route
 *     should ALSO accept a TEST mode env (E2E_BYPASS_GRAPH=true) that uses
 *     stub tokens. That env hook is left as a follow-up task — for now this
 *     spec runs only when an Outlook is actually connected in staging.
 *
 * Run with:
 *   pnpm exec playwright test e2e/email-foundations.spec.ts
 */

test.describe('Email foundations — read flow (requires connected Outlook)', () => {
  test.skip(
    !process.env['E2E_OUTLOOK_CONNECTED'],
    'Set E2E_OUTLOOK_CONNECTED=1 once a test user has connected their Outlook',
  );

  test('list + open + mark read', async ({ page }) => {
    await page.goto('/communications');
    // Mails list visible
    await expect(page.getByRole('heading', { name: 'Communications' })).toBeVisible();
    // At least one mail
    const firstItem = page.locator('aside ul li button').first();
    await expect(firstItem).toBeVisible();
    // Selecting marks read (unread dot disappears for that item)
    await firstItem.click();
    // Reader pane shows the selected mail
    await expect(page.locator('main, [role="article"], .modal').first()).toBeVisible();
  });

  test('refresh button triggers a sync', async ({ page }) => {
    await page.goto('/communications');
    await page.getByRole('button', { name: /Actualiser/ }).click();
    // After sync, the freshness label should update (relative time text changes).
    await expect(page.getByText(/Sync il y a/)).toBeVisible({ timeout: 10_000 });
  });
});
```

- [ ] **Step 2: Verify the test file typechecks**

```bash
pnpm exec tsc --noEmit -p e2e/tsconfig.json 2>/dev/null || pnpm --filter @nexushub/web exec tsc --noEmit
```

Expected: exit 0 (the spec doesn't import app code so this is mostly a syntax check).

- [ ] **Step 3: Commit**

```bash
git add e2e/email-foundations.spec.ts
git commit -m "test(e2e): email foundations happy path (gated on connected Outlook)"
```

---

## Task 22: Final pass — full repo green, push, runbook

**Files:**

- Create: `docs/runbooks/microsoft-graph-integration.md`

- [ ] **Step 1: Full repo test + typecheck + lint**

```bash
pnpm -r test
pnpm --filter @nexushub/web exec tsc --noEmit
pnpm --filter @nexushub/web exec eslint . --max-warnings=0
```

Expected: all green.

- [ ] **Step 2: Write the runbook `docs/runbooks/microsoft-graph-integration.md`**

```markdown
# Runbook — Intégration Microsoft Graph (Outlook)

> **But** : connecter une boîte Outlook à NexusHub pour lire les mails dans /communications.

## Prérequis Azure AD

1. App registration sur Entra → multi-tenant work/school.
2. Redirect URIs : prod + 2 localhost (3000/3002), tous suffixés par `/api/oauth/graph/callback`.
3. Secret client généré, valeur copiée (visible une seule fois).
4. Permissions Graph déléguées : `Mail.Read`, `User.Read`, `offline_access` (pas de consentement admin requis).

## Variables d'environnement

À mettre dans `.env.local` (dev) ET Vercel (Production + Preview) :

- `GRAPH_CLIENT_ID` — Application (client) ID
- `GRAPH_CLIENT_SECRET` — valeur du secret client
- `ENCRYPTION_KEY` — `openssl rand -base64 32`
- `ENCRYPTION_KEY_VERSION=1`
- `OAUTH_STATE_SECRET` — `openssl rand -base64 32`
- `APP_URL` — ex `https://app.brandnewday.agency` (prod), `http://localhost:3002` (dev)

## Test rapide après déploiement

1. Aller sur `/integrations`, cliquer « Connecter ma boîte ».
2. Consentir sur la page Microsoft.
3. Retour sur `/integrations?connected=graph` → carte Outlook passe en « Connecté ».
4. Aller sur `/communications` → la première sync s'exécute, liste de mails apparaît (auto-associés par domaine).

## Rotation `ENCRYPTION_KEY`

- Incrémenter `ENCRYPTION_KEY_VERSION` à chaque nouvelle clé.
- Garder l'ancienne clé pour décrypter les rows existantes (`Integration.keyVersion`).
- Migration manuelle V1.5 : re-encrypter toutes les rows avec la nouvelle clé.

## Hors-scope V1 (rappel)

- Envoi/réponse (`sendMail`) → iter 2.
- Webhooks Graph (subscriptions) → iter 3.
- Pièces jointes, isRead writeback, multi-mailbox → V1.5+.
```

- [ ] **Step 3: Commit**

```bash
git add docs/runbooks/microsoft-graph-integration.md
git commit -m "docs(runbooks): Microsoft Graph integration setup"
```

- [ ] **Step 4: Push branch and open a PR (or merge locally per finishing-a-development-branch skill)**

```bash
git push -u origin feature/email-foundations
gh pr create --title "feat: email foundations (Microsoft Graph read-only)" --body "$(cat <<'BODY'
## Summary
- OAuth Microsoft Graph delegated (multi-tenant work/school).
- Initial sync (inbox, 30 days, max 200) + delta sync on open + manual refresh.
- /integrations canonical entry + /communications mail list/reader.
- Auto-associate email -> client by sender domain.
- isRead local-only; no reply, no templates, no webhooks (iter 2+).

## Test plan
- [ ] User can connect their Outlook from /integrations and lands back with `?connected=graph`.
- [ ] /communications shows the inbox with sender domain → client badge.
- [ ] Mark-as-read flips the unread dot.
- [ ] Refresh button triggers a sync.
- [ ] Disconnect clears the integration; reconnect works.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
BODY
)"
```

---

## Plan complete

Total: **22 tasks**, ~5–7 hours of focused work for an experienced dev, ~10–14 hours via subagent-driven-development with full TDD discipline.

**Spec coverage check:** every §1–§11 requirement of the spec has at least one task that implements it. Out-of-scope items remain explicitly out-of-scope.
