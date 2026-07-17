# Mail Attachments — Design (Communications iter V1.5)

> **Status:** Approved brainstorming — ready for implementation plan.
> **Depends on:** [`2026-05-28-email-foundations-design.md`](./2026-05-28-email-foundations-design.md) (Graph read-only), [`2026-07-15-imap-integration-design.md`](./2026-07-15-imap-integration-design.md) (IMAP read-only), [`2026-07-16-mail-send-design.md`](./2026-07-16-mail-send-design.md) (mail send V1) — all three merged.
> **Author:** Angelo L. + Claude (Opus 4.7)
> **Date:** 2026-07-16

## 1. Goal

Add file attachments to NexusHub Communications, covering the three parts that make a real mail client feel complete:

1. **Reception** — inbound mails carry an attachment list (visible on `/communications`, downloadable on demand).
2. **Send** — outbound compose (Reply / Reply-All / Forward / New) accepts drag-and-dropped files; up to 20 per mail, 25 MB total.
3. **Forward reprise** — clicking Transférer on a mail with attachments auto-re-attaches the originals to the new mail, matching Gmail/Outlook behavior.

The whole flow gates on a synchronous VirusTotal scan for every uploaded file. Cached-clean binaries live in a dedicated Supabase Storage bucket, one path segment per workspace for multi-tenant RLS safety.

## 2. Non-goals (V1.5)

- **Quota Storage per workspace** — tracked as a triple-recorded V2 follow-up (see §12 + progress.md + runbook §5.3). No enforcement in V1.5.
- **Cleanup cron (Inngest)** for Storage orphans from disconnected mailboxes. Documented gap in the runbook.
- **Inline preview** — images / PDF viewer (pdf.js). V1.5 = list + download button only.
- **Graph upload session** for attachments > 3 MB via the Graph send path. V1.5 = 3 MB max via Graph payload direct, 25 MB via SMTP. Larger files via Graph return `SEND_FAILED` with a clear message.
- **E2E client-side encryption** before upload.
- **Attachments in signatures** (custom logos, business cards).
- **Sequential upload UI** — V1.5 fires all drops in parallel via `Promise.allSettled`.
- **Batch delete of attachments** in the received-mails view (V1.5 = individual only, and only via disconnect cascade).

## 3. Design decisions (from brainstorming)

| #   | Decision                                                                                                                                    | Rationale                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Single spec covering reception + send + Forward reprise.**                                                                                | User preference — coherent story, one PR.                                                                                     |
| 2   | **VirusTotal API** for antivirus.                                                                                                           | Zero ops, 500 free req/day (largely enough for a small tenant), industry standard, 70+ engines.                               |
| 3   | **Sync scan on upload** — block UI until VirusTotal returns clean.                                                                          | Simplest correctness guarantee, ~5–15 s typical latency shown as a spinner. Send button never blocked by a pending scan.      |
| 4   | **25 MB / file, 25 MB / mail, 20 files max.**                                                                                               | Gmail / Outlook / SMTP standard — works everywhere, no workaround needed.                                                     |
| 5   | **Auto-reattach on Forward** — user can uncheck.                                                                                            | Matches every real mail client; Storage paths shared across referrers (1 binary, N EmailAttachment rows).                     |
| 6   | **List + download only** in `MailReader`.                                                                                                   | Ships fast; inline preview is a V2 UX polish.                                                                                 |
| 7   | **Multi-file drag/drop batch** — parallel `Promise.allSettled` from the client.                                                             | Standard modern UX; server action stays per-file; the existing 30-uploads/user/hour rate limit protects against abuse.        |
| 8   | **Lazy reception** — persist attachment metadata during sync, fetch the binary only on first download demand. Cache in Storage after fetch. | Keeps inbox sync fast (200 mails × 3 attachments × 15 s scan would blow the timeout), Storage cost aligned with actual usage. |
| 9   | **Storage bucket `mail-attachments`** — private, `<workspaceId>/<attachmentUuid>` path structure, RLS scoped by JWT `workspace_id`.         | Path traversal-immune (UUID key, filename in DB), multi-tenant safe at the Storage layer.                                     |
| 10  | **SHA-256 dedup** — same binary hash already `clean` in the workspace → skip VirusTotal call, clone the row + Storage path.                 | Reduces VT quota consumption + saves Storage on legitimate resends of the same file.                                          |

## 4. Data model

### 4.1 New table `EmailAttachment`

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
  /// Supabase Storage object key. Null until the binary is fetched.
  /// Format: `<workspaceId>/<attachment uuid>`.
  storagePath      String?               @map("storage_path")
  /// pending → clean | dirty | scan_failed. Null = not scanned yet (lazy state).
  scanStatus       AttachmentScanStatus? @map("scan_status")
  /// VirusTotal analysis summary (engine detections, verdict, analysis id).
  /// Set once the scan completes.
  scanReport       Json?                 @map("scan_report")
  /// SHA-256 hex of the binary. Set on first fetch. Enables workspace-scoped
  /// dedup on future uploads / lazy fetches.
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

enum AttachmentScanStatus {
  pending
  clean
  dirty
  scan_failed
}
```

### 4.2 `EmailMessage` — 1 derived column for the list UI

```prisma
/// Denormalized flag set at parse-time from BODYSTRUCTURE / Graph metadata.
/// Lets MailList show 📎 without joining EmailAttachment.
hasAttachments Boolean @default(false) @map("has_attachments")
```

### 4.3 `MailDraft` — JSONB slot for in-progress uploads

```prisma
/// Uploaded attachments (Storage-persisted + scanned clean) that will become
/// EmailAttachment rows on send. Each entry:
/// { id, filename, contentType, sizeBytes, storagePath, sha256 }.
/// Kept as JSONB because a draft is short-lived and doesn't need a full FK.
composeAttachments Json @default("[]") @map("compose_attachments")
```

**Shape of `AttachmentDraft`** (validated via Zod client + server) :

```ts
interface AttachmentDraft {
  id: string; // UUID matching Storage object key
  filename: string;
  contentType: string;
  sizeBytes: number;
  storagePath: string; // `<workspaceId>/<id>`
  sha256: string;
  /** True if this draft entry is a Forward-reprised reference to an existing
   *  EmailAttachment. On send, we clone the storagePath (no re-upload). */
  reprisedFromAttachmentId?: string;
}
```

### 4.4 Migration

Additive-safe, single migration `<timestamp>_mail_attachments`:

1. `CREATE TYPE attachment_scan_status AS ENUM ('pending','clean','dirty','scan_failed');`
2. `ALTER TABLE email_messages ADD COLUMN has_attachments BOOLEAN NOT NULL DEFAULT false;`
3. `ALTER TABLE mail_drafts ADD COLUMN compose_attachments JSONB NOT NULL DEFAULT '[]';`
4. `CREATE TABLE email_attachments (…);` + 3 indexes + 2 FKs (`ON DELETE CASCADE` for workspace + email_message).
5. Extend the `AuditAction` enum (Postgres type name is PascalCase per existing convention) with 4 new values via `ALTER TYPE`:
   ```sql
   ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'attachment_uploaded';
   ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'attachment_scanned_dirty';
   ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'attachment_downloaded';
   ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'attachment_rejected_upload';
   ```
   Same pattern as the previous iteration's `mail_sent` / `mail_send_failed` addition. The corresponding Prisma `enum AuditAction { … }` block gets those values too so the client typings match.

Apply to shared Supabase manually before merging (project convention — Vercel does not run migrations).

## 5. Storage + antivirus pipeline

### 5.1 Supabase Storage bucket

**Bucket** `mail-attachments` — created manually via Supabase dashboard **before** the migration is applied (runbook §2). **Private** (no public access).

**Path structure** :

```
mail-attachments/
├── <workspaceId>/
│   └── <attachmentUuid>            ← object key IS the EmailAttachment UUID
```

The `filename` never appears in the path. Path traversal is structurally impossible.

**RLS policies** (SQL applied via runbook):

```sql
-- SELECT: workspace_id prefix must match the caller's JWT claim
CREATE POLICY "mail_attachments_select_own_workspace"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'mail-attachments'
    AND (storage.foldername(name))[1] = (auth.jwt() ->> 'workspace_id')
  );

-- INSERT/UPDATE/DELETE: service role only (all writes go through server actions
-- that use the service key, never through the client).
CREATE POLICY "mail_attachments_write_service_role_only"
  ON storage.objects FOR ALL
  USING (
    bucket_id = 'mail-attachments'
    AND auth.role() = 'service_role'
  );
```

**Download** : short-lived signed URLs (`createSignedUrl(path, 300)` — 5 minutes TTL). Server action returns the URL; client hits Supabase Storage directly. No streaming through Next.js (avoids gross serverless transfer).

**Upload** : server action receives the blob via `FormData` (Next.js server actions accept up to 25 MB body), scans sync, then uploads via the admin storage SDK.

### 5.2 VirusTotal pipeline

Client wrapper at `packages/integrations/src/antivirus/virustotal.ts`:

```ts
export interface ScanResult {
  readonly clean: boolean;
  readonly verdict: 'clean' | 'dirty' | 'scan_failed';
  readonly stats: { malicious: number; suspicious: number; undetected: number };
  readonly detectingEngines?: readonly string[];
  readonly analysisId: string;
}

export async function scanFileWithVirusTotal(binary: Buffer, apiKey: string): Promise<ScanResult>;
```

**Flow** :

1. `POST https://www.virustotal.com/api/v3/files` with `multipart/form-data` — returns `{data: {id: analysis_id}}`.
2. Poll `GET https://www.virustotal.com/api/v3/analyses/{analysis_id}` every 3 s, timeout 60 s. Typical response in 5–15 s.
3. Parse `stats.malicious` + `stats.suspicious`. Zero on both → clean. Non-zero → dirty (with `detectingEngines` list). Timeout / 5xx → `scan_failed` (treated as dirty for security: better false positive than false negative).

**Dedup pre-check** — before hitting VirusTotal:

```sql
SELECT id, storage_path, scan_report
FROM email_attachments
WHERE workspace_id = $1
  AND sha256 = $2
  AND scan_status = 'clean'
  AND storage_path IS NOT NULL
LIMIT 1;
```

If a hit exists, we reuse its `scanReport` and `storagePath` (clone the row for the new mail context — same binary, new metadata row).

**Rate limit** on scans — new rate-limit key `mail_attachment_upload` (30/user/hour). Protects both against user abuse and VirusTotal free-tier quota (500/day global).

### 5.3 Env vars

**New**:

- `VIRUSTOTAL_API_KEY` — Vercel Encrypted Env. Rotation trimestrielle. Never logged.

**Reused**:

- Existing Supabase service role key for Storage admin operations (already in `.env`).

## 6. Reception path (inbound)

### 6.1 Discovery during sync

**IMAP** — extend `packages/integrations/src/imap/parse.ts`:

```ts
export interface ParsedAttachment {
  readonly partNumber: string; // e.g. "2.1"
  readonly filename: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly contentId: string | null;
  readonly isInline: boolean;
}

export function parseImapAttachments(bodyStructure: unknown): readonly ParsedAttachment[];
```

Walks the multipart tree returned by ImapFlow's `fetch` with `bodyStructure: true`. For each part with:

- `disposition.type === 'attachment'` → regular attachment
- OR (`type === 'image/*'` AND `contentId` set) → inline image referenced by `cid:` in the HTML body

Extract → return the shape above.

`sync-imap-inbox.ts` loop is extended:

1. Fetch envelope + `bodyStructure` (a single IMAP command, cheap).
2. Parse envelope (existing).
3. Parse attachments (new).
4. Upsert `EmailMessage` (existing).
5. For each attachment → `emailAttachment.upsert` with `storagePath=null`, `scanStatus=null`.
6. Set `emailMessage.hasAttachments = parsedAttachments.length > 0`.

**Graph** — same pattern via `/me/messages/{id}/attachments` (Graph exposes `hasAttachments` natively on message metadata):

- If `message.hasAttachments` is true → separate call to `GET /me/messages/{id}/attachments`.
- Response shape: `[{id, name, contentType, size, contentId, isInline, @odata.type}]`.
- Filter out `itemAttachment` and `referenceAttachment` types — V1.5 supports `#microsoft.graph.fileAttachment` only. Non-file attachments are noted in the audit log (`attachment_unsupported_type`) but not persisted.

### 6.2 Server action `fetchAttachmentBinary(attachmentId)`

`apps/web/features/communications/actions/fetch-attachment.ts`:

```ts
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
```

Flow:

1. `requireUser()` + Zod validation.
2. Rate limit on downloads too — `mail_attachment_download` (100/user/hour). Guards against a malicious client hitting `download` in a loop.
3. Load `EmailAttachment` with double ownership check:
   ```ts
   where: {
     id: attachmentId,
     workspaceId: ctx.workspaceId,
     emailMessage: {
       integration: { ownerUserId: ctx.userId },  // mailbox-owned by caller
     },
   }
   ```
4. If `storagePath !== null && scanStatus === 'clean'` → generate signed URL → return.
5. If `scanStatus in ('dirty', 'scan_failed')` → return `DIRTY`.
6. **Lazy fetch path** (no `storagePath` yet):
   - Load parent `EmailMessage` + `Integration` (already joined).
   - Fetch binary from source:
     - Graph: `graphFetch(token, '/me/messages/{externalId}/attachments/{sourceExternalId}/$value')` — returns raw bytes.
     - IMAP: reuse `getValidImapCredentials` + `openImapSession` + `session.download(uid, ['BODY[<partNumber>]'], {uid: true})`.
   - Verify `binary.byteLength === att.sizeBytes` (mail-spoof detection); mismatch → `FETCH_FAILED` + audit `attachment_size_mismatch`.
   - Verify magic bytes via `file-type` package. Mismatch with declared `contentType` → treat as dirty + audit `attachment_type_spoof`.
   - Compute SHA-256.
   - Run dedup check (§5.2). If hit → clone storagePath + scanReport, skip VirusTotal, return signed URL.
   - Otherwise → scan via VirusTotal.
   - Clean → upload to Storage at `<workspaceId>/<attachmentId>`, update DB row, return signed URL.
   - Dirty → save `scanStatus='dirty'` + `scanReport`, return `DIRTY`.

### 6.3 UI — attachments section in `MailReader`

New block below the body:

```
┌── Pièces jointes (3) ────────────────────────┐
│ 📄 rapport.pdf         2.3 MB   [Télécharger] │
│ 🖼 logo.png            180 KB   [Télécharger] │
│ ⚠  virus.exe           32 KB    rejeté        │
└───────────────────────────────────────────────┘
```

- Icon mapped from `contentType` prefix: `application/pdf` → 📄, `image/*` → 🖼, `application/vnd.*sheet*` → 📊, otherwise → 📎.
- Size formatted (`Intl.NumberFormat` with binary units).
- `[Télécharger]` button → calls `fetchAttachmentBinary(id)` → on success, `window.location.href = signedUrl` OR programmatic `<a href download={filename}>` click.
- Loading state during lazy fetch: "Analyse antivirus en cours (~15s)…" spinner.
- Dirty row grayed out with `⚠ rejeté` badge + tooltip showing detecting engines from the scan report.

**MailList** — 📎 badge next to the sender name when `hasAttachments`. Zero extra query — flag already denormalized on `EmailMessage`.

## 7. Send path (outbound)

### 7.1 Upload UX in `ComposePanel`

Attachments zone added between the Tiptap body and the footer:

```
┌────────────────────────────────────────────┐
│ [Corps mail Tiptap]                        │
├────────────────────────────────────────────┤
│ 📎 Pièces jointes (2 · 4.3 MB / 25 MB)     │
│ ┌────────────────────────────────────────┐ │
│ │ 📄 rapport.pdf   2.3 MB      [×]        │ │
│ │ 🖼 logo.png      180 KB      [×]        │ │
│ └────────────────────────────────────────┘ │
│ ┌ Glisse tes fichiers ici ───────────────┐ │
│ │  ou [choisir un fichier]                │ │
│ └─────────────────────────────────────────┘ │
├────────────────────────────────────────────┤
│ [× Supprimer draft]  [Annuler] [Envoyer ↩] │
└────────────────────────────────────────────┘
```

**Per-attachment states**:

- `uploading` — progress bar 0–100 %.
- `scanning` — spinner "Analyse antivirus…".
- `clean` — icon + name + size + `×` remove button.
- `dirty` — red row "⚠ Bloqué par l'antivirus" (auto-removes after 5 s).

**Multi-file drop** — parallel `Promise.allSettled`:

- Drop event yields `dataTransfer.files: FileList` (potentially N files).
- Cap total attachments at 20 (existing + new). If drop pushes above cap, keep the first `20 − existing`, toast the rest: "Max 20 pièces jointes — 3 ignorées".
- All accepted files trigger `uploadAttachment(formData)` in parallel via `Promise.allSettled`.
- Each has independent state; results appear in the list in drop-order (via an index passed client-side).
- Rate limit `mail_attachment_upload` (30/hour) applies per-call — a batch of 40 drops would rate-limit itself naturally.

**Send button disabled** while any attachment is `uploading` or `scanning`. Dirty rows self-remove — never a blocker.

### 7.2 Server action `uploadAttachment(formData)`

`apps/web/features/communications/actions/upload-attachment.ts`:

Flow:

1. `requireUser()`.
2. Rate limit `mail_attachment_upload` (30/user/hour).
3. Parse `FormData` — expect a single `File` under `file` + string `filename` (client passes sanitized). Size ≤ 25 MB (server-enforced). Server re-sanitizes `filename` (defense in depth).
4. **Extension blacklist**: reject known executable extensions before the scan (`.exe .msi .bat .cmd .com .scr .js .jar .vbs .ps1 .app .dmg`). Cheap defense — no VirusTotal call spent on obviously risky binaries. Audit `attachment_rejected_upload` with `reason='ext_blacklist'`.
5. Compute SHA-256.
6. **Dedup pre-check** (§5.2). If workspace already has a clean binary with this hash, clone the row + storage path, return immediately (no VT call).
7. Detect actual `contentType` via magic bytes (`file-type` npm). Mismatch with declared → treat as dirty + audit `attachment_type_spoof`.
8. **VirusTotal scan** (§5.2).
9. Clean → upload to `<workspaceId>/<newUuid>` via service-role Storage SDK. Insert (or clone) row.
10. Dirty / scan_failed → audit + return `{ok: false, code: 'DIRTY', ...}`.
11. Success → return `{ok: true, id, filename, contentType, sizeBytes, sha256}`.

### 7.3 Draft integration

Client, after a successful `uploadAttachment` call, updates the `MailDraft` via `saveDraft` (existing action, extended to accept `composeAttachments: AttachmentDraft[]`). The Zod schema on `saveDraft` gains this field with `.array(AttachmentDraftSchema).max(20)`.

**`removeAttachmentFromDraft(attachmentId)`** — new server action:

- Loads the draft, filters out the entry, writes back.
- If the removed entry has `reprisedFromAttachmentId === undefined` (it's a fresh upload, not a Forward reprise) → best-effort delete of the Storage object at `<workspaceId>/<id>`. Failures logged, not surfaced.
- Reprise entries: never delete Storage — the source `EmailAttachment` still references it.

### 7.4 Send path — attach to the outbound mail

`send-mail.ts` schema gains:

```ts
composeAttachments: z.array(AttachmentDraftSchema).max(20).default([]);
```

The recipient cap of 20 total (existing) is now joined by the attachment cap of 20 (independent).

**Graph** (`sendViaGraph`):

- Each attachment becomes an entry in `message.attachments`:
  ```json
  {
    "@odata.type": "#microsoft.graph.fileAttachment",
    "name": "rapport.pdf",
    "contentType": "application/pdf",
    "contentBytes": "<base64>"
  }
  ```
- Fetch each binary from Storage, base64-encode, inject.
- **Payload size limit**: Graph's `/me/sendMail` accepts up to ~4 MB total payload (per Microsoft docs, though empirically ~3 MB is safe). If the sum of attachment sizes pushes the base64-encoded payload above 3 MB, return a new `SendMailResult.code = 'SEND_FAILED_TOO_LARGE'` (additive extension to the existing union defined in iter 3). Client shows a targeted error: "Ce mail dépasse la limite Microsoft Graph (3 MB de pièces jointes). Réduis la taille ou utilise une boîte IMAP." Documented in the runbook; V2 will implement Graph upload sessions to lift the limit to 150 MB.

**IMAP SMTP** (`sendViaImapSmtp` → `sendViaSmtp`):

- Nodemailer accepts `attachments: [{filename, content}]` where `content` is a `Buffer`.
- Fetch each binary from Storage (as `Buffer` directly), push into the send payload. Nodemailer handles the multipart MIME construction.
- SMTP standard: 25 MB total (existing schema enforces this).

**After send success**:

- For each entry in `composeAttachments`:
  - If `reprisedFromAttachmentId` is set → clone the source `EmailAttachment` row with the new `emailMessageId`, keep the same `storagePath` (shared binary, N references).
  - Otherwise → create a fresh `EmailAttachment` row linked to the newly-created `EmailMessage(folder='sent')`, `storagePath` preserved from upload.
- `mailDraft.composeAttachments = []` (draft cleared as part of the existing send flow).
- `emailMessage.hasAttachments = composeAttachments.length > 0`.

## 8. Forward reprise + cleanup

### 8.1 Auto-reattach on Forward

Triggered when `useComposePanelStore.getState().open({mode: 'forward', replyTo})` fires:

1. `computePrefill` runs as usual (subject `Fwd:`, quoted body).
2. In parallel, ComposePanel calls a new server action `loadForwardAttachments(replyToId)`.
3. Server:
   - Loads `EmailAttachment[]` where `emailMessageId = replyToId AND isInline = false` (inline images stay embedded in the quoted HTML — they're not standalone files).
   - Ownership check via mailbox owner.
   - For each attachment:
     - Already cached + clean → return `AttachmentDraft` with `reprisedFromAttachmentId = <original id>`, `storagePath = <existing>`.
     - Not cached (or `scanStatus === null`) → trigger the lazy fetch inline (§6.2). Can add latency — the UI shows "Récupération et scan…" per row.
     - Dirty → skip entirely (never re-attach a known-dirty file).
   - Return the list.
4. Client updates the draft's `composeAttachments` with the returned entries.

**UX in ComposePanel** during a Forward:

- Each reprised row shows a `Reprise` badge.
- User can uncheck (remove) any entry → same `removeAttachmentFromDraft` action (but for reprise entries it doesn't delete Storage — see §7.3).
- New button `× Retirer toutes les pièces jointes` (only on Forward flow).

### 8.2 Storage sharing on Forward + delete

**One binary, N rows**: reprised attachments point to the SAME `storagePath` as the source `EmailAttachment`. Cleanup logic (below) must not delete a path referenced by other rows.

**Simplification V1.5**: no ref counting. On row delete, we DON'T delete Storage. Storage cleanup is fully deferred to a V2 Inngest cron that scans Storage for paths with zero DB references. Trade-off: Storage cost slowly grows — bounded and observable.

### 8.3 Cleanup — `deleteDraft`

Existing `deleteDraft` server action extended:

1. Load the draft first (to inspect `composeAttachments`).
2. For each entry with `reprisedFromAttachmentId === undefined` (fresh upload, never sent) → best-effort delete Storage at `<workspaceId>/<id>`. Failures logged only.
3. Delete the draft row (unchanged behavior).

**Reprise entries are never deleted from Storage** on discard — the source `EmailAttachment` still owns them.

### 8.4 Storage growth monitoring (V1.5 → V2 hand-off)

The runbook documents:

```sql
-- Total attachment bytes per workspace
SELECT workspace_id, COUNT(*) AS attachments, SUM(size_bytes) AS bytes
FROM email_attachments
WHERE scan_status = 'clean' AND storage_path IS NOT NULL
GROUP BY workspace_id
ORDER BY bytes DESC;

-- Orphan Storage paths (paths in Storage with no DB reference)
-- Requires manual join between `storage.objects` list + email_attachments —
-- see runbook §5.3 for the exact query.
```

Trigger for the V2 quota implementation: when the biggest workspace passes **1 GB**, ship the quota + cleanup cron.

## 9. Security (CLAUDE.md §4)

- **Path traversal / filename injection** — Storage object key = UUID only. `filename` in DB, sanitized (null bytes stripped, path separators stripped, unicode normalized, capped 255).
- **Content-type spoofing** — `file-type` npm package sniffs magic bytes. Mismatch with declared → treat as dirty.
- **RLS Supabase Storage** — bucket private, SELECT scoped by JWT `workspace_id`, INSERT/UPDATE/DELETE via service role only. Bucket + policies created manually per the runbook, verified by a `SELECT` test as a non-service user.
- **Signed URLs TTL 5 min** — limits exposure if the URL leaks to logs.
- **Ownership double-scope** — every action checks `workspaceId + integration.ownerUserId === ctx.userId`. Multi-tenant leak = merge blocker per CLAUDE.md §4.4.2.
- **Extension blacklist** cheap first line of defense: `.exe .msi .bat .cmd .com .scr .js .jar .vbs .ps1 .app .dmg` — rejected before VirusTotal call.
- **VirusTotal API key** — Vercel Encrypted Env, rotation trimestrielle documented in `docs/runbooks/secret-rotation.md`. Never logged.
- **Rate limits** — `mail_attachment_upload` (30/user/hour) + `mail_attachment_download` (100/user/hour) via existing Upstash infra.
- **Audit events** (PII-safe):
  - `attachment_uploaded` — `{integrationId, contentType, sizeBytes, sha256}` — filename NEVER logged in this event
  - `attachment_scanned_dirty` — `{integrationId, filename, contentType, sha256, detectingEngines: [...]}` — filename included here for investigation
  - `attachment_downloaded` — `{integrationId, attachmentId}` (audit trail)
  - `attachment_rejected_upload` — `{integrationId, contentType, sizeBytes, reason: 'dirty' | 'ext_blacklist' | 'size' | 'rate_limit' | 'type_spoof'}`
- **No password / body / binary content in logs** — Sentry `beforeSend` continues its existing scrubbing; add `contentBytes` to the scrub list for Graph payloads.

## 10. Testing

**Unit — new `packages/integrations/src/antivirus/`** (100 % coverage target):

- `virustotal.ts` — POST + poll + verdict parse (mock fetch). Fixtures: clean, dirty (with engines), timeout, 5xx, malformed response.
- Rate-limit interaction — a caller pattern that scan 30 files in an hour hits the limit.

**Unit — `packages/integrations/src/imap/parse.ts` extensions**:

- `parseImapAttachments` — simple text, single attachment, multipart mixed, nested multipart, inline images with cid, disposition="attachment" vs "inline", filename in Content-Disposition vs Content-Type name, edge case (no Content-Disposition at all, only Content-Type).

**Unit — Graph attachments**:

- Parse `[{id, name, contentType, size, contentId, isInline, @odata.type}]` — filter out itemAttachment / referenceAttachment types.

**Unit — filename sanitize + magic byte sniff**:

- `sanitize-filename.test.ts` — null bytes, path traversal (`../etc/passwd`), unicode direction override, cap 255.
- `verify-content-type.test.ts` — png vs jpeg vs pdf, exe wearing pdf clothes, empty buffer.

**Integration — server actions** (Prisma test DB + mocked VirusTotal + mocked Supabase Storage):

- `uploadAttachment` — happy path (clean scan → row + Storage), dirty rejection (no row, no Storage), rate limit exhaustion, extension blacklist, dedup hit (skip VT), type spoof detection.
- `fetchAttachmentBinary` — cached clean → immediate signed URL, cached dirty → refuse, non-cached → fetch + scan + persist.
- Ownership check — user A in workspace X cannot fetch user B's attachment (same workspace but different mailbox owner).
- `removeAttachmentFromDraft` — Storage best-effort delete for fresh uploads, no delete for reprise entries.
- `loadForwardAttachments` — reprise all clean, skip dirty, lazy-fetch non-cached.
- `sendMail` with attachments — Graph payload includes base64 attachments, IMAP SMTP includes multipart, row cloning on reprise (shared storagePath).
- `deleteDraft` — Storage cleanup for fresh uploads.

**E2E Playwright** (gated by `E2E_MAIL_ATTACHMENTS` — same convention as previous iterations):

1. **Upload flow** — go to `/communications`, click `+ Nouveau mail`, drag a text file → "Analyse antivirus…" → attachment visible → send → mail appears in Sent with 📎.
2. **Download flow** — click a received mail with attachments → click Télécharger → signed URL triggers download.
3. **Forward reprise** — click Transférer on a mail with attachments → ComposePanel opens with attachments pre-attached (Reprise badge visible).
4. **Multi-file batch** — drop 3 files at once → 3 progress bars → all visible in the list after scan.

## 11. Rollout

- New runbook `docs/runbooks/mail-attachments.md` covering:
  1. VirusTotal API key setup + quota monitoring.
  2. Supabase Storage bucket creation SQL + RLS policies (must be applied MANUALLY via SQL Editor BEFORE the migration).
  3. Migration procedure (Task 3 will apply via MCP).
  4. Post-check queries.
  5. Common failure modes (VirusTotal timeout → user retries, Graph payload too large → V2 upload sessions, Storage growing → V2 quota).
  6. Manual cleanup SQL for admins.
- Cross-link `mail-send.md`, `graph-integration.md`, `imap-integration.md`.
- Update PRD Communications V1.5: attachments delivered.
- `progress.md` entry + `CLAUDE.md` §11 journal.

## 12. Follow-ups (V2 — triple-tracked to prevent forgetting)

- **Workspace.storageQuotaBytes** — default 5 GB per workspace, enforced at upload. UI banner at 80 %, hard block at 100 %. Also referenced in: `progress.md` § "V2 next" + `docs/runbooks/mail-attachments.md` §5.3 monitoring SQL.
- **Cleanup Inngest cron** — daily job scanning Storage for orphan paths (no DB reference) → delete.
- **Preview inline** — images (< 2 MB) rendered inline, PDF via pdf.js.
- **Graph upload session** for attachments > 3 MB (currently `SEND_FAILED_TOO_LARGE` documented).
- **Batch delete** in the received-mails view (bulk archive with attachment cleanup).
- **Attachments in signatures** — logos, business cards.
- **E2E client-side encryption** — user-controlled key, opt-in.
- **Attachment reference sharing** — a "share this file" link that generates a workspace-scoped public URL (like Google Drive attachments).
