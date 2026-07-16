# IMAP Integration — Design (Communications iter 2)

> **Status:** Approved brainstorming — ready for implementation plan.
> **Depends on:** [`2026-05-28-email-foundations-design.md`](./2026-05-28-email-foundations-design.md) (Microsoft Graph read-only, merged in `feat(communications): email foundations` #3).
> **Author:** Angelo L. + Claude (Opus 4.7)
> **Date:** 2026-07-15

## 1. Goal

Enable NexusHub users to connect **any IMAP mailbox** (OVH Hosted Exchange, Fastmail, iCloud, self-hosted, arbitrary provider) so their emails appear in `/communications` alongside — and in the same UI as — the Microsoft Graph integration already in production. Read-only for V1 (no send, no attachments).

The trigger for this iteration is concrete: the primary user runs a **pro mailbox on OVH Hosted Exchange**, which the Microsoft Graph API does not cover (Graph only speaks to Microsoft 365 cloud). Delivering generic IMAP simultaneously unblocks that use case and covers every non-Microsoft mailbox in one shot.

## 2. Non-goals (V1)

- SMTP send (V1.5)
- Attachments (V1.5, depends on Supabase Storage + antivirus scan)
- Folders other than `INBOX`
- IMAP `IDLE` (real-time push)
- OAuth XOAUTH2 for Gmail/Yahoo — password + app password suffices
- Server-side full-text search (we read from our own DB)
- Detecting messages deleted on the IMAP server (V1.5)
- Bidirectional read/unread sync to the IMAP server (V1 flips the flag locally only, matching Graph V1)

## 3. Design decisions (from brainstorming)

| #   | Decision                                                                                                                                | Rationale                                                                                                     |
| --- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 1   | **Multi-mailbox per user** — one user can connect N IMAPs + 1 Graph simultaneously.                                                     | Real-world: pro OVH + perso Fastmail + shared team alias is common.                                           |
| 2   | **Autodiscover first, manual fallback** — Mozilla ISPDB → `.well-known/autoconfig` → manual form.                                       | Best UX for common providers, still supports anything.                                                        |
| 3   | **Sync = Server Action on `/communications` render, throttled 30 s per mailbox** (same as Graph).                                       | Consistent with the existing pattern; no new infra.                                                           |
| 4   | **Unified `Boîtes email` section on `/integrations`** — one card per mailbox regardless of Graph vs IMAP.                               | Users think in mailboxes, not in providers.                                                                   |
| 5   | **Mailbox filter = dropdown next to the client chip on `/communications`.**                                                             | Compact, discoverable, composes cleanly with the existing client filter (URL: `?mailbox=<id>&client=<slug>`). |
| 6   | **Architecture A** — reuse the `Integration` table (`kind='imap'`), credentials as an AES-GCM-encrypted JSON blob in `encryptedTokens`. | Keeps `EmailMessage` agnostic of source; no duplicated status/last-sync bookkeeping.                          |

## 4. Data model

### 4.1 `IntegrationKind` enum

```prisma
enum IntegrationKind { slack graph fireflies otter imap }
```

### 4.2 `Integration` table — additive fields

```prisma
// Existing (unchanged): encryptedTokens, keyVersion, externalAccountId,
// externalAccountLabel, status, lastSyncedAt, lastError, deltaToken, ...

imapUidValidity   BigInt?  @map("imap_uid_validity")   // per-folder INBOX
imapLastSeenUid   BigInt?  @map("imap_last_seen_uid")  // resume cursor
```

- `encryptedTokens` for IMAP contains `AES-256-GCM({host, port, secure, username, password})` in the same versioned format as Graph tokens (`v1:<keyVersion>:<iv>:<tag>:<ct>`).
- `externalAccountId` = the email address of the mailbox. The existing unique constraint `[workspaceId, kind, ownerUserId, externalAccountId]` prevents connecting the same mailbox twice.
- `externalAccountLabel` = same email address (for display).
- `deltaToken` stays `NULL` for IMAP rows (Graph-only).
- `imapUidValidity` and `imapLastSeenUid` stay `NULL` for Graph rows.

### 4.3 `EmailMessage` table — source-tracking

```prisma
integrationId  String      @map("integration_id") @db.Uuid
integration    Integration @relation(fields: [integrationId], references: [id], onDelete: Cascade)

@@index([workspaceId, integrationId, receivedAt])
```

Also **change the unique constraint** from `[workspaceId, externalId]` to `[workspaceId, integrationId, externalId]`. Rationale: IMAP `externalId` is a per-folder UID and can collide between mailboxes; scoping by `integrationId` fixes this and matches the multi-mailbox model.

### 4.4 Migration plan

Additive-safe SQL, single migration `<timestamp>_imap_integration`:

1. `ALTER TYPE integration_kind ADD VALUE 'imap';` (Postgres requires no rewrite).
2. `ALTER TABLE integrations ADD COLUMN imap_uid_validity BIGINT, ADD COLUMN imap_last_seen_uid BIGINT;`
3. `ALTER TABLE email_messages ADD COLUMN integration_id UUID;`
4. **Backfill** — critical constraint: `EmailMessage` has no `ownerUserId` column, so we cannot recover per-user attribution retroactively. Practical fact: in prod today (2026-07-15), the whole database contains **1 workspace with 1 user and 1 Graph integration**, so a workspace-scoped assignment is safe _and_ correct. Run:

   ```sql
   -- Pre-check that must return 0 rows before migrating:
   SELECT workspace_id, COUNT(*) FROM integrations
   WHERE kind = 'graph' GROUP BY workspace_id HAVING COUNT(*) > 1;

   -- Then backfill:
   UPDATE email_messages em
   SET integration_id = (
     SELECT i.id FROM integrations i
     WHERE i.workspace_id = em.workspace_id AND i.kind = 'graph'
     ORDER BY i.created_at ASC LIMIT 1
   );

   -- Verify: no NULLs left
   SELECT COUNT(*) FROM email_messages WHERE integration_id IS NULL; -- must be 0
   ```

   If a future workspace acquires a second Graph integration **before** this migration runs, an operator must first decide the correct mapping manually. This migration must therefore be applied in a maintenance window immediately after merge, not weeks later.

5. Pre-check `SELECT COUNT(*) FROM email_messages WHERE integration_id IS NULL` returns `0`; then `ALTER TABLE email_messages ALTER COLUMN integration_id SET NOT NULL;`
6. `ALTER TABLE email_messages ADD CONSTRAINT email_messages_integration_fk FOREIGN KEY (integration_id) REFERENCES integrations(id) ON DELETE CASCADE;`
7. `DROP INDEX email_messages_workspace_id_external_id_key;`
   `CREATE UNIQUE INDEX email_messages_workspace_id_integration_id_external_id_key ON email_messages (workspace_id, integration_id, external_id);`
8. `CREATE INDEX email_messages_workspace_id_integration_id_received_at_idx ON email_messages (workspace_id, integration_id, received_at DESC);`

Apply to Supabase manually before merging (project convention — Vercel does not run migrations).

## 5. IMAP adapter package

New folder `packages/integrations/src/imap/`, mirrors `packages/integrations/src/graph/`. **Zero dependency on Prisma or Next** — pure TypeScript, testable in isolation (CLAUDE.md §5.2).

### 5.1 Library choice

**`ImapFlow`** (npm `imapflow`, by Andris Reinman — same author as Nodemailer). Promise-based, native TypeScript typings, actively maintained, supports STARTTLS, implicit TLS, `UIDVALIDITY`, `CONDSTORE`, and `IDLE` (available for V2 without library switch). Alternatives (`node-imap`, `imap-simple`) are callback-based, poorly typed, or stale.

Version + peer deps + breaking changes to be confirmed via **Context7 MCP** at install time (CLAUDE.md §2 mandatory workflow).

### 5.2 Files

- **`client.ts`** — `openImapSession({host, port, secure, username, password})` returns a connected `ImapFlow` instance with 15 s connect timeout and `try/finally { session.logout() }` responsibility left to callers.
- **`autodiscover.ts`** — `autodiscoverImap(email): Promise<AutodiscoverResult | null>` tries in order:
  1. `https://autoconfig.thunderbird.net/v1.1/<domain>` (Mozilla ISPDB, ~5000 known providers, XML).
  2. `https://autoconfig.<domain>/mail/config-v1.1.xml`.
  3. `https://<domain>/.well-known/autoconfig/mail/config-v1.1.xml`.

  Each attempt: 3 s HTTP timeout, no cross-origin redirect follow, XML parsed with `fast-xml-parser` in strict mode (no XXE). Returns `{host, port, secure}` (imap only, we ignore SMTP config in V1) or `null`.

- **`parse.ts`** — `parseImapMessage(raw): ParsedMailMessage`. Reuses the **exact same `sanitize-html` allowlist** as `packages/integrations/src/graph/parse.ts` (single source of truth to be extracted to `packages/integrations/src/mail/sanitize.ts` as part of this iteration). Handles quoted-printable, base64, MIME multipart, unicode headers. Fields extracted: `from`, `to`, `cc`, `subject`, `receivedAt` (Date header, fallback INTERNALDATE), `externalId` (UID as string), `conversationId` (In-Reply-To / References, fallback = SHA-256 of normalized subject).

- **`messages.ts`**:
  - `listInboxInitial({session, sinceDays, maxMessages})` — searches `SINCE <date>`, fetches newest first, caps at `maxMessages`. Returns `{messages, uidValidity, lastSeenUid}`.
  - `listInboxIncremental({session, uidValidity, lastSeenUid})` — checks that server `uidValidity` matches; if not, throws `UidValidityChangedError` (caller resets and refetches). Otherwise fetches `UID > lastSeenUid`, caps at 200 per run. Returns `{messages, uidValidity, lastSeenUid}`.

- **`connection-test.ts`** — `testImapConnection({host, port, secure, username, password}): Promise<{ok: true} | {ok: false, code: 'AUTH' | 'TLS' | 'HOST' | 'TIMEOUT' | 'UNKNOWN', message: string}>`. Opens session, lists INBOX, logs out. Maps ImapFlow errors to codes for stable UX. Never throws.

- **`index.ts`** — barrel exporting the public surface.

### 5.3 Shared type — refactor

Extract a common interface used by both Graph and IMAP adapters:

```ts
// packages/integrations/src/mail/types.ts
export interface ParsedMailMessage {
  externalId: string;
  subject: string;
  fromEmail: string;
  fromName: string | null;
  toRecipients: readonly string[];
  ccRecipients: readonly string[];
  bodyText: string;
  bodyHtmlSanitized: string;
  receivedAt: Date;
  isRead: boolean;
  conversationId: string | null;
}
```

Existing `ParsedGraphMessage` becomes a type alias. Non-breaking rename in Graph code.

## 6. Sync engine

### 6.1 Server actions (`apps/web/features/integrations/actions/`)

- **`testImapConnection(input)`** — called from the add-mailbox modal before saving. Rate-limited via Upstash (key `imap_test`, 5 attempts / user / 5 min). Persists nothing. Returns the connection-test result.
- **`addImapMailbox(input)`** — after a green test, encrypts credentials, creates `Integration(kind='imap', status='active', externalAccountId=<email>, externalAccountLabel=<email>, encryptedTokens=<AES>)`, writes audit event `mailbox_connected`, redirects to `/integrations?connected=imap`.
- **`updateImapCredentials(integrationId, input)`** — for the `Reconnecter` flow when a password changed. Same test-then-encrypt-then-save path, but `UPDATE` instead of `INSERT`. Audit: `mailbox_credentials_updated`.
- **`disconnectImapMailbox(integrationId)`** — `status='revoked'`, `encryptedTokens=null`, `imapUidValidity=null`, `imapLastSeenUid=null`. Audit: `mailbox_disconnected`. **Does not delete `EmailMessage` rows** — same convention as the current Graph disconnect (mails stay visible + still linked to their client). A separate future action can purge if desired.

All actions gated by `requireUser()` + ownership check: `integrationId` must match `workspaceId + ownerUserId + kind='imap'`. Test-covered.

### 6.2 `syncImapMailbox(integrationId)` (`apps/web/features/communications/actions/sync-imap-inbox.ts`)

Mirror of `sync-graph-inbox.ts`:

1. `requireUser()`, load Integration with ownership check + `status='active'`.
2. Throttle: bail out `{ok: true, throttled: true}` if `lastSyncedAt` is within 30 s.
3. Decrypt `encryptedTokens`; open ImapFlow session inside a `try/finally { session.logout() }`.
4. `SELECT INBOX` → read server `uidValidity`.
5. If `imapUidValidity === null` → initial fetch (30 days, 200 max).
6. Else if server `uidValidity !== imapUidValidity` → reset (folder invalidated), refetch initial, overwrite `imapUidValidity`. Audit: `mailbox_uid_reset`.
7. Else → incremental fetch (`UID > imapLastSeenUid`, cap 200 per run).
8. Upsert each `ParsedMailMessage` into `EmailMessage` with `integrationId` set. Auto-associate via `matchClientByDomain` (reused as-is).
9. Update `Integration.lastSyncedAt` on **both** success and failure paths (bump + set `lastError`), so the page-render throttle protects against retry storms exactly as it does for Graph.
10. Return `{ok: true, fetched, uidValidityChanged?}` or `{ok: false, message}`.

### 6.3 `/communications/page.tsx` trigger

Collect **all** the current user's active integrations of kind `graph` or `imap`, launch their syncs in parallel with `Promise.allSettled`, then render the mail list. `allSettled` guarantees one failing IMAP does not stall the Graph sync (or another IMAP).

**No IDLE, no CONDSTORE, no non-INBOX folders, no server-side delete detection** — V1 YAGNI.

## 7. UI

### 7.1 `/integrations` — unified `Boîtes email` section

```
Intégrations
─────────────
Boîtes email                              [+ Ajouter une boîte]
┌────────────────────────────────────────────────────────┐
│ ● angelo@outlook.com          Microsoft  ·  il y a 2m │ [Déconnecter]
├────────────────────────────────────────────────────────┤
│ ● contact@agence.ovh          IMAP       ·  il y a 5m │ [Déconnecter]
├────────────────────────────────────────────────────────┤
│ ⚠ perso@fastmail.com          IMAP       ·  erreur    │ [Reconnecter] [Déconnecter]
└────────────────────────────────────────────────────────┘

Autres intégrations                       (Slack, Fireflies…)
```

**Components:**

- **`MailboxCard`** — new shared component replacing `OutlookCard`. Props `{integrationId, kind, label, status, lastSyncedAt, lastError}`. Status badge = `● active` / `⚠ error` / `○ revoked` using existing design tokens (`--color-success`, `--color-danger`, `--color-text-muted`). Type = neutral tag (`Microsoft` or `IMAP`). Actions vary by status. **Design tokens only, zero hex** (CLAUDE.md rule).
- **`MailboxList`** — server component, maps user's Integrations where `kind IN ('graph','imap') AND status IN ('active','error')`, ordered by `createdAt asc`. Empty state = one CTA card `Aucune boîte connectée · Ajouter`.
- **`AddMailboxModal`** — client component, two-step:
  1. **Type picker** — two large buttons `Microsoft` (Outlook / Exchange Online → reuses `startGraphOAuth`) or `IMAP` (any provider).
  2. **IMAP form** — progressive:
     - Field `Adresse email` → on blur, calls `autodiscoverImap(email)` (loading indicator).
       - Success: shows `✓ Détecté : imap.<host>:<port> (TLS)`, hides advanced fields, user only enters `Mot de passe`.
       - Failure: `Serveur IMAP`, `Port`, `TLS` become editable (defaults `993` + `TLS on`), user also enters `Mot de passe`.
     - `[Tester la connexion]` button (required, calls `testImapConnection`, shows green ✓ or red ✗ with error message).
     - `[Enregistrer]` disabled until the test passes (calls `addImapMailbox`).
     - Help text: « Si ton compte a la 2FA activée, utilise un mot de passe d'application. »

Reconnect flow for a mailbox in `error`: opens the same modal pre-filled with existing host/port/username, blank password field, then calls `updateImapCredentials` on save.

### 7.2 `/communications` — mailbox filter

Toolbar row above the mail list, next to the existing client chip:

```
[Client : Tous ▾]  [Boîte : Toutes ▾]  Dernier sync : il y a 12s
```

- **`MailboxFilter`** — new client component using Radix Select. Options: `Toutes` + one per active integration (label = email). URL: `?mailbox=<integrationId>`, composes with `?client=<slug>`. Zustand for cross-tab coherence (same pattern as the client filter — CLAUDE.md §6.1).
- On the `Toutes` view, each row in `MailList` shows a small secondary badge with the source mailbox email (`text-muted`, below the sender name). On a filtered view the badge is hidden (redundant).
- Prisma query update: `where: { workspaceId, deletedAt: null, ...(clientFilter ? { clientId } : {}), ...(mailboxFilter ? { integrationId: mailboxFilter } : {}) }`.
- `MailTabs.lastSyncedAt` now takes the `MAX(lastSyncedAt)` across the visible mailboxes.

## 8. Security (CLAUDE.md §4)

- **Credentials encrypted at rest** — `AES-256-GCM` via existing helper, same `ENCRYPTION_KEY`, same versioned format. Payload = `JSON.stringify({host, port, secure, username, password})`.
- **Password never logged, never returned** — Sentry `beforeSend` already scrubs `password`. A dedicated test decrypts a mailbox, exercises the sync path, and asserts no log line under `sync-imap:*` contains the password value.
- **Rate limit on `testImapConnection`** — new Upstash key `imap_test`, 5 attempts / user / 5 min. Prevents the form from being used to enumerate or bruteforce an external IMAP from our IP.
- **TLS mandatory** — `secure: true` default. `secure: false` requires an explicit checkbox `Serveur non chiffré (déconseillé)` with a red warning. No known preset needs it; escape hatch for legacy self-hosted only.
- **Ownership check** in every server action — `integrationId` must match `workspaceId + ownerUserId + kind='imap'`. Dedicated unit test (multi-tenant leak = merge blocker per CLAUDE.md §4.4.2).
- **Audit log** (existing `audit_log` table, append-only): `mailbox_connected` (kind, email, host, port — never password), `mailbox_disconnected`, `mailbox_credentials_updated`, `mailbox_test_failed` (error code only, no captured inputs), `mailbox_uid_reset`.
- **Autodiscover safety** — 3 s HTTP timeout per attempt, no cross-origin redirect follow, XML parsed in strict mode (no XXE). Only the email domain is sent externally; never the password.

## 9. Error handling

| Case                                                              | Behavior                                                                                                                           |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| User changed the mailbox password                                 | Sync writes `status='error'`, `lastError='AUTH'`. Card on `/integrations` shows ⚠ with `[Reconnecter]` CTA.                        |
| IMAP server down / timeout                                        | `status='error'`, `lastError='HOST timeout'`. Next render retries (throttle 30 s protects against tight retry).                    |
| `UIDVALIDITY` changed on the server                               | Silent reset — refetch initial. Audit: `mailbox_uid_reset`.                                                                        |
| Autodiscover unreachable (Mozilla ISPDB, DNS, malformed XML)      | UI falls back to manual form without blocking. Discreet notice: « Détection auto indisponible. »                                   |
| Connection test passes but sync fails (e.g. INBOX not accessible) | Row saved; first sync flips `status='error'` with explicit message; user sees the error immediately on next `/integrations` visit. |
| Concurrent syncs for same mailbox                                 | Throttle + `Promise.allSettled` are enough. No explicit DB lock (YAGNI V1).                                                        |

## 10. Testing (CLAUDE.md §5.4)

**Unit — `packages/integrations/src/imap/` (target 100 %):**

- `parse.ts` — unicode headers, quoted-printable, base64, multipart MIME, HTML with `<script>` stripped by the shared sanitize allowlist, missing Date header fallback to INTERNALDATE.
- `autodiscover.ts` — fixture XML for each of the three probing paths, timeout path, malformed XML → `null`, XXE payload rejected.
- `client.ts` — connect timeout, `logout()` always called on error paths.
- `messages.ts` — initial fetch with `sinceDays` boundary, incremental with `UID > cursor`, `UIDVALIDITY` mismatch throws `UidValidityChangedError`.
- `connection-test.ts` — error mapping to stable codes (`AUTH`, `TLS`, `HOST`, `TIMEOUT`, `UNKNOWN`).

**Integration — `apps/web/features/…` (Prisma test DB):**

- `addImapMailbox` happy path + ownership rejection.
- `updateImapCredentials` for reconnect flow.
- `disconnectImapMailbox` — flips status, nullifies encryptedTokens + UID state, leaves EmailMessage rows intact.
- `syncImapMailbox` — initial vs incremental vs uidvalidity-reset scenarios (using a fake ImapFlow).
- `testImapConnection` rate limit: 6th call in 5 min returns 429 with `Retry-After`.
- Migration backfill — seed workspace with a Graph integration + 3 emails, run migration, assert `integration_id` populated + new unique index in place.
- `/communications` combines client + mailbox filter in Prisma query.

**E2E — Playwright (`e2e/tests/imap-integration.spec.ts`):**

- Smoke 1: `/integrations` → `[+ Ajouter une boîte]` → IMAP → email + password → autodiscover mocked → test OK → save → back on `/integrations` with the new card in ✓ state.
- Smoke 2: `/communications` → `Boîte : Toutes ▾` dropdown lists the mailbox → selecting it filters the list.

**Adapter fakes vs live server** — CI uses a fake `ImapFlow` implementing the interface (fast, deterministic). A local `pnpm imap:dev` helper spins up `greenmail` in Docker for manual verification.

## 11. Rollout & docs

- Runbook `docs/runbooks/imap-integration.md` — env vars (none new — reuses `ENCRYPTION_KEY` + Upstash), migration order, Azure changes (none — IMAP does not touch Azure), rollback (`revoked` all imap rows, drop new column via down-migration).
- Update `docs/runbooks/microsoft-graph-integration.md` cross-link to the new IMAP runbook.
- Update `PRD-NexusHub.md` §Communications to note both Graph and generic IMAP as V1 sources.
- Update `progress.md` under Communications after each task.

## 12. Open follow-ups (post-V1, tracked but not in this scope)

- Purge-on-disconnect option (Admin-triggered, per mailbox).
- Detect messages deleted on the IMAP server (periodic reconciliation).
- Bidirectional read/unread flag with both providers.
- Support other folders (Sent, custom labels).
- IMAP `IDLE` for real-time push (requires long-running worker; not Vercel-native).
- OAuth XOAUTH2 for Gmail / Yahoo (nice-to-have; app password already works).
- Attachments (waits on Storage + antivirus infra).
- SMTP send (own iteration — coupled with the Graph send story).
