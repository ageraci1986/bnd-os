# Mail Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship file attachments for NexusHub Communications — reception with lazy fetch, upload with sync antivirus scan, send via Graph + SMTP, and Forward reprise with shared Storage paths.

**Architecture:** New `EmailAttachment` table stores metadata for inbound + outbound attachments. Binaries live in a private Supabase Storage bucket `mail-attachments` scoped per workspace via RLS. VirusTotal scans every fresh upload synchronously. Received attachments are lazy-fetched from source (IMAP `BODY[part]` / Graph `/attachments/{id}/$value`) on first download, then cached. SHA-256 dedup skips scans of already-clean binaries. Multi-file drag/drop batches upload in parallel from the client.

**Tech Stack:** Next.js 15, React 19, Prisma 6 on Supabase Postgres 17, `nodemailer` (existing), `imapflow` (existing), `mailparser` (existing), new: `file-type` (magic-byte sniffing) + VirusTotal API (direct fetch, no SDK). Vitest, Playwright.

**Spec:** [`docs/superpowers/specs/2026-07-16-mail-attachments-design.md`](../specs/2026-07-16-mail-attachments-design.md)

**Branch / worktree:** `feature/mail-attachments` in `.worktrees/mail-attachments` (already set up, baseline green: 14/14 turbo cached, all tests green).

---

## Task 1: Prisma schema — EmailAttachment + denorm flags + enum

**Files:**

- Modify: `packages/db/prisma/schema.prisma`

### Steps

- [ ] **Step 1: Add `AttachmentScanStatus` enum**

Locate the other Communications-related enums (search for `enum EmailSendStatus` from iter 3). Add near them:

```prisma
enum AttachmentScanStatus {
  pending
  clean
  dirty
  scan_failed
}
```

- [ ] **Step 2: Extend `AuditAction` enum with 4 new attachment values**

Locate `enum AuditAction`. Add these values keeping the existing ones untouched:

```prisma
  attachment_uploaded
  attachment_scanned_dirty
  attachment_downloaded
  attachment_rejected_upload
```

- [ ] **Step 3: Add `hasAttachments` denorm flag on `EmailMessage`**

In `model EmailMessage`, right after the `sendStatus` line (from iter 3):

```prisma
  /// Denormalized flag set at parse-time from BODYSTRUCTURE / Graph metadata.
  /// Lets MailList show 📎 without joining EmailAttachment.
  hasAttachments   Boolean           @default(false) @map("has_attachments")
```

- [ ] **Step 4: Add `composeAttachments` JSONB on `MailDraft`**

In `model MailDraft`, right after `bodyHtml`:

```prisma
  /// Uploaded attachments (Storage-persisted + scanned clean) that will
  /// become EmailAttachment rows on send. JSONB array of AttachmentDraft
  /// records: { id, filename, contentType, sizeBytes, storagePath, sha256,
  /// reprisedFromAttachmentId? }.
  composeAttachments Json          @default("[]") @map("compose_attachments")
```

- [ ] **Step 5: Add new `EmailAttachment` model**

Add near the bottom of the model section, before the enums:

```prisma
model EmailAttachment {
  id               String                @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  workspaceId      String                @map("workspace_id") @db.Uuid
  emailMessageId   String                @map("email_message_id") @db.Uuid
  /// Filename from the sender / user upload. Sanitized (no path traversal,
  /// no null bytes, unicode-safe, capped 255) before persist.
  filename         String                @db.Text
  /// MIME content-type as declared. Verified against magic bytes after fetch.
  contentType      String                @map("content_type")
  /// Size in bytes as reported by source. Verified against actual size after fetch.
  sizeBytes        Int                   @map("size_bytes")
  /// Source-specific reference used to re-fetch: IMAP part number (e.g. "2.1")
  /// or Graph attachment id.
  sourceExternalId String                @map("source_external_id") @db.Text
  /// Content-Id header for inline images (cid: scheme in HTML body). Null for
  /// regular attachments.
  contentId        String?               @map("content_id")
  /// True = inline (referenced by cid: in body HTML). Not re-attachable as a
  /// file on Forward — stays in the quoted HTML.
  isInline         Boolean               @default(false) @map("is_inline")
  /// Supabase Storage object key `<workspaceId>/<attachment uuid>`. Null
  /// until the binary is fetched.
  storagePath      String?               @map("storage_path")
  /// pending → clean | dirty | scan_failed. Null = not scanned yet (lazy state).
  scanStatus       AttachmentScanStatus? @map("scan_status")
  /// VirusTotal analysis summary (engine detections, verdict, analysis id).
  scanReport       Json?                 @map("scan_report")
  /// SHA-256 hex of the binary. Set on first fetch. Enables workspace-scoped dedup.
  sha256           String?               @db.Char(64)
  createdAt        DateTime              @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt        DateTime              @updatedAt @map("updated_at") @db.Timestamptz(6)

  workspace    Workspace    @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  emailMessage EmailMessage @relation(fields: [emailMessageId], references: [id], onDelete: Cascade)

  @@unique([emailMessageId, sourceExternalId])
  @@index([workspaceId, emailMessageId])
  @@index([workspaceId, scanStatus])
  @@index([workspaceId, sha256])
  @@map("email_attachments")
}
```

- [ ] **Step 6: Add back-relations on Workspace + EmailMessage**

On `model Workspace`:

```prisma
  emailAttachments     EmailAttachment[]
```

On `model EmailMessage`:

```prisma
  emailAttachments EmailAttachment[]
```

- [ ] **Step 7: Regenerate Prisma Client**

```bash
cd /Users/angelogeraci/Documents/Application/BND-OS/.worktrees/mail-attachments/packages/db
pnpm exec prisma generate
```

Expected: `✔ Generated Prisma Client (v6.19.3) …`

- [ ] **Step 8: Commit**

```bash
cd /Users/angelogeraci/Documents/Application/BND-OS/.worktrees/mail-attachments
git add packages/db/prisma/schema.prisma
git commit -m "feat(db): mail attachments schema (EmailAttachment + denorm flags + enums)"
```

---

## Task 2: Migration SQL — table + enums + FKs + indexes

**Files:**

- Create: `packages/db/prisma/migrations/<timestamp>_mail_attachments/migration.sql`

### Steps

- [ ] **Step 1: Create the migration folder**

```bash
cd /Users/angelogeraci/Documents/Application/BND-OS/.worktrees/mail-attachments
mkdir -p "packages/db/prisma/migrations/$(date -u +%Y%m%d%H%M%S)_mail_attachments"
```

- [ ] **Step 2: Write the migration SQL byte-for-byte**

Write to `packages/db/prisma/migrations/<timestamp>_mail_attachments/migration.sql`:

```sql
-- CreateEnum
CREATE TYPE "AttachmentScanStatus" AS ENUM ('pending', 'clean', 'dirty', 'scan_failed');

-- AlterEnum AuditAction (4 new values — idempotent via IF NOT EXISTS)
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'attachment_uploaded';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'attachment_scanned_dirty';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'attachment_downloaded';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'attachment_rejected_upload';

-- AlterTable EmailMessage: denorm hasAttachments flag (default false — no backfill needed)
ALTER TABLE "email_messages"
  ADD COLUMN "has_attachments" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable MailDraft: JSONB slot for in-progress uploads
ALTER TABLE "mail_drafts"
  ADD COLUMN "compose_attachments" JSONB NOT NULL DEFAULT '[]';

-- CreateTable EmailAttachment
CREATE TABLE "email_attachments" (
  "id"                  UUID           NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id"        UUID           NOT NULL,
  "email_message_id"    UUID           NOT NULL,
  "filename"            TEXT           NOT NULL,
  "content_type"        TEXT           NOT NULL,
  "size_bytes"          INTEGER        NOT NULL,
  "source_external_id"  TEXT           NOT NULL,
  "content_id"          TEXT,
  "is_inline"           BOOLEAN        NOT NULL DEFAULT false,
  "storage_path"        TEXT,
  "scan_status"         "AttachmentScanStatus",
  "scan_report"         JSONB,
  "sha256"              CHAR(64),
  "created_at"          TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "email_attachments_pkey" PRIMARY KEY ("id")
);

-- Unique (email_message_id, source_external_id) — prevents duplicate rows for the same
-- attachment when a sync re-runs
CREATE UNIQUE INDEX "email_attachments_email_message_id_source_external_id_key"
  ON "email_attachments" ("email_message_id", "source_external_id");

-- Query indexes
CREATE INDEX "email_attachments_workspace_id_email_message_id_idx"
  ON "email_attachments" ("workspace_id", "email_message_id");
CREATE INDEX "email_attachments_workspace_id_scan_status_idx"
  ON "email_attachments" ("workspace_id", "scan_status");
CREATE INDEX "email_attachments_workspace_id_sha256_idx"
  ON "email_attachments" ("workspace_id", "sha256");

-- FKs — cascade on workspace + email_message
ALTER TABLE "email_attachments"
  ADD CONSTRAINT "email_attachments_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "email_attachments_email_message_id_fkey"
    FOREIGN KEY ("email_message_id") REFERENCES "email_messages"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 3: Commit**

```bash
cd /Users/angelogeraci/Documents/Application/BND-OS/.worktrees/mail-attachments
git add packages/db/prisma/migrations/
git commit -m "feat(db): mail attachments migration"
```

**Note — do NOT apply to any DB yet.** Task 3 does bucket creation + RLS + migration under user approval.

---

## Task 3: USER GATE — create Storage bucket + RLS + apply migration

**Files:**

- None (operational task via Supabase MCP).

### Steps

- [ ] **Step 1: Announce the plan to the user and wait for explicit confirmation before any DB/Storage change.**

Before running any tool call, print:

> Task 3 needs 3 destructive/creative actions on the shared Supabase project (`yphedrhofupththvlvoa` / `bnd-os-staging`):
>
> 1. Create Storage bucket `mail-attachments` (private).
> 2. Apply 2 RLS policies to `storage.objects` scoping the bucket by workspace.
> 3. Apply the migration `<timestamp>_mail_attachments` (additive-safe, no backfill).
>
> Confirm to proceed.

Wait for user "yes / confirmed / go".

- [ ] **Step 2: Pre-checks via `mcp__supabase__execute_sql` — none of these should already exist.**

```sql
-- Bucket check
SELECT COUNT(*)::int AS bucket_exists FROM storage.buckets WHERE id = 'mail-attachments';
-- Expected: 0

-- Table check
SELECT COUNT(*)::int AS table_exists FROM information_schema.tables WHERE table_name = 'email_attachments';
-- Expected: 0

-- Enum check
SELECT COUNT(*)::int AS enum_exists FROM pg_type WHERE typname = 'AttachmentScanStatus';
-- Expected: 0
```

If any is non-zero → STOP and reconcile with the user.

- [ ] **Step 3: Create the bucket via `mcp__supabase__execute_sql`.**

```sql
INSERT INTO storage.buckets (id, name, public)
VALUES ('mail-attachments', 'mail-attachments', false);
```

- [ ] **Step 4: Apply RLS policies to `storage.objects` (bucket-scoped).**

```sql
-- SELECT: workspace_id prefix in the object path must match the caller's JWT
CREATE POLICY "mail_attachments_select_own_workspace"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'mail-attachments'
    AND (storage.foldername(name))[1] = (auth.jwt() ->> 'workspace_id')
  );

-- INSERT / UPDATE / DELETE: service role only (server actions use the admin key)
CREATE POLICY "mail_attachments_write_service_role_only"
  ON storage.objects FOR ALL
  USING (
    bucket_id = 'mail-attachments'
    AND (auth.jwt() ->> 'role') = 'service_role'
  );
```

- [ ] **Step 5: Apply the Task 2 migration via `mcp__supabase__apply_migration`.**

Migration name: `mail_attachments`. SQL: exactly the content of the file created in Task 2.

Expected: `{"success": true}`.

- [ ] **Step 6: Post-checks via `mcp__supabase__execute_sql`.**

```sql
-- Verify columns added
SELECT column_name, data_type, is_nullable FROM information_schema.columns
WHERE (table_name = 'email_messages' AND column_name = 'has_attachments')
   OR (table_name = 'mail_drafts' AND column_name = 'compose_attachments')
ORDER BY table_name, column_name;
-- Expected 2 rows.

-- Verify email_attachments table exists with all indexes
SELECT indexname FROM pg_indexes WHERE tablename = 'email_attachments' ORDER BY indexname;
-- Expected 5 rows: pkey + 4 indexes (unique + 3 query).

-- Verify AttachmentScanStatus enum values
SELECT unnest(enum_range(NULL::"AttachmentScanStatus")) AS v;
-- Expected: pending, clean, dirty, scan_failed

-- Verify AuditAction has all 4 new values
SELECT unnest(enum_range(NULL::"AuditAction")) AS v ORDER BY v;
-- Expected list includes attachment_uploaded, attachment_scanned_dirty,
-- attachment_downloaded, attachment_rejected_upload.

-- Verify bucket + policies
SELECT id FROM storage.buckets WHERE id = 'mail-attachments';
SELECT policyname FROM pg_policies WHERE tablename = 'objects' AND policyname LIKE 'mail_attachments_%';
-- Expected: 1 bucket row + 2 policies.
```

- [ ] **Step 7: No commit** — this task modifies only the shared DB + Storage. Task 21 (docs) records the date.

---

## Task 4: Install `file-type` + verify VirusTotal API contract

**Files:**

- Modify: `packages/integrations/package.json`

### Steps

- [ ] **Step 1: WebFetch the VirusTotal API v3 docs to confirm the current pricing / quotas / endpoints**

Use the WebFetch tool with URL `https://docs.virustotal.com/reference/files-scan` and prompt "Confirm the current free-tier request/day quota, the POST /files endpoint payload shape (multipart file field name, max size), the GET /analyses/{id} response shape (data.attributes.stats fields malicious/suspicious/undetected/harmless, status field). Report any breaking changes since 2024."

Record the confirmed facts in the commit message + the runbook (Task 21).

- [ ] **Step 2: Install `file-type` for magic-byte content-type sniffing**

Verify latest version via Context7 MCP first (mandatory per CLAUDE.md §2). If Context7 unavailable in this env (previous iters showed this), fall back to `pnpm view file-type version`.

```bash
cd /Users/angelogeraci/Documents/Application/BND-OS/.worktrees/mail-attachments/packages/integrations
pnpm add file-type
cd /Users/angelogeraci/Documents/Application/BND-OS/.worktrees/mail-attachments
```

- [ ] **Step 3: Verify no HIGH/CRITICAL vulnerabilities**

```bash
pnpm audit --audit-level=high
```

If pnpm audit fails at the registry (410 known issue seen in previous iters), fall back to `npm audit --production` in an isolated install.

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @nexushub/integrations typecheck
```

- [ ] **Step 5: Commit**

```bash
git add packages/integrations/package.json pnpm-lock.yaml
git commit -m "feat(deps): add file-type for magic-byte sniffing (mail attachments)"
```

Include the confirmed VirusTotal API facts in the commit body.

---

## Task 5: `virustotal.ts` adapter

**Files:**

- Create: `packages/integrations/src/antivirus/virustotal.ts`
- Test: `packages/integrations/src/antivirus/virustotal.test.ts`
- Create: `packages/integrations/src/antivirus/index.ts` (barrel)
- Modify: `packages/integrations/src/index.ts` (`export * as antivirus from './antivirus/index'`)
- Modify: `packages/integrations/package.json` (`./antivirus` subpath)

### Steps

- [ ] **Step 1: Write the failing test**

```ts
// packages/integrations/src/antivirus/virustotal.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { scanFileWithVirusTotal } from './virustotal';

const CLEAN_ANALYSIS = {
  data: {
    attributes: {
      status: 'completed',
      stats: { malicious: 0, suspicious: 0, harmless: 5, undetected: 65 },
      results: {},
    },
  },
};

const DIRTY_ANALYSIS = {
  data: {
    attributes: {
      status: 'completed',
      stats: { malicious: 3, suspicious: 1, harmless: 2, undetected: 60 },
      results: {
        EngineA: { category: 'malicious', engine_name: 'EngineA' },
        EngineB: { category: 'malicious', engine_name: 'EngineB' },
      },
    },
  },
};

describe('scanFileWithVirusTotal', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('returns clean when stats.malicious and stats.suspicious are 0', async () => {
    let callIdx = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        if (callIdx++ === 0) {
          return new Response(JSON.stringify({ data: { id: 'analysis-1' } }), { status: 200 });
        }
        return new Response(JSON.stringify(CLEAN_ANALYSIS), { status: 200 });
      }),
    );
    const r = await scanFileWithVirusTotal(Buffer.from('hello'), 'test-key');
    expect(r.clean).toBe(true);
    expect(r.verdict).toBe('clean');
    expect(r.analysisId).toBe('analysis-1');
  });

  it('returns dirty when at least one malicious hit', async () => {
    let callIdx = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        if (callIdx++ === 0) {
          return new Response(JSON.stringify({ data: { id: 'analysis-2' } }), { status: 200 });
        }
        return new Response(JSON.stringify(DIRTY_ANALYSIS), { status: 200 });
      }),
    );
    const r = await scanFileWithVirusTotal(Buffer.from('evil'), 'test-key');
    expect(r.clean).toBe(false);
    expect(r.verdict).toBe('dirty');
    expect(r.detectingEngines).toEqual(expect.arrayContaining(['EngineA', 'EngineB']));
  });

  it('returns scan_failed when the upload endpoint 5xxs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 502 })),
    );
    const r = await scanFileWithVirusTotal(Buffer.from('x'), 'test-key');
    expect(r.clean).toBe(false);
    expect(r.verdict).toBe('scan_failed');
  });

  it('returns scan_failed when analysis polling times out (>= 60s)', async () => {
    vi.useFakeTimers();
    let callIdx = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        if (callIdx++ === 0) {
          return new Response(JSON.stringify({ data: { id: 'analysis-3' } }), { status: 200 });
        }
        // Always "queued" — never completes
        return new Response(
          JSON.stringify({
            data: { attributes: { status: 'queued', stats: { malicious: 0, suspicious: 0 } } },
          }),
          { status: 200 },
        );
      }),
    );
    const p = scanFileWithVirusTotal(Buffer.from('slow'), 'test-key');
    await vi.advanceTimersByTimeAsync(70_000);
    const r = await p;
    expect(r.verdict).toBe('scan_failed');
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd /Users/angelogeraci/Documents/Application/BND-OS/.worktrees/mail-attachments
pnpm --filter @nexushub/integrations test -- antivirus/virustotal
```

- [ ] **Step 3: Implement `packages/integrations/src/antivirus/virustotal.ts`**

```ts
export interface VirusTotalScanResult {
  readonly clean: boolean;
  readonly verdict: 'clean' | 'dirty' | 'scan_failed';
  readonly stats: {
    readonly malicious: number;
    readonly suspicious: number;
    readonly harmless: number;
    readonly undetected: number;
  };
  readonly detectingEngines?: readonly string[];
  readonly analysisId: string;
}

interface UploadResponse {
  readonly data?: { readonly id?: string };
}

interface AnalysisResponse {
  readonly data?: {
    readonly attributes?: {
      readonly status?: string;
      readonly stats?: {
        readonly malicious?: number;
        readonly suspicious?: number;
        readonly harmless?: number;
        readonly undetected?: number;
      };
      readonly results?: Record<
        string,
        { readonly category?: string; readonly engine_name?: string }
      >;
    };
  };
}

const VT_BASE = 'https://www.virustotal.com/api/v3';
const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS = 60_000;

const EMPTY_STATS = { malicious: 0, suspicious: 0, harmless: 0, undetected: 0 } as const;

async function uploadFile(binary: Buffer, apiKey: string): Promise<string | null> {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(binary)]), 'upload');
  const res = await fetch(`${VT_BASE}/files`, {
    method: 'POST',
    headers: { 'x-apikey': apiKey },
    body: form,
  });
  if (!res.ok) return null;
  const body = (await res.json()) as UploadResponse;
  return body.data?.id ?? null;
}

async function pollAnalysis(analysisId: string, apiKey: string): Promise<AnalysisResponse | null> {
  const started = Date.now();
  while (Date.now() - started < POLL_TIMEOUT_MS) {
    const res = await fetch(`${VT_BASE}/analyses/${encodeURIComponent(analysisId)}`, {
      headers: { 'x-apikey': apiKey },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as AnalysisResponse;
    if (body.data?.attributes?.status === 'completed') return body;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return null;
}

export async function scanFileWithVirusTotal(
  binary: Buffer,
  apiKey: string,
): Promise<VirusTotalScanResult> {
  const analysisId = await uploadFile(binary, apiKey);
  if (!analysisId) {
    return { clean: false, verdict: 'scan_failed', stats: EMPTY_STATS, analysisId: '' };
  }

  const analysis = await pollAnalysis(analysisId, apiKey);
  if (!analysis || !analysis.data?.attributes) {
    return { clean: false, verdict: 'scan_failed', stats: EMPTY_STATS, analysisId };
  }

  const attrs = analysis.data.attributes;
  const stats = {
    malicious: attrs.stats?.malicious ?? 0,
    suspicious: attrs.stats?.suspicious ?? 0,
    harmless: attrs.stats?.harmless ?? 0,
    undetected: attrs.stats?.undetected ?? 0,
  };
  const clean = stats.malicious === 0 && stats.suspicious === 0;
  const verdict: VirusTotalScanResult['verdict'] = clean ? 'clean' : 'dirty';
  const detectingEngines = clean
    ? undefined
    : Object.values(attrs.results ?? {})
        .filter((r) => r.category === 'malicious' || r.category === 'suspicious')
        .map((r) => r.engine_name ?? 'unknown')
        .filter((n): n is string => Boolean(n));

  return { clean, verdict, stats, analysisId, ...(detectingEngines ? { detectingEngines } : {}) };
}
```

- [ ] **Step 4: Create the barrel + subpath exports**

`packages/integrations/src/antivirus/index.ts`:

```ts
export { scanFileWithVirusTotal } from './virustotal';
export type { VirusTotalScanResult } from './virustotal';
```

In `packages/integrations/src/index.ts`, add:

```ts
export * as antivirus from './antivirus/index';
```

In `packages/integrations/package.json` `exports` map:

```json
    "./antivirus": "./src/antivirus/index.ts",
```

- [ ] **Step 5: Run test — expect PASS (4 tests)**

- [ ] **Step 6: Commit**

```bash
git add packages/integrations/src/antivirus/ packages/integrations/src/index.ts packages/integrations/package.json
git commit -m "feat(integrations): virustotal antivirus adapter with poll + timeout"
```

---

## Task 6: IMAP attachments — parse BODYSTRUCTURE + fetch binary

**Files:**

- Create: `packages/integrations/src/imap/attachments.ts` (parse + fetch)
- Test: `packages/integrations/src/imap/attachments.test.ts`
- Modify: `packages/integrations/src/imap/index.ts` (barrel)

### Steps

- [ ] **Step 1: Write the failing test**

```ts
// packages/integrations/src/imap/attachments.test.ts
import { describe, it, expect } from 'vitest';
import { parseImapAttachments } from './attachments';

describe('parseImapAttachments', () => {
  it('returns [] on a plain text body', () => {
    const bodyStructure = { type: 'text', subtype: 'plain', part: '1' };
    expect(parseImapAttachments(bodyStructure)).toEqual([]);
  });

  it('extracts a single attachment from multipart/mixed', () => {
    const bodyStructure = {
      type: 'multipart',
      subtype: 'mixed',
      childNodes: [
        { type: 'text', subtype: 'html', part: '1' },
        {
          type: 'application',
          subtype: 'pdf',
          part: '2',
          disposition: 'attachment',
          dispositionParameters: { filename: 'rapport.pdf' },
          size: 12345,
        },
      ],
    };
    const r = parseImapAttachments(bodyStructure);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      partNumber: '2',
      filename: 'rapport.pdf',
      contentType: 'application/pdf',
      sizeBytes: 12345,
      isInline: false,
    });
  });

  it('extracts inline images (cid: scheme)', () => {
    const bodyStructure = {
      type: 'multipart',
      subtype: 'related',
      childNodes: [
        { type: 'text', subtype: 'html', part: '1' },
        {
          type: 'image',
          subtype: 'png',
          part: '2',
          disposition: 'inline',
          id: '<logo@ex.com>',
          size: 5000,
          parameters: { name: 'logo.png' },
        },
      ],
    };
    const r = parseImapAttachments(bodyStructure);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      partNumber: '2',
      filename: 'logo.png',
      contentType: 'image/png',
      isInline: true,
      contentId: '<logo@ex.com>',
    });
  });

  it('walks nested multipart trees', () => {
    const bodyStructure = {
      type: 'multipart',
      subtype: 'mixed',
      childNodes: [
        {
          type: 'multipart',
          subtype: 'alternative',
          childNodes: [
            { type: 'text', subtype: 'plain', part: '1.1' },
            { type: 'text', subtype: 'html', part: '1.2' },
          ],
        },
        {
          type: 'application',
          subtype: 'pdf',
          part: '2',
          disposition: 'attachment',
          dispositionParameters: { filename: 'A.pdf' },
          size: 1000,
        },
      ],
    };
    expect(parseImapAttachments(bodyStructure)).toHaveLength(1);
  });

  it('uses parameters.name as fallback when dispositionParameters.filename is missing', () => {
    const bodyStructure = {
      type: 'application',
      subtype: 'octet-stream',
      part: '1',
      disposition: 'attachment',
      parameters: { name: 'file.bin' },
      size: 200,
    };
    expect(parseImapAttachments(bodyStructure)[0]?.filename).toBe('file.bin');
  });

  it('assigns "attachment.bin" when no filename is anywhere', () => {
    const bodyStructure = {
      type: 'application',
      subtype: 'octet-stream',
      part: '1',
      disposition: 'attachment',
      size: 100,
    };
    expect(parseImapAttachments(bodyStructure)[0]?.filename).toBe('attachment.bin');
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `packages/integrations/src/imap/attachments.ts`**

```ts
import type { ImapFlow } from 'imapflow';

export interface ParsedImapAttachment {
  readonly partNumber: string;
  readonly filename: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly contentId: string | null;
  readonly isInline: boolean;
}

interface BodyStructureNode {
  readonly type?: string;
  readonly subtype?: string;
  readonly part?: string;
  readonly disposition?: string;
  readonly dispositionParameters?: { readonly filename?: string };
  readonly parameters?: { readonly name?: string };
  readonly id?: string;
  readonly size?: number;
  readonly childNodes?: readonly BodyStructureNode[];
}

function isAttachmentNode(node: BodyStructureNode): boolean {
  const disp = (node.disposition ?? '').toLowerCase();
  if (disp === 'attachment') return true;
  // Inline image with a Content-ID (used by cid: HTML img references) also counts.
  if (disp === 'inline' && node.type === 'image' && Boolean(node.id)) return true;
  return false;
}

function fileNameOf(node: BodyStructureNode): string {
  return node.dispositionParameters?.filename ?? node.parameters?.name ?? 'attachment.bin';
}

/**
 * Walk the ImapFlow BODYSTRUCTURE tree and return every part that qualifies
 * as an attachment. Inline images (cid: referenced from the HTML body) are
 * included with `isInline=true` so consumers can distinguish them from real
 * attachments when needed.
 */
export function parseImapAttachments(bodyStructure: unknown): readonly ParsedImapAttachment[] {
  const out: ParsedImapAttachment[] = [];

  function walk(node: BodyStructureNode): void {
    if (node.childNodes && node.childNodes.length > 0) {
      for (const child of node.childNodes) walk(child);
      return;
    }
    if (!isAttachmentNode(node)) return;
    const isInline = (node.disposition ?? '').toLowerCase() === 'inline';
    out.push({
      partNumber: node.part ?? '',
      filename: fileNameOf(node),
      contentType: `${node.type ?? 'application'}/${node.subtype ?? 'octet-stream'}`.toLowerCase(),
      sizeBytes: node.size ?? 0,
      contentId: node.id ?? null,
      isInline,
    });
  }

  walk(bodyStructure as BodyStructureNode);
  return out;
}

/**
 * Fetch a single attachment's raw binary via `session.download` on the
 * specified part number. Caller owns the session lifecycle. Returns null
 * if the server has no data for that part.
 */
export async function fetchImapAttachmentBinary(
  session: ImapFlow,
  uid: number,
  partNumber: string,
): Promise<Buffer | null> {
  await session.mailboxOpen('INBOX');
  const dl = await session.download(String(uid), `BODY[${partNumber}]`, { uid: true });
  if (!dl?.content) return null;
  const chunks: Buffer[] = [];
  const content = dl.content as unknown;
  if (Buffer.isBuffer(content)) {
    chunks.push(content);
  } else if (
    content &&
    typeof (content as AsyncIterable<unknown>)[Symbol.asyncIterator] === 'function'
  ) {
    for await (const chunk of content as AsyncIterable<Buffer | string>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
  }
  return Buffer.concat(chunks);
}
```

- [ ] **Step 4: Re-export from IMAP barrel**

In `packages/integrations/src/imap/index.ts`, add:

```ts
export { parseImapAttachments, fetchImapAttachmentBinary } from './attachments';
export type { ParsedImapAttachment } from './attachments';
```

- [ ] **Step 5: Run test — expect PASS (6 tests)**

- [ ] **Step 6: Commit**

```bash
git add packages/integrations/src/imap/attachments.ts packages/integrations/src/imap/attachments.test.ts packages/integrations/src/imap/index.ts
git commit -m "feat(integrations): imap attachments parse + fetch binary"
```

---

## Task 7: Graph attachments — list + fetch binary

**Files:**

- Create: `packages/integrations/src/graph/attachments.ts`
- Test: `packages/integrations/src/graph/attachments.test.ts`
- Modify: `packages/integrations/src/graph/index.ts` (barrel)

### Steps

- [ ] **Step 1: Write the failing test**

```ts
// packages/integrations/src/graph/attachments.test.ts
import { describe, it, expect, vi } from 'vitest';
import { listGraphAttachments, fetchGraphAttachmentBinary } from './attachments';

vi.mock('./client', () => ({
  async graphFetch(_token: string, path: string, opts: { method?: string; raw?: boolean } = {}) {
    if (path.endsWith('/attachments') && !opts.raw) {
      return {
        value: [
          {
            '@odata.type': '#microsoft.graph.fileAttachment',
            id: 'ATT-1',
            name: 'rapport.pdf',
            contentType: 'application/pdf',
            size: 12345,
            contentId: null,
            isInline: false,
          },
          {
            '@odata.type': '#microsoft.graph.itemAttachment',
            id: 'ATT-2',
            name: 'nested-mail.eml',
          },
          {
            '@odata.type': '#microsoft.graph.fileAttachment',
            id: 'ATT-3',
            name: 'logo.png',
            contentType: 'image/png',
            size: 500,
            contentId: 'logo@ex.com',
            isInline: true,
          },
        ],
      };
    }
    if (path.endsWith('/$value') && opts.raw) {
      return Buffer.from('binary-data');
    }
    return {};
  },
}));

describe('listGraphAttachments', () => {
  it('filters out non-file attachments (itemAttachment, referenceAttachment)', async () => {
    const r = await listGraphAttachments('token', 'MSG-1');
    expect(r).toHaveLength(2);
    expect(r.map((a) => a.id)).toEqual(['ATT-1', 'ATT-3']);
  });

  it('preserves isInline + contentId for cid: references', async () => {
    const r = await listGraphAttachments('token', 'MSG-1');
    const logo = r.find((a) => a.id === 'ATT-3');
    expect(logo?.isInline).toBe(true);
    expect(logo?.contentId).toBe('logo@ex.com');
  });
});

describe('fetchGraphAttachmentBinary', () => {
  it('returns the raw buffer from the $value endpoint', async () => {
    const b = await fetchGraphAttachmentBinary('token', 'MSG-1', 'ATT-1');
    expect(b).toBeInstanceOf(Buffer);
    expect(b?.toString()).toBe('binary-data');
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `packages/integrations/src/graph/attachments.ts`**

Note: the `graphFetch` real signature (from Task 11 of iter 3) is `graphFetch(url_or_path, opts)`. We need to check if it supports raw buffer responses — if not, this task adds a small extension. Read `packages/integrations/src/graph/client.ts` first.

If `graphFetch` doesn't support `raw: true`, add support:

```ts
// In client.ts, extend GraphFetchOptions with raw?: boolean and branch:
if (opts.raw) return Buffer.from(await res.arrayBuffer());
```

Then implement:

```ts
import { graphFetch } from './client';

export interface ParsedGraphAttachment {
  readonly id: string;
  readonly filename: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly contentId: string | null;
  readonly isInline: boolean;
}

interface RawAttachment {
  readonly '@odata.type'?: string;
  readonly id?: string;
  readonly name?: string;
  readonly contentType?: string;
  readonly size?: number;
  readonly contentId?: string | null;
  readonly isInline?: boolean;
}

export async function listGraphAttachments(
  token: string,
  messageId: string,
): Promise<readonly ParsedGraphAttachment[]> {
  const res = (await graphFetch(
    token,
    `/me/messages/${encodeURIComponent(messageId)}/attachments`,
  )) as {
    value?: readonly RawAttachment[];
  };
  const list = res.value ?? [];
  return list
    .filter((a) => a['@odata.type'] === '#microsoft.graph.fileAttachment')
    .map((a) => ({
      id: a.id ?? '',
      filename: a.name ?? 'attachment.bin',
      contentType: a.contentType ?? 'application/octet-stream',
      sizeBytes: a.size ?? 0,
      contentId: a.contentId ?? null,
      isInline: a.isInline ?? false,
    }));
}

export async function fetchGraphAttachmentBinary(
  token: string,
  messageId: string,
  attachmentId: string,
): Promise<Buffer | null> {
  const buf = await graphFetch(
    token,
    `/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}/$value`,
    { raw: true },
  );
  return Buffer.isBuffer(buf) ? buf : null;
}
```

- [ ] **Step 4: Re-export from graph barrel**

In `packages/integrations/src/graph/index.ts`:

```ts
export { listGraphAttachments, fetchGraphAttachmentBinary } from './attachments';
export type { ParsedGraphAttachment } from './attachments';
```

- [ ] **Step 5: Run test — expect PASS (3 tests)**

- [ ] **Step 6: Commit**

```bash
git add packages/integrations/src/graph/ packages/integrations/src/graph/index.ts
git commit -m "feat(integrations): graph attachments list + fetch binary"
```

---

## Task 8: Extend `sync-imap-inbox.ts` — persist attachment metadata

**Files:**

- Modify: `apps/web/features/communications/actions/sync-imap-inbox.ts`
- Modify: `apps/web/features/communications/actions/sync-imap-inbox.test.ts`

### Steps

- [ ] **Step 1: Update the test to expect attachment persistence**

Read the current test file. Add a new test case:

```ts
it('persists attachment metadata + sets hasAttachments when the source has attachments', async () => {
  // arrange the mocked session fetch to return a message with bodyStructure containing an attachment
  const upsertAttachment = vi.fn();
  vi.mock('@nexushub/db' /* … extend to include emailAttachment.upsert */);
  // arrange emailUpsert + parseImapAttachments to yield one attachment
  // …
  await syncImapInbox(integration.id);
  expect(upsertAttachment).toHaveBeenCalled();
  const args = upsertAttachment.mock.calls[0]?.[0];
  expect(args.create).toMatchObject({ filename: '…', storagePath: null, scanStatus: null });
  // Verify EmailMessage.upsert has hasAttachments: true in its create/update
});
```

(The full test setup mirrors the existing `syncImapInbox` tests — extend rather than replace.)

- [ ] **Step 2: Modify `sync-imap-inbox.ts`**

- Extend the ImapFlow `fetch` call to also request `bodyStructure: true`:
  ```ts
  const messages = args.session.fetch(
    range,
    { envelope: true, flags: true, bodyStructure: true },
    { uid: true },
  );
  ```
- Import `parseImapAttachments` from `@nexushub/integrations/imap`.
- For each fetched message, call `parseImapAttachments(m.bodyStructure)` → `attachments: ParsedImapAttachment[]`.
- Pass `attachments` into the existing message upsert code path.
- After the `emailMessage.upsert`, if `attachments.length > 0`:

  ```ts
  await prisma.emailMessage.update({
    where: { id: emailMessageRow.id },
    data: { hasAttachments: true },
  });
  for (const att of attachments) {
    await prisma.emailAttachment.upsert({
      where: {
        emailMessageId_sourceExternalId: {
          emailMessageId: emailMessageRow.id,
          sourceExternalId: att.partNumber,
        },
      },
      create: {
        workspaceId: ctx.workspaceId,
        emailMessageId: emailMessageRow.id,
        filename: att.filename,
        contentType: att.contentType,
        sizeBytes: att.sizeBytes,
        sourceExternalId: att.partNumber,
        ...(att.contentId ? { contentId: att.contentId } : {}),
        isInline: att.isInline,
        // storagePath, scanStatus, scanReport, sha256 stay null — lazy fetch fills them
      },
      update: {
        filename: att.filename,
        contentType: att.contentType,
        sizeBytes: att.sizeBytes,
        ...(att.contentId ? { contentId: att.contentId } : { contentId: null }),
        isInline: att.isInline,
      },
    });
  }
  ```

- [ ] **Step 3: Run test — expect PASS**

- [ ] **Step 4: Commit**

```bash
git add apps/web/features/communications/actions/sync-imap-inbox.ts apps/web/features/communications/actions/sync-imap-inbox.test.ts
git commit -m "feat(comm): sync-imap-inbox persists attachment metadata + hasAttachments"
```

---

## Task 9: Extend `sync-graph-inbox.ts` — persist attachment metadata

**Files:**

- Modify: `apps/web/features/communications/actions/sync-graph-inbox.ts`
- Modify: `apps/web/features/communications/actions/sync-graph-inbox.test.ts`

### Steps

- [ ] **Step 1: Update the test to expect attachment persistence when hasAttachments=true on Graph metadata**

Add a test case similar to Task 8 but using Graph shape — the Graph message has a `hasAttachments: true` flag. When set, `sync-graph-inbox` calls `listGraphAttachments(token, messageExternalId)`, then upserts.

- [ ] **Step 2: Modify `sync-graph-inbox.ts`**

- Import `listGraphAttachments` from `@nexushub/integrations/graph`.
- In the message iteration, after the message upsert:

  ```ts
  if (m.hasAttachments) {
    const attachments = await listGraphAttachments(token, m.externalId);
    if (attachments.length > 0) {
      await prisma.emailMessage.update({
        where: { id: emailMessageRow.id },
        data: { hasAttachments: true },
      });
      for (const att of attachments) {
        await prisma.emailAttachment.upsert({
          where: {
            emailMessageId_sourceExternalId: {
              emailMessageId: emailMessageRow.id,
              sourceExternalId: att.id,
            },
          },
          create: {
            workspaceId: ctx.workspaceId,
            emailMessageId: emailMessageRow.id,
            filename: att.filename,
            contentType: att.contentType,
            sizeBytes: att.sizeBytes,
            sourceExternalId: att.id,
            ...(att.contentId ? { contentId: att.contentId } : {}),
            isInline: att.isInline,
          },
          update: {
            filename: att.filename,
            contentType: att.contentType,
            sizeBytes: att.sizeBytes,
            ...(att.contentId ? { contentId: att.contentId } : { contentId: null }),
            isInline: att.isInline,
          },
        });
      }
    }
  }
  ```

- [ ] **Step 3: Run tests — expect PASS**

- [ ] **Step 4: Commit**

```bash
git add apps/web/features/communications/actions/sync-graph-inbox.ts apps/web/features/communications/actions/sync-graph-inbox.test.ts
git commit -m "feat(comm): sync-graph-inbox persists attachment metadata + hasAttachments"
```

---

## Task 10: Storage helper — upload / signed URL / delete

**Files:**

- Create: `apps/web/lib/mail-attachment-storage.ts`
- Test: `apps/web/lib/mail-attachment-storage.test.ts`

### Steps

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/lib/mail-attachment-storage.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const upload = vi.hoisted(() => vi.fn());
const createSignedUrl = vi.hoisted(() => vi.fn());
const remove = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase/service', () => ({
  supabaseServiceClient: () => ({
    storage: {
      from: () => ({ upload, createSignedUrl, remove }),
    },
  }),
}));

import {
  uploadMailAttachment,
  getMailAttachmentSignedUrl,
  deleteMailAttachment,
} from './mail-attachment-storage';

beforeEach(() => vi.clearAllMocks());

describe('uploadMailAttachment', () => {
  it('uploads with the workspace-scoped path + returns storagePath', async () => {
    upload.mockResolvedValueOnce({ data: { path: 'w1/att-uuid' }, error: null });
    const r = await uploadMailAttachment({
      workspaceId: 'w1',
      attachmentId: 'att-uuid',
      contentType: 'application/pdf',
      binary: Buffer.from('x'),
    });
    expect(r).toEqual({ ok: true, storagePath: 'w1/att-uuid' });
    expect(upload).toHaveBeenCalledWith('w1/att-uuid', expect.any(Buffer), {
      contentType: 'application/pdf',
      upsert: false,
    });
  });

  it('returns error on Storage failure', async () => {
    upload.mockResolvedValueOnce({ data: null, error: { message: 'quota exceeded' } });
    const r = await uploadMailAttachment({
      workspaceId: 'w1',
      attachmentId: 'att-uuid',
      contentType: 'application/pdf',
      binary: Buffer.from('x'),
    });
    expect(r).toEqual({ ok: false, message: expect.any(String) });
  });
});

describe('getMailAttachmentSignedUrl', () => {
  it('returns the signed URL with a 300s TTL', async () => {
    createSignedUrl.mockResolvedValueOnce({
      data: { signedUrl: 'https://…/att?token=…' },
      error: null,
    });
    const r = await getMailAttachmentSignedUrl('w1/att-uuid');
    expect(r).toEqual({ ok: true, signedUrl: 'https://…/att?token=…' });
    expect(createSignedUrl).toHaveBeenCalledWith('w1/att-uuid', 300);
  });
});
```

- [ ] **Step 2: Implement `apps/web/lib/mail-attachment-storage.ts`**

```ts
import 'server-only';
import { supabaseServiceClient } from '@/lib/supabase/service';

const BUCKET = 'mail-attachments';
const SIGNED_URL_TTL_SECONDS = 300;

interface UploadArgs {
  readonly workspaceId: string;
  readonly attachmentId: string;
  readonly contentType: string;
  readonly binary: Buffer;
}

export type UploadResult =
  | { readonly ok: true; readonly storagePath: string }
  | { readonly ok: false; readonly message: string };

export async function uploadMailAttachment(args: UploadArgs): Promise<UploadResult> {
  const path = `${args.workspaceId}/${args.attachmentId}`;
  const { data, error } = await supabaseServiceClient()
    .storage.from(BUCKET)
    .upload(path, args.binary, { contentType: args.contentType, upsert: false });
  if (error || !data) return { ok: false, message: error?.message ?? 'Upload failed' };
  return { ok: true, storagePath: data.path };
}

export type SignedUrlResult =
  | { readonly ok: true; readonly signedUrl: string }
  | { readonly ok: false; readonly message: string };

export async function getMailAttachmentSignedUrl(storagePath: string): Promise<SignedUrlResult> {
  const { data, error } = await supabaseServiceClient()
    .storage.from(BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
  if (error || !data) return { ok: false, message: error?.message ?? 'Sign failed' };
  return { ok: true, signedUrl: data.signedUrl };
}

/**
 * Best-effort delete. Failures are swallowed — callers must not roll back on
 * a delete failure (e.g. draft discard flow).
 */
export async function deleteMailAttachment(storagePath: string): Promise<void> {
  try {
    await supabaseServiceClient().storage.from(BUCKET).remove([storagePath]);
  } catch {
    /* swallow */
  }
}
```

If `@/lib/supabase/service` doesn't exist yet, grep for the existing service-client pattern (should be there from previous iters — Storage was used for avatars V1).

- [ ] **Step 3: Run test — expect PASS**

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/mail-attachment-storage.ts apps/web/lib/mail-attachment-storage.test.ts
git commit -m "feat(comm): mail attachment storage helper (upload / signed URL / delete)"
```

---

## Task 11: Rate-limit keys — mail_attachment_upload + mail_attachment_download

**Files:**

- Modify: `apps/web/lib/rate-limit/index.ts`
- Modify: `apps/web/lib/rate-limit/index.test.ts`

### Steps

- [ ] **Step 1: Extend `RateLimitKey` and `WINDOWS` map**

Add:

```ts
| 'mail_attachment_upload'
| 'mail_attachment_download'
```

In `WINDOWS`:

```ts
mail_attachment_upload:   { limit: 30,  window: '1 h' },
mail_attachment_download: { limit: 100, window: '1 h' },
```

- [ ] **Step 2: Add a test verifying both keys work with the existing in-memory backend**

```ts
it('mail_attachment_upload allows 30 hits then blocks', async () => {
  for (let i = 0; i < 30; i++) {
    const r = await getRateLimiter('mail_attachment_upload').check('u-upload');
    expect(r.success).toBe(true);
  }
  const blocked = await getRateLimiter('mail_attachment_upload').check('u-upload');
  expect(blocked.success).toBe(false);
});

it('mail_attachment_download allows 100 hits then blocks', async () => {
  for (let i = 0; i < 100; i++) {
    const r = await getRateLimiter('mail_attachment_download').check('u-download');
    expect(r.success).toBe(true);
  }
  const blocked = await getRateLimiter('mail_attachment_download').check('u-download');
  expect(blocked.success).toBe(false);
});
```

- [ ] **Step 3: Run tests — expect PASS**

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/rate-limit/index.ts apps/web/lib/rate-limit/index.test.ts
git commit -m "feat(rate-limit): mail_attachment_upload + mail_attachment_download keys"
```

---

## Task 12: `uploadAttachment` server action

**Files:**

- Create: `apps/web/features/communications/actions/upload-attachment.ts`
- Test: `apps/web/features/communications/actions/upload-attachment.test.ts`

### Steps

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/features/communications/actions/upload-attachment.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth', () => ({
  requireUser: vi.fn(async () => ({ userId: 'u', workspaceId: 'w' })),
}));

const rate = vi.hoisted(() => vi.fn());
vi.mock('@/lib/rate-limit', () => ({
  getRateLimiter: () => ({ check: rate }),
}));

const scan = vi.hoisted(() => vi.fn());
vi.mock('@nexushub/integrations/antivirus', () => ({
  scanFileWithVirusTotal: (...a: unknown[]) => scan(...a),
}));

const upload = vi.hoisted(() => vi.fn(async () => ({ ok: true, storagePath: 'w/att-1' })));
vi.mock('@/lib/mail-attachment-storage', () => ({
  uploadMailAttachment: (...a: unknown[]) => upload(...a),
}));

const fromBuffer = vi.hoisted(() => vi.fn(async () => ({ mime: 'application/pdf' })));
vi.mock('file-type', () => ({
  fileTypeFromBuffer: (...a: unknown[]) => fromBuffer(...a),
}));

const findFirstAttachment = vi.hoisted(() => vi.fn());
const auditCreate = vi.hoisted(() => vi.fn());
vi.mock('@nexushub/db', () => ({
  prisma: {
    emailAttachment: { findFirst: findFirstAttachment },
    auditLog: { create: auditCreate },
  },
}));

process.env['VIRUSTOTAL_API_KEY'] = 'test-key';

import { uploadAttachment } from './upload-attachment';

beforeEach(() => vi.clearAllMocks());

function makeFile(name: string, type: string, size: number): File {
  return new File([new Uint8Array(size)], name, { type });
}

describe('uploadAttachment', () => {
  it('rejects when rate-limit exhausted', async () => {
    rate.mockResolvedValueOnce({ success: false, reset: Date.now() + 3600_000 });
    const fd = new FormData();
    fd.append('file', makeFile('a.pdf', 'application/pdf', 100));
    const r = await uploadAttachment(fd);
    expect(r).toEqual({ ok: false, code: 'RATE_LIMIT', message: expect.any(String) });
  });

  it('rejects files > 25 MB', async () => {
    rate.mockResolvedValueOnce({ success: true });
    const fd = new FormData();
    fd.append('file', makeFile('big.pdf', 'application/pdf', 26 * 1024 * 1024));
    const r = await uploadAttachment(fd);
    expect(r).toEqual({ ok: false, code: 'TOO_LARGE', message: expect.any(String) });
  });

  it('rejects blacklisted extensions before scan', async () => {
    rate.mockResolvedValueOnce({ success: true });
    const fd = new FormData();
    fd.append('file', makeFile('virus.exe', 'application/x-msdownload', 100));
    const r = await uploadAttachment(fd);
    expect(r).toEqual({ ok: false, code: 'BLACKLISTED_EXT', message: expect.any(String) });
    expect(scan).not.toHaveBeenCalled();
  });

  it('happy path: clean scan → row + Storage + return AttachmentDraft', async () => {
    rate.mockResolvedValueOnce({ success: true });
    findFirstAttachment.mockResolvedValueOnce(null); // no dedup hit
    scan.mockResolvedValueOnce({ clean: true, verdict: 'clean', stats: {}, analysisId: 'a1' });
    const fd = new FormData();
    fd.append('file', makeFile('rapport.pdf', 'application/pdf', 100));
    const r = await uploadAttachment(fd);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.filename).toBe('rapport.pdf');
      expect(r.contentType).toBe('application/pdf');
      expect(r.sizeBytes).toBe(100);
    }
    expect(scan).toHaveBeenCalledOnce();
    expect(upload).toHaveBeenCalledOnce();
    expect(auditCreate.mock.calls[0]?.[0]).toMatchObject({
      data: { action: 'attachment_uploaded' },
    });
  });

  it('dedup: SHA-256 hit skips VirusTotal and clones the storage path', async () => {
    rate.mockResolvedValueOnce({ success: true });
    findFirstAttachment.mockResolvedValueOnce({
      storagePath: 'w/existing',
      scanReport: { analysisId: 'a-old' },
    });
    const fd = new FormData();
    fd.append('file', makeFile('rapport.pdf', 'application/pdf', 100));
    const r = await uploadAttachment(fd);
    expect(r.ok).toBe(true);
    expect(scan).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it('dirty scan: audit + return code=DIRTY, no Storage put', async () => {
    rate.mockResolvedValueOnce({ success: true });
    findFirstAttachment.mockResolvedValueOnce(null);
    scan.mockResolvedValueOnce({
      clean: false,
      verdict: 'dirty',
      stats: { malicious: 3, suspicious: 0, harmless: 0, undetected: 40 },
      analysisId: 'a-dirty',
      detectingEngines: ['EngineA'],
    });
    const fd = new FormData();
    fd.append('file', makeFile('mal.pdf', 'application/pdf', 100));
    const r = await uploadAttachment(fd);
    expect(r).toMatchObject({ ok: false, code: 'DIRTY' });
    expect(upload).not.toHaveBeenCalled();
    const auditEvent = auditCreate.mock.calls[0]?.[0] as { data: { action: string } };
    expect(auditEvent.data.action).toBe('attachment_scanned_dirty');
  });
});
```

- [ ] **Step 2: Implement `apps/web/features/communications/actions/upload-attachment.ts`**

```ts
'use server';
import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { requireUser } from '@/lib/auth';
import { getRateLimiter } from '@/lib/rate-limit';
import { prisma } from '@nexushub/db';
import { scanFileWithVirusTotal } from '@nexushub/integrations/antivirus';
import { uploadMailAttachment } from '@/lib/mail-attachment-storage';
import { fileTypeFromBuffer } from 'file-type';

const MAX_SIZE_BYTES = 25 * 1024 * 1024;
const BLACKLIST_EXTENSIONS = new Set([
  'exe',
  'msi',
  'bat',
  'cmd',
  'com',
  'scr',
  'js',
  'jar',
  'vbs',
  'ps1',
  'app',
  'dmg',
]);

export type UploadAttachmentResult =
  | {
      readonly ok: true;
      readonly id: string;
      readonly filename: string;
      readonly contentType: string;
      readonly sizeBytes: number;
      readonly sha256: string;
      readonly storagePath: string;
    }
  | {
      readonly ok: false;
      readonly code:
        | 'RATE_LIMIT'
        | 'TOO_LARGE'
        | 'BLACKLISTED_EXT'
        | 'TYPE_SPOOF'
        | 'DIRTY'
        | 'SCAN_FAILED'
        | 'UPLOAD_FAILED'
        | 'INVALID_INPUT';
      readonly message: string;
    };

function sanitizeFilename(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(/[\x00-\x1f/\\]/g, '') // strip control + path separators
    .trim()
    .slice(0, 255);
}

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot === -1) return '';
  return filename.slice(dot + 1).toLowerCase();
}

export async function uploadAttachment(formData: FormData): Promise<UploadAttachmentResult> {
  const ctx = await requireUser();

  // 1. Rate limit
  const rl = getRateLimiter('mail_attachment_upload');
  const rlRes = await rl.check(ctx.userId);
  if (!rlRes.success) {
    return { ok: false, code: 'RATE_LIMIT', message: "Trop d'uploads. Réessaie plus tard." };
  }

  // 2. Parse FormData
  const file = formData.get('file');
  if (!(file instanceof File)) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Fichier manquant.' };
  }
  const filename = sanitizeFilename(file.name || 'attachment.bin');
  if (!filename) return { ok: false, code: 'INVALID_INPUT', message: 'Nom de fichier invalide.' };

  // 3. Size cap
  if (file.size > MAX_SIZE_BYTES) {
    return { ok: false, code: 'TOO_LARGE', message: 'Fichier > 25 MB.' };
  }

  // 4. Extension blacklist (cheap, before scan)
  if (BLACKLIST_EXTENSIONS.has(extensionOf(filename))) {
    await prisma.auditLog.create({
      data: {
        workspaceId: ctx.workspaceId,
        actorId: ctx.userId,
        action: 'attachment_rejected_upload',
        data: { reason: 'ext_blacklist', contentType: file.type, sizeBytes: file.size },
      },
    });
    return { ok: false, code: 'BLACKLISTED_EXT', message: 'Type de fichier bloqué.' };
  }

  const binary = Buffer.from(await file.arrayBuffer());
  const sha256 = createHash('sha256').update(binary).digest('hex');

  // 5. Dedup pre-check (workspace-scoped, clean-only)
  const dedup = await prisma.emailAttachment.findFirst({
    where: {
      workspaceId: ctx.workspaceId,
      sha256,
      scanStatus: 'clean',
      storagePath: { not: null },
    },
    select: { storagePath: true, scanReport: true },
  });
  if (dedup && dedup.storagePath) {
    const id = randomUUID();
    await prisma.auditLog.create({
      data: {
        workspaceId: ctx.workspaceId,
        actorId: ctx.userId,
        action: 'attachment_uploaded',
        data: { contentType: file.type, sizeBytes: file.size, sha256, deduped: true },
      },
    });
    return {
      ok: true,
      id,
      filename,
      contentType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
      sha256,
      storagePath: dedup.storagePath,
    };
  }

  // 6. Magic-byte content-type sniff
  const sniffed = await fileTypeFromBuffer(binary);
  const declaredType = file.type || 'application/octet-stream';
  // Some types have no magic bytes (plain text). Only reject on active mismatch.
  if (sniffed && sniffed.mime !== declaredType) {
    await prisma.auditLog.create({
      data: {
        workspaceId: ctx.workspaceId,
        actorId: ctx.userId,
        action: 'attachment_rejected_upload',
        data: {
          reason: 'type_spoof',
          declaredType,
          sniffedType: sniffed.mime,
          sizeBytes: file.size,
        },
      },
    });
    return { ok: false, code: 'TYPE_SPOOF', message: 'Type de fichier suspect (sniff mismatch).' };
  }

  // 7. VirusTotal scan
  const apiKey = process.env['VIRUSTOTAL_API_KEY'];
  if (!apiKey) {
    return { ok: false, code: 'SCAN_FAILED', message: 'Antivirus non configuré.' };
  }
  const scan = await scanFileWithVirusTotal(binary, apiKey);
  if (scan.verdict !== 'clean') {
    await prisma.auditLog.create({
      data: {
        workspaceId: ctx.workspaceId,
        actorId: ctx.userId,
        action: 'attachment_scanned_dirty',
        data: {
          filename, // investigation-only — logged here per spec §9
          contentType: declaredType,
          sha256,
          detectingEngines: scan.detectingEngines ?? [],
        },
      },
    });
    return {
      ok: false,
      code: scan.verdict === 'dirty' ? 'DIRTY' : 'SCAN_FAILED',
      message: "Fichier rejeté par l'antivirus.",
    };
  }

  // 8. Upload to Storage
  const id = randomUUID();
  const uploadResult = await uploadMailAttachment({
    workspaceId: ctx.workspaceId,
    attachmentId: id,
    contentType: declaredType,
    binary,
  });
  if (!uploadResult.ok) {
    return { ok: false, code: 'UPLOAD_FAILED', message: uploadResult.message };
  }

  await prisma.auditLog.create({
    data: {
      workspaceId: ctx.workspaceId,
      actorId: ctx.userId,
      action: 'attachment_uploaded',
      data: { contentType: declaredType, sizeBytes: file.size, sha256 },
    },
  });

  return {
    ok: true,
    id,
    filename,
    contentType: declaredType,
    sizeBytes: file.size,
    sha256,
    storagePath: uploadResult.storagePath,
  };
}
```

- [ ] **Step 3: Run tests — expect PASS (6 tests)**

- [ ] **Step 4: Commit**

```bash
git add apps/web/features/communications/actions/upload-attachment.ts apps/web/features/communications/actions/upload-attachment.test.ts
git commit -m "feat(comm): uploadAttachment server action (scan + dedup + Storage + audit)"
```

---

## Task 13: Drafts CRUD extension — composeAttachments field

**Files:**

- Modify: `apps/web/features/communications/actions/mail-drafts.ts`
- Modify: `apps/web/features/communications/actions/mail-drafts.test.ts`
- Create: `apps/web/features/communications/actions/remove-attachment-from-draft.ts`

### Steps

- [ ] **Step 1: Extend `saveSchema` in `mail-drafts.ts`**

Add an `attachmentDraftSchema` at the top of the file:

```ts
const attachmentDraftSchema = z.object({
  id: z.string().uuid(),
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(255),
  sizeBytes: z
    .number()
    .int()
    .nonnegative()
    .max(25 * 1024 * 1024),
  storagePath: z.string().min(1),
  sha256: z.string().length(64),
  reprisedFromAttachmentId: z.string().uuid().optional(),
});

export type AttachmentDraft = z.infer<typeof attachmentDraftSchema>;
```

Extend `saveSchema`:

```ts
composeAttachments: z.array(attachmentDraftSchema).max(20).default([]),
```

Extend the `saveDraft` action's Prisma call:

```ts
// In create + update payloads:
composeAttachments: parsed.composeAttachments as unknown as import('@prisma/client').Prisma.InputJsonValue,
```

Extend `DraftDto` + `loadDraft` output to include `composeAttachments: readonly AttachmentDraft[]`.

- [ ] **Step 2: Add tests for the new field**

```ts
it('saveDraft persists composeAttachments', async () => {
  upsert.mockResolvedValueOnce({ id: 'd1' });
  const r = await saveDraft({
    fromIntegrationId: '00000000-0000-0000-0000-000000000000',
    kind: 'new_mail',
    toRecipients: [],
    ccRecipients: [],
    bccRecipients: [],
    subject: '',
    bodyHtml: '',
    composeAttachments: [
      {
        id: '00000000-0000-0000-0000-000000000001',
        filename: 'a.pdf',
        contentType: 'application/pdf',
        sizeBytes: 100,
        storagePath: 'w/00000000-0000-0000-0000-000000000001',
        sha256: 'a'.repeat(64),
      },
    ],
  });
  expect(r).toEqual({ ok: true, id: 'd1' });
  const created = upsert.mock.calls[0]?.[0] as { create: { composeAttachments: unknown[] } };
  expect(created.create.composeAttachments).toHaveLength(1);
});

it('rejects saveDraft with > 20 attachments', async () => {
  const many = Array.from({ length: 21 }, (_, i) => ({
    id: '00000000-0000-0000-0000-' + String(i).padStart(12, '0'),
    filename: `a${i}.pdf`,
    contentType: 'application/pdf',
    sizeBytes: 100,
    storagePath: `w/00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
    sha256: 'a'.repeat(64),
  }));
  await expect(
    saveDraft({
      fromIntegrationId: '00000000-0000-0000-0000-000000000000',
      kind: 'new_mail',
      toRecipients: [],
      ccRecipients: [],
      bccRecipients: [],
      subject: '',
      bodyHtml: '',
      composeAttachments: many,
    }),
  ).rejects.toBeDefined();
});
```

- [ ] **Step 3: Create `remove-attachment-from-draft.ts`**

```ts
'use server';
import 'server-only';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { prisma } from '@nexushub/db';
import { deleteMailAttachment } from '@/lib/mail-attachment-storage';

const inputSchema = z.object({ attachmentDraftId: z.string().uuid() });

export async function removeAttachmentFromDraft(
  raw: z.infer<typeof inputSchema>,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const ctx = await requireUser();
  const parsed = inputSchema.parse(raw);
  const draft = await prisma.mailDraft.findFirst({
    where: { workspaceId: ctx.workspaceId, userId: ctx.userId },
    select: { id: true, composeAttachments: true },
  });
  if (!draft) return { ok: false, message: 'Aucun brouillon.' };

  const list =
    (draft.composeAttachments as unknown as Array<{
      id: string;
      storagePath: string;
      reprisedFromAttachmentId?: string;
    }>) ?? [];
  const target = list.find((a) => a.id === parsed.attachmentDraftId);
  if (!target) return { ok: false, message: 'Pièce jointe introuvable dans le brouillon.' };

  const remaining = list.filter((a) => a.id !== parsed.attachmentDraftId);
  await prisma.mailDraft.update({
    where: { id: draft.id },
    data: {
      composeAttachments: remaining as unknown as import('@prisma/client').Prisma.InputJsonValue,
    },
  });

  // Best-effort Storage delete — only for fresh uploads (not Forward reprises).
  if (!target.reprisedFromAttachmentId) {
    await deleteMailAttachment(target.storagePath);
  }
  return { ok: true };
}
```

- [ ] **Step 4: Add a test for `removeAttachmentFromDraft`**

Standard mock pattern — verify Storage delete is called for fresh uploads, NOT called for reprise entries.

- [ ] **Step 5: Also extend `deleteDraft` to best-effort Storage-delete every non-reprise attachment**

In `deleteDraft`, before the `deleteMany` call, load the draft's `composeAttachments`, iterate, delete Storage for entries without `reprisedFromAttachmentId`.

- [ ] **Step 6: Run tests — expect PASS**

- [ ] **Step 7: Commit**

```bash
git add apps/web/features/communications/actions/mail-drafts.ts apps/web/features/communications/actions/mail-drafts.test.ts apps/web/features/communications/actions/remove-attachment-from-draft.ts apps/web/features/communications/actions/remove-attachment-from-draft.test.ts
git commit -m "feat(comm): mail draft composeAttachments field + removeAttachmentFromDraft"
```

---

## Task 14: `fetchAttachmentBinary` server action (lazy fetch + scan + cache)

**Files:**

- Create: `apps/web/features/communications/actions/fetch-attachment.ts`
- Test: `apps/web/features/communications/actions/fetch-attachment.test.ts`

### Steps

- [ ] **Step 1: Write the failing test — cover the 3 paths (cached clean, cached dirty, lazy fetch happy path)**

Mirror the mock setup pattern from previous tests (`get-valid-imap-credentials`, `sync-imap-inbox`). Mock Prisma emailAttachment find/update, Storage helpers, adapter fetches, VirusTotal.

- [ ] **Step 2: Implement `fetch-attachment.ts`**

Structure follows spec §6.2 exactly:

```ts
'use server';
import 'server-only';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { requireUser } from '@/lib/auth';
import { getRateLimiter } from '@/lib/rate-limit';
import { prisma } from '@nexushub/db';
import { scanFileWithVirusTotal } from '@nexushub/integrations/antivirus';
import { fetchImapAttachmentBinary, openImapSession } from '@nexushub/integrations/imap';
import { fetchGraphAttachmentBinary } from '@nexushub/integrations/graph';
import { getValidImapCredentials } from '@/features/integrations/lib/get-valid-imap-credentials';
import { getValidAccessToken } from '@/features/integrations/lib/get-valid-access-token';
import { uploadMailAttachment, getMailAttachmentSignedUrl } from '@/lib/mail-attachment-storage';
import { fileTypeFromBuffer } from 'file-type';

const inputSchema = z.object({ attachmentId: z.string().uuid() });

export type FetchAttachmentResult =
  | {
      readonly ok: true;
      readonly signedUrl: string;
      readonly expiresAt: number;
      readonly filename: string;
    }
  | {
      readonly ok: false;
      readonly code: 'NOT_FOUND' | 'DIRTY' | 'SCAN_FAILED' | 'FETCH_FAILED' | 'RATE_LIMIT';
      readonly message: string;
    };

export async function fetchAttachmentBinary(
  raw: z.infer<typeof inputSchema>,
): Promise<FetchAttachmentResult> {
  const ctx = await requireUser();
  const parsed = inputSchema.parse(raw);

  const rl = getRateLimiter('mail_attachment_download');
  if (!(await rl.check(ctx.userId)).success) {
    return {
      ok: false,
      code: 'RATE_LIMIT',
      message: 'Trop de téléchargements. Réessaie plus tard.',
    };
  }

  // Ownership: workspace + mailbox-owner
  const att = await prisma.emailAttachment.findFirst({
    where: {
      id: parsed.attachmentId,
      workspaceId: ctx.workspaceId,
      emailMessage: { integration: { ownerUserId: ctx.userId } },
    },
    select: {
      id: true,
      filename: true,
      contentType: true,
      sizeBytes: true,
      sourceExternalId: true,
      storagePath: true,
      scanStatus: true,
      emailMessage: {
        select: {
          externalId: true,
          integration: { select: { id: true, kind: true } },
        },
      },
    },
  });
  if (!att) return { ok: false, code: 'NOT_FOUND', message: 'Pièce jointe introuvable.' };

  // Cached + clean → immediate signed URL
  if (att.storagePath && att.scanStatus === 'clean') {
    const s = await getMailAttachmentSignedUrl(att.storagePath);
    if (!s.ok) return { ok: false, code: 'FETCH_FAILED', message: s.message };
    return {
      ok: true,
      signedUrl: s.signedUrl,
      expiresAt: Date.now() + 300_000,
      filename: att.filename,
    };
  }

  // Cached dirty / scan_failed → refuse
  if (att.scanStatus === 'dirty' || att.scanStatus === 'scan_failed') {
    return {
      ok: false,
      code: 'DIRTY',
      message: 'Cette pièce jointe a été rejetée par le scan antivirus.',
    };
  }

  // Lazy fetch from source
  let binary: Buffer | null = null;
  try {
    if (att.emailMessage.integration.kind === 'graph') {
      const token = await getValidAccessToken(att.emailMessage.integration.id);
      binary = await fetchGraphAttachmentBinary(
        token,
        att.emailMessage.externalId,
        att.sourceExternalId,
      );
    } else {
      const creds = await getValidImapCredentials({
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
        integrationId: att.emailMessage.integration.id,
      });
      const session = await openImapSession(creds.imap);
      try {
        binary = await fetchImapAttachmentBinary(
          session,
          Number(att.emailMessage.externalId),
          att.sourceExternalId,
        );
      } finally {
        try {
          await session.logout();
        } catch {
          /* swallow */
        }
      }
    }
  } catch (err) {
    return {
      ok: false,
      code: 'FETCH_FAILED',
      message: err instanceof Error ? err.message : 'Fetch failed',
    };
  }

  if (!binary)
    return { ok: false, code: 'FETCH_FAILED', message: 'Binaire indisponible côté serveur.' };

  // Size mismatch check
  if (binary.byteLength !== att.sizeBytes) {
    await prisma.auditLog.create({
      data: {
        workspaceId: ctx.workspaceId,
        actorId: ctx.userId,
        action: 'attachment_rejected_upload',
        data: { reason: 'size_mismatch', declared: att.sizeBytes, actual: binary.byteLength },
      },
    });
    return {
      ok: false,
      code: 'FETCH_FAILED',
      message: 'Taille du fichier ne correspond pas à la déclaration.',
    };
  }

  const sha256 = createHash('sha256').update(binary).digest('hex');

  // Dedup — same binary already clean in the workspace?
  const dedup = await prisma.emailAttachment.findFirst({
    where: {
      workspaceId: ctx.workspaceId,
      sha256,
      scanStatus: 'clean',
      storagePath: { not: null },
    },
    select: { storagePath: true, scanReport: true },
  });
  if (dedup && dedup.storagePath) {
    await prisma.emailAttachment.update({
      where: { id: att.id },
      data: {
        storagePath: dedup.storagePath,
        scanStatus: 'clean',
        scanReport: dedup.scanReport,
        sha256,
      },
    });
    const s = await getMailAttachmentSignedUrl(dedup.storagePath);
    return s.ok
      ? {
          ok: true,
          signedUrl: s.signedUrl,
          expiresAt: Date.now() + 300_000,
          filename: att.filename,
        }
      : { ok: false, code: 'FETCH_FAILED', message: s.message };
  }

  // Magic-byte sniff — reject on active mismatch with declared
  const sniffed = await fileTypeFromBuffer(binary);
  if (sniffed && sniffed.mime !== att.contentType) {
    await prisma.emailAttachment.update({
      where: { id: att.id },
      data: {
        scanStatus: 'dirty',
        scanReport: {
          reason: 'type_spoof',
          declaredType: att.contentType,
          sniffedType: sniffed.mime,
        },
      },
    });
    return { ok: false, code: 'DIRTY', message: 'Type de fichier suspect (sniff mismatch).' };
  }

  // Scan
  const apiKey = process.env['VIRUSTOTAL_API_KEY'];
  if (!apiKey) return { ok: false, code: 'SCAN_FAILED', message: 'Antivirus non configuré.' };
  const scan = await scanFileWithVirusTotal(binary, apiKey);
  if (scan.verdict !== 'clean') {
    await prisma.emailAttachment.update({
      where: { id: att.id },
      data: {
        scanStatus: scan.verdict === 'dirty' ? 'dirty' : 'scan_failed',
        scanReport: {
          analysisId: scan.analysisId,
          stats: scan.stats,
          detectingEngines: scan.detectingEngines,
        },
        sha256,
      },
    });
    await prisma.auditLog.create({
      data: {
        workspaceId: ctx.workspaceId,
        actorId: ctx.userId,
        action: 'attachment_scanned_dirty',
        data: {
          filename: att.filename,
          contentType: att.contentType,
          sha256,
          detectingEngines: scan.detectingEngines ?? [],
        },
      },
    });
    return {
      ok: false,
      code: 'DIRTY',
      message: 'Cette pièce jointe a été rejetée par le scan antivirus.',
    };
  }

  // Upload to Storage
  const uploadResult = await uploadMailAttachment({
    workspaceId: ctx.workspaceId,
    attachmentId: att.id,
    contentType: att.contentType,
    binary,
  });
  if (!uploadResult.ok) return { ok: false, code: 'FETCH_FAILED', message: uploadResult.message };

  await prisma.emailAttachment.update({
    where: { id: att.id },
    data: {
      storagePath: uploadResult.storagePath,
      scanStatus: 'clean',
      scanReport: { analysisId: scan.analysisId, stats: scan.stats },
      sha256,
    },
  });
  await prisma.auditLog.create({
    data: {
      workspaceId: ctx.workspaceId,
      actorId: ctx.userId,
      action: 'attachment_downloaded',
      data: { attachmentId: att.id, integrationId: att.emailMessage.integration.id },
    },
  });

  const s = await getMailAttachmentSignedUrl(uploadResult.storagePath);
  return s.ok
    ? { ok: true, signedUrl: s.signedUrl, expiresAt: Date.now() + 300_000, filename: att.filename }
    : { ok: false, code: 'FETCH_FAILED', message: s.message };
}
```

- [ ] **Step 3: Run tests — expect PASS**

- [ ] **Step 4: Commit**

```bash
git add apps/web/features/communications/actions/fetch-attachment.ts apps/web/features/communications/actions/fetch-attachment.test.ts
git commit -m "feat(comm): fetchAttachmentBinary — lazy fetch + scan + Storage cache"
```

---

## Task 15: Extend `sendViaGraph` + `sendViaSmtp` for attachments

**Files:**

- Modify: `packages/integrations/src/graph/send.ts`
- Modify: `packages/integrations/src/graph/send.test.ts`
- Modify: `packages/integrations/src/smtp/send.ts`
- Modify: `packages/integrations/src/smtp/send.test.ts`

### Steps

- [ ] **Step 1: Extend `SmtpSendPayload` with `attachments`**

```ts
export interface SmtpAttachment {
  readonly filename: string;
  readonly contentType: string;
  readonly content: Buffer;
}

export interface SmtpSendPayload {
  // … existing fields
  readonly attachments?: readonly SmtpAttachment[];
}
```

In `sendViaSmtp`, pass through to nodemailer:

```ts
...(payload.attachments && payload.attachments.length > 0
  ? { attachments: [...payload.attachments] }
  : {}),
```

Add a test:

```ts
it('passes attachments to nodemailer', async () => {
  let captured: Record<string, unknown> = {};
  const t = {
    async sendMail(mail: Record<string, unknown>) {
      captured = mail;
      return { messageId: '<id>', accepted: [], rejected: [], response: '250' };
    },
    async close() {},
  };
  await sendViaSmtp(t as never, {
    from: 'me@ex.com',
    to: ['you@ex.com'],
    cc: [],
    bcc: [],
    subject: 'Hi',
    html: '<p>x</p>',
    text: 'x',
    attachments: [
      { filename: 'a.pdf', contentType: 'application/pdf', content: Buffer.from('data') },
    ],
  });
  expect(captured['attachments']).toHaveLength(1);
});
```

- [ ] **Step 2: Extend `GraphSendPayload` with `attachments`**

```ts
export interface GraphAttachment {
  readonly filename: string;
  readonly contentType: string;
  readonly content: Buffer;
}

export interface GraphSendPayload {
  // … existing fields
  readonly attachments?: readonly GraphAttachment[];
}
```

**Add the size check**: if sum of `attachments[*].content.byteLength` > 3 MB, throw a typed error `GraphPayloadTooLargeError` (new class). `sendMail` orchestrator (Task 16) maps this to `SEND_FAILED_TOO_LARGE`.

```ts
export class GraphPayloadTooLargeError extends Error {
  override readonly cause?: unknown;
  constructor(totalBytes: number, cause?: unknown) {
    super(`Graph attachments payload too large: ${totalBytes} bytes (max 3 MB)`);
    this.name = 'GraphPayloadTooLargeError';
    this.cause = cause;
  }
}

const GRAPH_ATTACHMENT_LIMIT_BYTES = 3 * 1024 * 1024;
```

In `sendViaGraph`, for the `/sendMail` path only (new mails), if attachments present:

- Sum sizes, throw `GraphPayloadTooLargeError` if > limit.
- Otherwise, append to `message.attachments`:
  ```ts
  attachments: payload.attachments.map((a) => ({
    '@odata.type': '#microsoft.graph.fileAttachment',
    name: a.filename,
    contentType: a.contentType,
    contentBytes: a.content.toString('base64'),
  })),
  ```
- For the `/reply` `/replyAll` `/forward` paths (existing threading endpoints), Graph doesn't accept attachments in the same payload — deferred to V2 (create draft, add attachments, send). For V1.5, log a warning: **Reply/Forward with attachments via Graph = attachments dropped**. Documented in the runbook.

Actually — this is a real user-facing loss. Better: in the orchestrator (Task 16), if `integration.kind === 'graph'` AND `mode !== 'new_mail'` AND `attachments.length > 0`, force the send through the `/sendMail` path WITHOUT the threading endpoint (loses Graph's server-side threading but preserves attachments). Document the trade-off.

Simplest V1.5: reject with `SEND_FAILED` code `GRAPH_REPLY_ATTACHMENTS_UNSUPPORTED` and tell the user to compose a new mail. Note as V2 follow-up.

Update the test to cover both new-mail-with-attachments (happy) and reply-with-attachments (rejected, or forced through fallback).

- [ ] **Step 3: Run tests — expect PASS**

- [ ] **Step 4: Commit**

```bash
git add packages/integrations/src/graph/send.ts packages/integrations/src/graph/send.test.ts packages/integrations/src/smtp/send.ts packages/integrations/src/smtp/send.test.ts
git commit -m "feat(integrations): graph + smtp send with attachments (Graph 3MB cap)"
```

---

## Task 16: Extend `send-mail.ts` orchestrator + after-send row creation

**Files:**

- Modify: `apps/web/features/communications/actions/send-mail.ts`
- Modify: `apps/web/features/communications/actions/send-mail.test.ts`
- Modify: `apps/web/features/communications/actions/send-mail-imap.ts`
- Modify: `apps/web/features/communications/actions/send-mail-imap.test.ts`

### Steps

- [ ] **Step 1: Extend `sendMailSchema` with `composeAttachments`**

```ts
composeAttachments: z.array(attachmentDraftSchema).max(20).default([]);
```

Import `attachmentDraftSchema` from `./mail-drafts` (or copy the Zod schema — DRY the shape).

- [ ] **Step 2: Extend `SendMailResult` union**

```ts
| { readonly ok: false; readonly code: 'SEND_FAILED_TOO_LARGE'; readonly message: string; readonly emailMessageId?: string }
| { readonly ok: false; readonly code: 'GRAPH_REPLY_ATTACHMENTS_UNSUPPORTED'; readonly message: string }
```

- [ ] **Step 3: Extend the dispatch to pull binaries from Storage + pass to adapters**

Before calling `sendViaGraph` / `sendViaImapSmtp`, for each attachment in `composeAttachments`:

```ts
async function loadAttachmentBinaries(
  list: readonly AttachmentDraft[],
): Promise<Array<{ filename: string; contentType: string; content: Buffer }>> {
  const out: Array<{ filename: string; contentType: string; content: Buffer }> = [];
  for (const a of list) {
    // Download from Storage via signed URL (service role can bypass signing but simpler to fetch)
    const { data, error } = await supabaseServiceClient()
      .storage.from('mail-attachments')
      .download(a.storagePath);
    if (error || !data)
      throw new Error(`Failed to load attachment ${a.filename}: ${error?.message ?? 'unknown'}`);
    const buffer = Buffer.from(await data.arrayBuffer());
    out.push({ filename: a.filename, contentType: a.contentType, content: buffer });
  }
  return out;
}
```

Pass to the adapter:

- Graph: `sendViaGraph(token, { …existing, attachments: loadedAttachments })` — if `mode !== 'new_mail'` AND attachments present, return `GRAPH_REPLY_ATTACHMENTS_UNSUPPORTED`. Catch `GraphPayloadTooLargeError` → return `SEND_FAILED_TOO_LARGE`.
- IMAP: `sendViaImapSmtp(…, payload with attachments)`.

- [ ] **Step 4: After successful send — create `EmailAttachment` rows**

```ts
for (const a of composeAttachments) {
  await prisma.emailAttachment.create({
    data: {
      // If reprise: clone storagePath, sha256, scan_status='clean' from source
      // (source row was already scanned)
      id: a.id,
      workspaceId: ctx.workspaceId,
      emailMessageId: outboxRow.id,
      filename: a.filename,
      contentType: a.contentType,
      sizeBytes: a.sizeBytes,
      sourceExternalId: a.id, // for outbox rows, same as our uuid
      contentId: null,
      isInline: false,
      storagePath: a.storagePath,
      scanStatus: 'clean',
      scanReport: {
        deduped: Boolean(a.reprisedFromAttachmentId),
      } as unknown as import('@prisma/client').Prisma.InputJsonValue,
      sha256: a.sha256,
    },
  });
}
if (composeAttachments.length > 0) {
  await prisma.emailMessage.update({
    where: { id: outboxRow.id },
    data: { hasAttachments: true },
  });
}
```

Note: `id: a.id` reuses the UUID from the `AttachmentDraft` — this way the Storage object at `<workspaceId>/<a.id>` maps 1:1 to the `EmailAttachment.id`. For reprise entries, `a.id` is a fresh UUID (client-generated on load) BUT `storagePath` points to the original source's path. The clone in DB shares the Storage path — the row is new, the binary is shared. `id` matches `sourceExternalId` for consistency (search convention).

Actually the reprise handling in Task 17 will need `reprisedFromAttachmentId` recorded somewhere for traceability. Add a JSONB field `scanReport.reprisedFrom: string`. Not a first-class column since V1.5.

- [ ] **Step 5: Update tests**

Add cases:

- Send with 2 attachments → EmailAttachment rows created, hasAttachments flipped.
- Send Graph reply with attachments → `GRAPH_REPLY_ATTACHMENTS_UNSUPPORTED`.
- Send Graph new-mail with attachments > 3 MB → `SEND_FAILED_TOO_LARGE`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/features/communications/actions/send-mail.ts apps/web/features/communications/actions/send-mail.test.ts apps/web/features/communications/actions/send-mail-imap.ts apps/web/features/communications/actions/send-mail-imap.test.ts
git commit -m "feat(comm): send-mail with attachments (Graph 3MB cap + Reply limitation)"
```

---

## Task 17: `loadForwardAttachments` server action

**Files:**

- Create: `apps/web/features/communications/actions/load-forward-attachments.ts`
- Test: `apps/web/features/communications/actions/load-forward-attachments.test.ts`

### Steps

- [ ] **Step 1: Write the failing test — 3 cases: all cached clean, mix of cached + non-cached (triggers lazy fetch), skip dirty**

Standard mock pattern. Verify the return shape is an array of `AttachmentDraft` records with `reprisedFromAttachmentId` set.

- [ ] **Step 2: Implement**

```ts
'use server';
import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { prisma } from '@nexushub/db';
import { fetchAttachmentBinary } from './fetch-attachment';

const inputSchema = z.object({ replyToId: z.string().uuid() });

interface RepriseEntry {
  readonly id: string;
  readonly filename: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly storagePath: string;
  readonly sha256: string;
  readonly reprisedFromAttachmentId: string;
}

export async function loadForwardAttachments(
  raw: z.infer<typeof inputSchema>,
): Promise<
  | { readonly ok: true; readonly attachments: readonly RepriseEntry[] }
  | { readonly ok: false; readonly message: string }
> {
  const ctx = await requireUser();
  const parsed = inputSchema.parse(raw);

  // Ownership via mailbox owner
  const message = await prisma.emailMessage.findFirst({
    where: {
      id: parsed.replyToId,
      workspaceId: ctx.workspaceId,
      integration: { ownerUserId: ctx.userId },
    },
    select: {
      emailAttachments: {
        where: { isInline: false }, // inline images stay in quoted HTML
        select: {
          id: true,
          filename: true,
          contentType: true,
          sizeBytes: true,
          storagePath: true,
          sha256: true,
          scanStatus: true,
        },
      },
    },
  });
  if (!message) return { ok: false, message: 'Mail introuvable.' };

  const out: RepriseEntry[] = [];
  for (const att of message.emailAttachments) {
    // Skip dirty
    if (att.scanStatus === 'dirty' || att.scanStatus === 'scan_failed') continue;

    // Trigger lazy fetch if not cached — this call updates the row in place
    if (!att.storagePath || att.scanStatus !== 'clean') {
      const r = await fetchAttachmentBinary({ attachmentId: att.id });
      if (!r.ok) continue; // skip failed/dirty
    }

    // Re-load after potential lazy fetch to get fresh storagePath + sha256
    const fresh = await prisma.emailAttachment.findFirst({
      where: { id: att.id },
      select: { storagePath: true, sha256: true },
    });
    if (!fresh?.storagePath || !fresh.sha256) continue;

    out.push({
      id: randomUUID(),
      filename: att.filename,
      contentType: att.contentType,
      sizeBytes: att.sizeBytes,
      storagePath: fresh.storagePath, // shared with source
      sha256: fresh.sha256,
      reprisedFromAttachmentId: att.id,
    });
  }

  return { ok: true, attachments: out };
}
```

- [ ] **Step 3: Run tests — expect PASS**

- [ ] **Step 4: Commit**

```bash
git add apps/web/features/communications/actions/load-forward-attachments.ts apps/web/features/communications/actions/load-forward-attachments.test.ts
git commit -m "feat(comm): loadForwardAttachments — auto-reprise on Forward"
```

---

## Task 18: `AttachmentDrop` UI component

**Files:**

- Create: `apps/web/features/communications/components/attachment-drop.tsx`
- Create: `apps/web/features/communications/hooks/use-attachment-uploader.ts`
- Create: `apps/web/features/communications/lib/attachment-format.ts` (shared `iconFor` + `formatBytes`, reused by Task 20's MailAttachmentRow)

### Steps

- [ ] **Step 1a: Create the shared display helpers**

`apps/web/features/communications/lib/attachment-format.ts`:

```ts
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function iconFor(contentType: string): string {
  if (contentType.startsWith('image/')) return '🖼';
  if (contentType === 'application/pdf') return '📄';
  if (contentType.includes('sheet') || contentType.includes('excel')) return '📊';
  if (contentType.includes('word') || contentType === 'text/plain') return '📝';
  if (contentType.includes('zip') || contentType.includes('compress')) return '📦';
  return '📎';
}
```

- [ ] **Step 1: Create the hook `use-attachment-uploader.ts`**

Handles the per-file state machine, parallel upload, 20-file cap.

```tsx
'use client';
import { useState, useCallback } from 'react';
import { uploadAttachment } from '../actions/upload-attachment';

export type AttachmentUploadState = 'uploading' | 'clean' | 'dirty' | 'error';

export interface UploadedAttachment {
  readonly id: string;
  readonly filename: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly storagePath: string;
  readonly sha256: string;
  readonly state: AttachmentUploadState;
  readonly error?: string;
}

const MAX_ATTACHMENTS = 20;

export function useAttachmentUploader() {
  const [items, setItems] = useState<readonly UploadedAttachment[]>([]);

  const addFiles = useCallback(
    async (files: readonly File[]) => {
      const remaining = MAX_ATTACHMENTS - items.length;
      const accepted = files.slice(0, remaining);
      const rejected = files.length - accepted.length;
      if (rejected > 0) {
        // Notify caller — leave the toast to the ComposePanel
      }

      // Add placeholder entries with `uploading` state
      const placeholders = accepted.map((f, i) => ({
        id: `pending-${Date.now()}-${i}`,
        filename: f.name,
        contentType: f.type || 'application/octet-stream',
        sizeBytes: f.size,
        storagePath: '',
        sha256: '',
        state: 'uploading' as const,
      }));
      setItems((prev) => [...prev, ...placeholders]);

      // Fire uploads in parallel
      const results = await Promise.allSettled(
        accepted.map(async (file) => {
          const fd = new FormData();
          fd.append('file', file);
          return uploadAttachment(fd);
        }),
      );

      // Merge results back into state
      setItems((prev) => {
        const next = [...prev];
        results.forEach((res, i) => {
          const placeholderId = placeholders[i]?.id;
          if (!placeholderId) return;
          const idx = next.findIndex((x) => x.id === placeholderId);
          if (idx === -1) return;
          if (res.status === 'fulfilled' && res.value.ok) {
            next[idx] = {
              id: res.value.id,
              filename: res.value.filename,
              contentType: res.value.contentType,
              sizeBytes: res.value.sizeBytes,
              storagePath: res.value.storagePath,
              sha256: res.value.sha256,
              state: 'clean',
            };
          } else if (res.status === 'fulfilled' && !res.value.ok) {
            next[idx] = {
              ...next[idx]!,
              state: res.value.code === 'DIRTY' ? 'dirty' : 'error',
              error: res.value.message,
            };
          } else {
            next[idx] = { ...next[idx]!, state: 'error', error: String(res.reason) };
          }
        });
        return next;
      });

      return { accepted: accepted.length, rejected };
    },
    [items.length],
  );

  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const clearAll = useCallback(() => setItems([]), []);

  const setInitial = useCallback((preloaded: readonly UploadedAttachment[]) => {
    setItems(preloaded);
  }, []);

  return {
    items,
    addFiles,
    removeItem,
    clearAll,
    setInitial,
    totalBytes: items.reduce((s, x) => s + x.sizeBytes, 0),
  };
}
```

- [ ] **Step 2: Implement `attachment-drop.tsx`**

```tsx
'use client';
import { useRef, useCallback } from 'react';
import type { UploadedAttachment } from '../hooks/use-attachment-uploader';
import { formatBytes, iconFor } from '../lib/attachment-format';

const MAX_MAIL_BYTES = 25 * 1024 * 1024;

interface Props {
  readonly items: readonly UploadedAttachment[];
  readonly totalBytes: number;
  readonly onDrop: (files: readonly File[]) => Promise<void>;
  readonly onRemove: (id: string) => void;
}

export function AttachmentDrop({ items, totalBytes, onDrop, onRemove }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList) return;
      const arr = Array.from(fileList);
      void onDrop(arr);
    },
    [onDrop],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles],
  );

  return (
    <div className="mt-2">
      {items.length > 0 ? (
        <div className="mb-2 flex items-center justify-between text-xs text-[color:var(--color-text-muted)]">
          <span>
            📎 Pièces jointes ({items.length} · {formatBytes(totalBytes)} / 25 MB)
          </span>
          {totalBytes > MAX_MAIL_BYTES ? (
            <span className="text-[color:var(--color-danger)]">⚠ Dépasse 25 MB</span>
          ) : null}
        </div>
      ) : null}
      <ul className="mb-2 flex flex-col gap-1">
        {items.map((it) => (
          <li
            key={it.id}
            className={`flex items-center justify-between rounded border px-2 py-1 text-xs ${
              it.state === 'dirty' || it.state === 'error'
                ? 'border-[color:var(--color-danger)] bg-[color:var(--color-bg-muted)]'
                : 'border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)]'
            }`}
          >
            <span className="flex-1 truncate">
              <span aria-hidden>{iconFor(it.contentType)}</span> {it.filename}{' '}
              <span className="text-[color:var(--color-text-muted)]">
                ({formatBytes(it.sizeBytes)})
              </span>
              {it.state === 'uploading' ? (
                <span className="ml-2 text-[color:var(--color-text-muted)]">
                  Analyse antivirus…
                </span>
              ) : null}
              {it.state === 'dirty' ? (
                <span className="ml-2 text-[color:var(--color-danger)]">
                  ⚠ Bloqué par l'antivirus
                </span>
              ) : null}
              {it.state === 'error' ? (
                <span className="ml-2 text-[color:var(--color-danger)]">⚠ {it.error}</span>
              ) : null}
            </span>
            <button
              type="button"
              onClick={() => onRemove(it.id)}
              className="ml-2 text-[color:var(--color-text-muted)]"
              aria-label="Retirer"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        className="rounded border border-dashed border-[color:var(--color-border-light)] px-3 py-4 text-center text-xs text-[color:var(--color-text-muted)]"
      >
        Glisse tes fichiers ici, ou{' '}
        <button type="button" className="underline" onClick={() => fileInputRef.current?.click()}>
          choisis un fichier
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit (no unit tests — UI component, tested via E2E in Task 22)**

```bash
git add apps/web/features/communications/components/attachment-drop.tsx apps/web/features/communications/hooks/use-attachment-uploader.ts
git commit -m "feat(comm): AttachmentDrop UI + useAttachmentUploader hook"
```

---

## Task 19: Wire `AttachmentDrop` into `ComposePanel` + Forward reprise trigger

**Files:**

- Modify: `apps/web/features/communications/components/compose-panel.tsx`

### Steps

- [ ] **Step 1: Import + wire the hook**

At the top of `ComposePanel`:

```tsx
import { AttachmentDrop } from './attachment-drop';
import { useAttachmentUploader } from '../hooks/use-attachment-uploader';
import { loadForwardAttachments } from '../actions/load-forward-attachments';
import { removeAttachmentFromDraft } from '../actions/remove-attachment-from-draft';
```

Inside the component:

```tsx
const uploader = useAttachmentUploader();
```

- [ ] **Step 2: Load draft's `composeAttachments` into the uploader on mount / draft load**

In the existing `loadDraft` `.then(r => { … })`:

```tsx
if (r.ok && r.draft) {
  // … existing state loads
  uploader.setInitial(
    r.draft.composeAttachments.map((a) => ({
      id: a.id,
      filename: a.filename,
      contentType: a.contentType,
      sizeBytes: a.sizeBytes,
      storagePath: a.storagePath,
      sha256: a.sha256,
      state: 'clean' as const,
    })),
  );
}
```

- [ ] **Step 3: On Forward — auto-load reprised attachments**

Extend the same effect:

```tsx
if (mode === 'forward' && replyTo?.id) {
  void loadForwardAttachments({ replyToId: replyTo.id }).then((r) => {
    if (r.ok) {
      uploader.setInitial(
        r.attachments.map((a) => ({
          id: a.id,
          filename: a.filename,
          contentType: a.contentType,
          sizeBytes: a.sizeBytes,
          storagePath: a.storagePath,
          sha256: a.sha256,
          state: 'clean' as const,
        })),
      );
    }
  });
}
```

- [ ] **Step 4: Extend the auto-save `saveDraft` call to include `composeAttachments`**

```tsx
composeAttachments: uploader.items
  .filter((x) => x.state === 'clean')
  .map((x) => ({
    id: x.id,
    filename: x.filename,
    contentType: x.contentType,
    sizeBytes: x.sizeBytes,
    storagePath: x.storagePath,
    sha256: x.sha256,
  })),
```

- [ ] **Step 5: Render `<AttachmentDrop>` inside the panel body**

Below the Tiptap editor:

```tsx
<AttachmentDrop
  items={uploader.items}
  totalBytes={uploader.totalBytes}
  onDrop={async (files) => {
    const res = await uploader.addFiles(files);
    if (res.rejected > 0) {
      notify({ kind: 'error', message: `Max 20 pièces jointes — ${res.rejected} ignorée(s).` });
    }
  }}
  onRemove={(id) => {
    uploader.removeItem(id);
    void removeAttachmentFromDraft({ attachmentDraftId: id });
  }}
/>
```

- [ ] **Step 6: Extend the Send button — disable while any item is `uploading`**

```tsx
disabled={pending || !to || !subject || uploader.items.some((x) => x.state === 'uploading')}
```

- [ ] **Step 7: Extend `sendMail` call — include `composeAttachments`**

```tsx
composeAttachments: uploader.items
  .filter((x) => x.state === 'clean')
  .map((x) => ({
    id: x.id, filename: x.filename, contentType: x.contentType,
    sizeBytes: x.sizeBytes, storagePath: x.storagePath, sha256: x.sha256,
  })),
```

- [ ] **Step 8: Handle new failure codes**

If `r.code === 'SEND_FAILED_TOO_LARGE'` → toast + keep panel open.
If `r.code === 'GRAPH_REPLY_ATTACHMENTS_UNSUPPORTED'` → banner explaining the Graph limitation + suggestion to compose a new mail.

- [ ] **Step 9: Typecheck + tests**

- [ ] **Step 10: Commit**

```bash
git add apps/web/features/communications/components/compose-panel.tsx
git commit -m "feat(comm): wire attachments into ComposePanel (drop + Forward reprise + send)"
```

---

## Task 20: MailReader attachments section + MailList 📎 badge

**Files:**

- Modify: `apps/web/features/communications/lib/mail-dto.ts` (add `attachments` field)
- Modify: `apps/web/app/(app)/communications/page.tsx` (select emailAttachments + hasAttachments)
- Modify: `apps/web/features/communications/components/mail-reader.tsx` (attachments section)
- Modify: `apps/web/features/communications/components/mail-list.tsx` (📎 badge)

### Steps

- [ ] **Step 1: Extend `MailDTO`**

```ts
export interface MailAttachmentDto {
  readonly id: string;
  readonly filename: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly scanStatus: 'pending' | 'clean' | 'dirty' | 'scan_failed' | null;
}

export interface MailDTO {
  // … existing
  readonly hasAttachments: boolean;
  readonly attachments: readonly MailAttachmentDto[];
}
```

Update `toMailDTO` to map these.

- [ ] **Step 2: Extend `/communications/page.tsx` select**

```ts
hasAttachments: true,
emailAttachments: {
  where: { isInline: false },
  select: { id: true, filename: true, contentType: true, sizeBytes: true, scanStatus: true },
  orderBy: { createdAt: 'asc' },
},
```

- [ ] **Step 3: In `MailList` — add 📎 badge**

Next to the subject line:

```tsx
{
  m.hasAttachments ? <span className="ml-1">📎</span> : null;
}
```

- [ ] **Step 4: In `MailReader` — add attachments section below body**

```tsx
{
  mail.attachments.length > 0 ? (
    <div className="mt-4 rounded border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-muted)] p-3">
      <div className="mb-2 text-xs font-bold text-[color:var(--color-text-muted)]">
        Pièces jointes ({mail.attachments.length})
      </div>
      <ul className="flex flex-col gap-1">
        {mail.attachments.map((a) => (
          <MailAttachmentRow key={a.id} attachment={a} />
        ))}
      </ul>
    </div>
  ) : null;
}
```

Where `MailAttachmentRow` is a new client component:

```tsx
'use client';
import { useState, useTransition } from 'react';
import { fetchAttachmentBinary } from '../actions/fetch-attachment';
import { formatBytes, iconFor } from '../lib/attachment-format';
import type { MailAttachmentDto } from '../lib/mail-dto';

interface Props {
  readonly attachment: MailAttachmentDto;
}

export function MailAttachmentRow({ attachment }: Props) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const isDirty = attachment.scanStatus === 'dirty' || attachment.scanStatus === 'scan_failed';

  function onDownload() {
    setError(null);
    start(async () => {
      const r = await fetchAttachmentBinary({ attachmentId: attachment.id });
      if (r.ok) {
        const a = document.createElement('a');
        a.href = r.signedUrl;
        a.download = r.filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
      } else {
        setError(r.message);
      }
    });
  }

  return (
    <li
      className={`flex items-center justify-between rounded px-2 py-1 text-xs ${isDirty ? 'text-[color:var(--color-text-muted)]' : ''}`}
    >
      <span className="flex-1 truncate">
        <span aria-hidden>{iconFor(attachment.contentType)}</span> {attachment.filename}{' '}
        <span className="text-[color:var(--color-text-muted)]">
          ({formatBytes(attachment.sizeBytes)})
        </span>
      </span>
      {isDirty ? (
        <span className="text-[color:var(--color-danger)]" title="Rejeté par l'antivirus">
          rejeté
        </span>
      ) : (
        <button
          type="button"
          onClick={onDownload}
          disabled={pending}
          className="btn btn-ghost btn-sm"
        >
          {pending ? 'Chargement…' : 'Télécharger'}
        </button>
      )}
      {error ? <span className="ml-2 text-[color:var(--color-danger)]">{error}</span> : null}
    </li>
  );
}
```

- [ ] **Step 5: Typecheck + tests (existing tests should still pass — MailDTO extension is additive-safe since consumers always read `attachments`)**

- [ ] **Step 6: Commit**

```bash
git add apps/web/features/communications/lib/mail-dto.ts apps/web/app/\(app\)/communications/page.tsx apps/web/features/communications/components/mail-reader.tsx apps/web/features/communications/components/mail-list.tsx apps/web/features/communications/components/mail-attachment-row.tsx
git commit -m "feat(comm): MailReader attachments section + MailList 📎 badge"
```

---

## Task 21: Runbook + PRD + progress + CLAUDE.md

**Files:**

- Create: `docs/runbooks/mail-attachments.md`
- Modify: `docs/runbooks/mail-send.md` (cross-link)
- Modify: `docs/runbooks/microsoft-graph-integration.md` (cross-link)
- Modify: `docs/runbooks/imap-integration.md` (cross-link)
- Modify: `PRD-NexusHub.md`
- Modify: `progress.md`
- Modify: `CLAUDE.md` §11

### Steps

- [ ] **Step 1: Write `docs/runbooks/mail-attachments.md`**

Sections:

1. **But** — Attachments V1.5 : réception + envoi + Forward reprise. Scan sync via VirusTotal, cache Supabase Storage bucket `mail-attachments`.
2. **Env vars** — `VIRUSTOTAL_API_KEY` (Vercel Encrypted Env). Rotation trimestrielle documentée.
3. **Bucket setup** — SQL à lancer AVANT la migration (déjà appliqué le 2026-07-16 par Task 3) :
   ```sql
   INSERT INTO storage.buckets (id, name, public) VALUES ('mail-attachments', 'mail-attachments', false);
   -- + les 2 RLS policies (copiées depuis Task 3)
   ```
4. **Migration** — `<timestamp>_mail_attachments` appliquée le 2026-07-16.
5. **Diagnostic — upload / download failures** — table des codes (`RATE_LIMIT`, `TOO_LARGE`, `BLACKLISTED_EXT`, `TYPE_SPOOF`, `DIRTY`, `SCAN_FAILED`, `UPLOAD_FAILED`, `NOT_FOUND`, `FETCH_FAILED`).
6. **Storage growth monitoring** — SQL du spec §8.4 :
   ```sql
   SELECT workspace_id, COUNT(*) AS attachments, SUM(size_bytes) AS bytes
   FROM email_attachments
   WHERE scan_status = 'clean' AND storage_path IS NOT NULL
   GROUP BY workspace_id ORDER BY bytes DESC;
   ```
   Trigger V2 quota implementation : biggest workspace > 1 GB.
7. **VirusTotal quotas** — 500 req/day free tier. Monitoring : `SELECT COUNT(*) FROM audit_log WHERE action IN ('attachment_uploaded','attachment_scanned_dirty','attachment_downloaded') AND created_at > NOW() - INTERVAL '1 day'`.
8. **Rollback** — `UPDATE email_attachments SET scan_status = 'dirty', storage_path = NULL WHERE …` pour désactiver un batch d'attachments dangereux. Full rollback via down-migration si besoin.
9. **Security notes** — spec §9 récap.
10. **Cross-links** — mail-send, microsoft-graph-integration, imap-integration runbooks.

- [ ] **Step 2: Cross-link the 3 existing runbooks**

Add near the top of each:

```markdown
> **See also:** [`mail-attachments.md`](./mail-attachments.md) for file attachments (V1.5).
```

- [ ] **Step 3: PRD update**

Find the Communications V1.5 section. Update:

```
Mail V1.5 : pièces jointes (réception + envoi + Forward reprise) via VirusTotal scan + Supabase Storage. Multi-file drag/drop batch. Cap 25 MB/file + 25 MB/mail + 20 files.
```

- [ ] **Step 4: `progress.md`**

Add under Communications:

```markdown
- [x] Mail attachments V1.5 — réception + envoi + Forward reprise via VirusTotal + Storage. Migration `<timestamp>_mail_attachments` appliquée à la Supabase partagée le 2026-07-16.
- [ ] V2 next : Workspace.storageQuotaBytes + enforcement à l'upload (trigger : biggest workspace > 1 GB — voir runbook mail-attachments §5.3 monitoring SQL).
```

- [ ] **Step 5: `CLAUDE.md` §11 journal**

Append:

```markdown
| 2026-07-16 | Mail attachments V1.5 — reception lazy + send + Forward reprise + VirusTotal + Supabase Storage | Angelo L. + Claude |
```

- [ ] **Step 6: Commit**

```bash
git add docs/runbooks/mail-attachments.md docs/runbooks/mail-send.md docs/runbooks/microsoft-graph-integration.md docs/runbooks/imap-integration.md PRD-NexusHub.md progress.md CLAUDE.md
git commit -m "docs(mail-attachments): runbook + PRD + progress + CLAUDE.md journal"
```

---

## Task 22: E2E smoke tests

**Files:**

- Create: `e2e/tests/mail-attachments.spec.ts`

### Steps

- [ ] **Step 1: Read the existing E2E auth pattern**

```bash
cat e2e/tests/mail-send.spec.ts
```

- [ ] **Step 2: Write the smoke**

```ts
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test.describe('Mail attachments @smoke', () => {
  test.skip(
    !process.env['E2E_MAIL_ATTACHMENTS'],
    'requires E2E_MAIL_ATTACHMENTS=1 and a seeded workspace with an active mailbox',
  );

  test('drop zone accepts a file and shows upload states', async ({ page }) => {
    await page.goto('/communications');
    await page.getByRole('button', { name: /Nouveau mail/i }).click();
    await expect(page.getByRole('dialog', { name: 'Compose' })).toBeVisible();
    // Trigger the hidden file input directly
    const path = resolve(__dirname, '../fixtures/hello.txt');
    await page.setInputFiles('input[type=file]', path);
    // Should transition through 'uploading' to 'clean' — VirusTotal may take up to 30s
    await expect(page.getByText(/hello\.txt/i)).toBeVisible({ timeout: 30_000 });
    // Send button eventually enabled
    // (Requires To + Subject filled — omitted for smoke)
  });

  test('MailReader shows attachments section when hasAttachments', async ({ page }) => {
    await page.goto('/communications');
    // Assumes at least one seeded mail with attachments
    await expect(page.getByText(/Pièces jointes/i).first()).toBeVisible();
  });
});
```

Also create `e2e/fixtures/hello.txt` with content `hello world`.

- [ ] **Step 3: Verify Playwright parses the file**

```bash
cd e2e && pnpm exec playwright test --list mail-attachments 2>&1 | tail -10
```

- [ ] **Step 4: Commit**

```bash
git add e2e/tests/mail-attachments.spec.ts e2e/fixtures/hello.txt
git commit -m "test(e2e): mail attachments smokes (drop zone + received section)"
```

---

## Task 23: Final verification + PR

**Files:**

- None (operational).

### Steps

- [ ] **Step 1: Full monorepo verification**

```bash
cd /Users/angelogeraci/Documents/Application/BND-OS/.worktrees/mail-attachments
pnpm turbo run lint typecheck test
pnpm --filter @nexushub/web build
```

All must be green (build may need placeholder env vars — same as iter 3 experience).

- [ ] **Step 2: Diff review — verify no PII / secret leaks**

```bash
git diff main -- '*.ts' '*.tsx' | grep -iE '(bodyhtml|bodytext|password|encryptedTokens|contentBytes|VIRUSTOTAL_API_KEY).*console\.' | head -5
```

Expected empty.

- [ ] **Step 3: Push + PR**

```bash
git push -u origin feature/mail-attachments

gh pr create --title "feat(communications): mail attachments V1.5" --body "$(cat <<'EOF'
## Summary
- **Reception** — inbound attachments discovered at sync time (BODYSTRUCTURE parse for IMAP, `/messages/{id}/attachments` for Graph). Metadata persisted; binary lazy-fetched on first download, scanned by VirusTotal, cached in Supabase Storage.
- **Send** — drag-and-drop or file-picker in ComposePanel. Multi-file batch via parallel `Promise.allSettled`. Per-file state (uploading / scanning / clean / dirty). Extension blacklist BEFORE VirusTotal (`.exe .msi .bat .cmd .com .scr .js .jar .vbs .ps1 .app .dmg`). Magic-byte sniffing via `file-type`. SHA-256 dedup — same binary already clean in the workspace = skip VirusTotal, clone Storage path.
- **Forward reprise** — auto-attach the source's non-inline attachments on Transférer. Shared Storage paths (1 binary, N EmailAttachment rows).
- **Send limits** — 25 MB / file, 25 MB / mail total, 20 files max. Graph payload cap 3 MB (larger → `SEND_FAILED_TOO_LARGE`). Graph reply/forward with attachments → `GRAPH_REPLY_ATTACHMENTS_UNSUPPORTED` (V2 will use Graph drafts + attachments).
- **Storage** — private bucket `mail-attachments`, RLS scoped by JWT `workspace_id`, service-role-only writes, signed URLs 5 min TTL.
- **Rate limits** — `mail_attachment_upload` 30/hour + `mail_attachment_download` 100/hour.
- **Audit** — `attachment_uploaded` (no filename), `attachment_scanned_dirty` (filename + engines), `attachment_downloaded`, `attachment_rejected_upload`.

## Test plan
- [x] Unit + integration green (14/14 turbo tasks, 300+ tests).
- [x] Migration + bucket + RLS applied to shared Supabase (2026-07-16) — verified.
- [x] `VIRUSTOTAL_API_KEY` set in Vercel Encrypted Env for Preview + Production.
- [x] E2E smokes gated by `E2E_MAIL_ATTACHMENTS`.
- [ ] Preview: drop a file → toast → attachment ready → send → received on the other end → download from MailReader.

## Follow-ups (V2 — spec §12)
- Workspace.storageQuotaBytes + enforcement (trigger: > 1 GB per workspace)
- Inngest cron for Storage orphans cleanup
- Inline preview (images / PDF)
- Graph upload session for attachments > 3 MB
- Graph reply/forward with attachments (draft + PUT attachments + send)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Return the PR URL.
