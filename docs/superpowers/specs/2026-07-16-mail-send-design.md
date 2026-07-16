# Mail Send — Design (Communications iter 3)

> **Status:** Approved brainstorming — ready for implementation plan.
> **Depends on:** [`2026-05-28-email-foundations-design.md`](./2026-05-28-email-foundations-design.md) (Graph read-only) and [`2026-07-15-imap-integration-design.md`](./2026-07-15-imap-integration-design.md) (IMAP read-only), both merged.
> **Author:** Angelo L. + Claude (Opus 4.7)
> **Date:** 2026-07-16

## 1. Goal

Add outbound mail — reply, reply-all, forward, and new message — to NexusHub Communications. Works for both mailbox kinds already supported for read: Microsoft Graph (Outlook / M365) via the `sendMail` API, and generic IMAP mailboxes (OVH, Fastmail, self-hosted, …) via SMTP with `nodemailer`. The existing `MailReader` already shows a `↩ Répondre — bientôt (itération 2)` placeholder — this iteration is the promised follow-through.

The compose UX targets the closest practical approximation of macOS Mail on the web: a floating bottom-right panel with rich-text minimal, auto-saved drafts persisted in the DB, and quoted-original threading on Reply/Forward.

## 2. Non-goals (V1)

- Attachments (V1.5 — depends on Supabase Storage bucket + antivirus scan pipeline)
- Multi-compose simultaneously with dockable panels (V1.5 — closer to the macOS Mail feel)
- Auto-retry via Inngest cron (V1.5 — manual retry button in V1)
- HTML signatures with external images / logos (V1 = HTML text + links only)
- BCC transformed into per-recipient separate messages
- Schedule send / delayed delivery
- Templates or snippets
- Undo-send (30-second hold pattern)
- Reply-to override (default = From)
- Threaded conversation view (grouping mails by `conversationId`)
- Dedicated Sent tab in `MailTabs` (V1 = sent messages appear in the same list with a `✓ Envoyé` badge)

## 3. Design decisions (from brainstorming)

| #   | Decision                                                                                                                                                                                                                         | Rationale                                                                                                                                                                              |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Scope V1 = Reply + Reply-All + Forward + New**                                                                                                                                                                                 | Full outbound scope in one iteration — user preference.                                                                                                                                |
| 2   | **SMTP config for IMAP mailboxes** — autodiscover the outgoing server from the same Mozilla ISPDB XML, store next to the IMAP creds in the same AES-GCM blob.                                                                    | Free — the XML already has both `incomingServer type="imap"` and `outgoingServer type="smtp"`.                                                                                         |
| 3   | **Existing IMAP mailboxes without SMTP config** — the first `sendMail` call from that mailbox returns `SMTP_NOT_CONFIGURED`; the UI opens the mailbox modal in "update SMTP" mode. Zero self-healing / fallback derivation code. | Prod today has one user with one IMAP mailbox — a one-shot manual reconfig is simpler than a fallback pipeline.                                                                        |
| 4   | **Compose UX** — floating panel bottom-right (~600×500), single compose at a time in V1, minimize/close controls.                                                                                                                | Closest practical macOS-Mail feel while keeping V1 shippable. Multi-compose is a V1.5 iteration.                                                                                       |
| 5   | **Rich text minimal** — Tiptap (StarterKit + Link + Underline).                                                                                                                                                                  | 30 KB gzip, TypeScript-native, clean HTML output, sanitize-friendly.                                                                                                                   |
| 6   | **Drafts persisted in the DB** — one active draft per user per workspace.                                                                                                                                                        | Cross-device natural. Auto-save on 2 s idle. Cleared on send. Prompt on new-compose-with-existing-draft.                                                                               |
| 7   | **Signatures per mailbox** (`Integration.signatureHtml`), editable in Settings.                                                                                                                                                  | Users have different signatures for perso vs pro.                                                                                                                                      |
| 8   | **Sent handling — full parity**: insert `EmailMessage(folder='sent', sendStatus=…)` locally, `saveToSentItems=true` for Graph, IMAP `APPEND` to the auto-detected Sent folder.                                                   | Cross-webmail consistency: the sent mail appears in the native webmail too.                                                                                                            |
| 9   | **Outbox pattern** — insert queued row immediately, then send synchronously with status transitions `queued → sending → sent \| failed`, retry button on failed rows.                                                            | Persisted trace + resilience to browser disconnect. Vercel serverless completes the function even if the client disconnects; the queued row protects against pre-Vercel network drops. |
| 10  | **Toast confirmation** on send success + toast on failure with `Retry` CTA.                                                                                                                                                      | Explicit user feedback — added to scope during brainstorming.                                                                                                                          |
| 11  | **Rate limit `mail_send`** — 50/user/hour + 300/user/day, plus a 20-recipient hard cap per message.                                                                                                                              | Anti-relay-abuse baseline.                                                                                                                                                             |

## 4. Data model

### 4.1 `Integration` — signature column

```prisma
signatureHtml  String?  @map("signature_html") @db.Text
```

Per-mailbox. Null = no signature (user hasn't set one). Sanitized via `sanitizeMailHtml` on save.

### 4.2 `MailDraft` — new table

```prisma
model MailDraft {
  id                String        @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  workspaceId       String        @map("workspace_id") @db.Uuid
  userId            String        @map("user_id") @db.Uuid
  fromIntegrationId String        @map("from_integration_id") @db.Uuid
  /// Discriminates the auto-quote / pre-fill behavior at compose time.
  kind              MailDraftKind
  /// Original mail id when kind IN (reply, reply_all, forward). Null for new.
  replyToId         String?       @map("reply_to_id") @db.Uuid
  toRecipients      String[]      @default([]) @map("to_recipients")
  ccRecipients      String[]      @default([]) @map("cc_recipients")
  bccRecipients     String[]      @default([]) @map("bcc_recipients")
  subject           String        @default("")
  bodyHtml          String        @default("") @map("body_html") @db.Text
  createdAt         DateTime      @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt         DateTime      @updatedAt @map("updated_at") @db.Timestamptz(6)

  workspace       Workspace     @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  fromIntegration Integration   @relation(fields: [fromIntegrationId], references: [id], onDelete: Cascade)
  replyTo         EmailMessage? @relation(fields: [replyToId], references: [id], onDelete: SetNull)

  @@unique([workspaceId, userId])  // one active draft per user per workspace
  @@index([workspaceId, userId])
  @@map("mail_drafts")
}

enum MailDraftKind { reply reply_all forward new_mail }
```

### 4.3 `EmailMessage` — outbox pattern columns

```prisma
sendStatus    EmailSendStatus?  @map("send_status")
sendError     String?           @map("send_error")
sentByUserId  String?           @map("sent_by_user_id") @db.Uuid
sentByUser    User?             @relation(fields: [sentByUserId], references: [id], onDelete: SetNull)
```

```prisma
enum EmailSendStatus { queued sending sent failed }
```

Semantics:

- `sendStatus = NULL` on received mails (inbound Graph / IMAP). The existing `folder` value stays `inbox`.
- `sendStatus IN (queued, sending, sent, failed)` on outbound mails. `folder = 'sent'` on all four.
- `sentByUserId` — attribution: which team member sent this from a shared mailbox (future-proof; V1 is per-user but the column is cheap to add now).

### 4.4 Migration

Additive-safe, single migration `<timestamp>_mail_send_foundations`:

1. `CREATE TYPE mail_draft_kind AS ENUM ('reply','reply_all','forward','new_mail');`
2. `CREATE TYPE email_send_status AS ENUM ('queued','sending','sent','failed');`
3. `ALTER TABLE integrations ADD COLUMN signature_html TEXT;`
4. `ALTER TABLE email_messages ADD COLUMN send_status email_send_status, ADD COLUMN send_error TEXT, ADD COLUMN sent_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL;`
5. `CREATE TABLE mail_drafts (…columns…);` + `UNIQUE(workspace_id, user_id)` + FKs with `ON DELETE CASCADE` for workspace / integration and `ON DELETE SET NULL` for `reply_to_id`.
6. `CREATE INDEX mail_drafts_workspace_id_user_id_idx ON mail_drafts (workspace_id, user_id);`

Apply to shared Supabase manually before merging (project convention — Vercel does not run migrations).

## 5. SMTP adapter (`packages/integrations/src/smtp/`)

New folder mirrors the imap adapter shape. Zero dependency on Prisma or Next — pure TypeScript, testable in isolation.

### 5.1 Library — `nodemailer`

Same author as ImapFlow + mailparser (Andris Reinman). TypeScript typings native, actively maintained, industry-standard. Version + peer deps to be validated via Context7 MCP at install time.

### 5.2 Files

- **`client.ts`** — `openSmtpTransport({host, port, secure, requireTls, username, password})` returns a connected `Transporter` with 15 s connect timeout and `pool: false` (per-send transport, closed after use — matches the IMAP session-per-op pattern).
- **`send.ts`** — `sendViaSmtp(transport, mail)` where `mail` is the normalized send payload (see §7). Wraps `transport.sendMail`, returns `{messageId, envelope, accepted, rejected}`. Throws a typed `SmtpSendError` on transport failure or 4xx/5xx response.
- **`imap-append.ts`** — `appendToSentFolder(imapSession, rawRfc822): Promise<void>`. Detects the Sent folder name via `LIST '' '*'` (tries in order: `Sent`, `Sent Items`, `Sent Mail`, `INBOX.Sent`, `[Gmail]/Sent Mail`), then `session.append(folderName, rawRfc822, ['\\Seen'])`. No-op with a warning log if none matches.
- **`connection-test.ts`** — `testSmtpConnection(creds): Promise<ConnectionTestResult>`. Wraps `transport.verify()`, maps errors to the same stable code union as IMAP (`AUTH`, `TLS`, `HOST`, `TIMEOUT`, `UNKNOWN`).
- **`index.ts`** — barrel.

### 5.3 Refactored autodiscover (shared with IMAP)

**Refactor** `packages/integrations/src/imap/autodiscover.ts` into `packages/integrations/src/mail/autodiscover.ts` (shared module):

```ts
export interface MailServerConfig {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  /** STARTTLS required on a non-TLS port. Distinguishes port 587 (STARTTLS) from 465 (implicit TLS). */
  readonly requireTls?: boolean;
}

export interface AutodiscoverMailResult {
  readonly imap: MailServerConfig | null;
  readonly smtp: MailServerConfig | null;
}

export async function autodiscoverMail(email: string): Promise<AutodiscoverMailResult>;
```

Parses both `incomingServer type="imap"` and `outgoingServer type="smtp"` from the same clientConfig XML. Backward-compat: existing `autodiscoverImap(email)` becomes a wrapper returning `.imap`.

### 5.4 Extending `Integration.encryptedTokens` for IMAP

The AES-GCM blob for IMAP mailboxes gains the SMTP config:

```json
{
  "imap": { "host": "…", "port": 993, "secure": true, "username": "…", "password": "…" },
  "smtp": {
    "host": "…",
    "port": 587,
    "secure": false,
    "requireTls": true,
    "username": "…",
    "password": "…"
  }
}
```

`username` / `password` are duplicated across both blocks — most providers use the same for IMAP + SMTP, but the spec keeps them separate to support the odd case (Gmail app password with different SMTP auth). The old shape `{host, port, secure, username, password}` (no `imap`/`smtp` wrapper) remains readable for backward compat: `getValidImapCredentials` falls back to `blob.imap ?? blob` (old shape treated as imap-only, smtp derivation prompts the user to configure).

## 6. Graph send

New file `packages/integrations/src/graph/send.ts`:

```ts
export interface GraphSendPayload {
  readonly subject: string;
  readonly toRecipients: readonly string[];
  readonly ccRecipients: readonly string[];
  readonly bccRecipients: readonly string[];
  readonly bodyHtmlSanitized: string;
  readonly conversationId?: string | null; // reply/forward threading
  readonly inReplyToMessageId?: string | null; // Graph reply endpoint
}

export interface GraphSendResult {
  readonly messageId: string;
  readonly conversationId: string;
}

export async function sendViaGraph(
  token: string,
  payload: GraphSendPayload,
): Promise<GraphSendResult>;
```

Uses `POST /me/sendMail` with `saveToSentItems: true` (auto-archives in the user's Sent Items — free, no extra call). For Reply/Forward, uses `POST /me/messages/{id}/reply` or `/replyAll` or `/forward` when `inReplyToMessageId` is set — Graph handles threading + quote of original automatically for those endpoints. For New, uses `/sendMail` with the payload constructed from scratch.

Rate-limit + timeout: retry on 429 and 503 with exponential backoff (already implemented in `packages/integrations/src/graph/client.ts` — reuse via the existing `graphFetch` helper).

## 7. Send orchestration

### 7.1 Server action `sendMail`

`apps/web/features/communications/actions/send-mail.ts` — single entry point that dispatches by mailbox kind.

**Input schema (Zod):**

```ts
const sendMailSchema = z.object({
  fromIntegrationId: z.string().uuid(),
  mode: z.enum(['reply', 'reply_all', 'forward', 'new_mail']),
  replyToId: z.string().uuid().optional(),
  toRecipients: z.array(z.string().email()).min(1).max(20),
  ccRecipients: z.array(z.string().email()).max(20).default([]),
  bccRecipients: z.array(z.string().email()).max(20).default([]),
  subject: z.string().min(1).max(998),
  bodyHtml: z.string().min(1).max(500_000), // 500 KB — a mail with a full quoted thread + signature
});
```

The 20-recipient cap is total across to+cc+bcc: enforced by a `.refine` on the object.

**Steps** (§3.3 pseudocode above; ordering pinned):

1. `requireUser` + Zod parse.
2. Rate limit `mail_send` on `ctx.userId`. Returns `RATE_LIMIT` with `retryAfter` on failure.
3. Load `Integration` with ownership check (`workspaceId + ownerUserId + status='active'`). Returns `MAILBOX_NOT_FOUND` if missing.
4. Sanitize `bodyHtml` via `sanitizeMailHtml` (double barrier — the client already sanitizes but we don't trust it).
5. **Outbox insert** — create `EmailMessage(sendStatus='queued', folder='sent', fromEmail=integration.externalAccountId, sentByUserId=ctx.userId, …)` with a placeholder `externalId = 'nx-<uuid>'` (replaced with the server-assigned messageId on success).
6. Flip `sendStatus='sending'`.
7. Dispatch by kind:
   - `graph` → `sendViaGraph(token, payload)`. Get `messageId` + `conversationId`.
   - `imap` → `sendViaImapSmtp(integrationId, payload)`:
     - Decrypt creds. If `blob.smtp` missing → return `SMTP_NOT_CONFIGURED`.
     - `openSmtpTransport(blob.smtp)`. `sendViaSmtp(transport, payload)`.
     - Then `openImapSession(blob.imap)` and `appendToSentFolder(session, rawRfc822)`. On APPEND failure, log warning but still mark the mail sent (server accepted delivery — the local + Sent-folder record is best-effort).
8. On success:
   - Update outbox row: `sendStatus='sent'`, `externalId = messageId`, `conversationId = result.conversationId ?? existing`.
   - Delete the user's `MailDraft` row.
   - Audit `mail_sent`.
   - Return `{ok: true, emailMessageId}`.
9. On failure (SMTP / Graph error, network, timeout):
   - Update outbox row: `sendStatus='failed'`, `sendError=message`. Draft is **NOT** deleted — user can retry or edit.
   - Audit `mail_send_failed` (error code + integration id only, no PII).
   - Return `{ok: false, code, message, emailMessageId}`.

### 7.2 Retry action `retrySendMail(emailMessageId)`

Ownership check on the outbox row (`sentByUserId === ctx.userId`), only allowed when `sendStatus='failed'`. Flips to `queued` then re-runs steps 6-9 of `sendMail` with the row's stored recipients / subject / bodyHtml (idempotent — no new draft touched).

### 7.3 Threading

- **IMAP SMTP** (`nodemailer.sendMail`): pass `inReplyTo: <original Message-ID>` + `references: <threading chain>`. The original RFC 5322 `Message-ID` is already stored in `EmailMessage.conversationId` — the IMAP `parse.ts` maps `envelope.messageId ?? envelope.inReplyTo` into that column during sync (see `packages/integrations/src/imap/parse.ts`). For a first reply, `references` is just `<original Message-ID>`; for a Reply-to-a-reply, the chain lengthens (see §12 follow-up to persist the References header on the original mail if we want deeper chains).
- **Graph**: use the `/reply`, `/replyAll`, or `/forward` endpoints when `inReplyToMessageId` is set — Graph reconstructs the thread server-side. For `new_mail`, use `/sendMail` fresh.

### 7.4 Quote-of-original

Constructed client-side in the `ComposePanel` at pre-fill time:

- **Reply / Reply-All**: header `── Le {date}, {from} a écrit ──` + `<blockquote>{sanitized original HTML}</blockquote>` (or `> `-prefixed lines for plain-text originals).
- **Forward**: `---------- Forwarded message ---------- \n From: {from} \n Date: {date} \n Subject: {subject} \n To: {to}` + full body.

Body already carries the quote by the time it hits the server action — no server-side rebuild.

## 8. Compose UI

### 8.1 `ComposePanel` (`apps/web/features/communications/components/compose-panel.tsx`)

Client component, floating bottom-right, `fixed z-40`, ~600×500 px, min-width 480. Header (title + minimize + close), body (From dropdown, To/CC/BCC pills, Subject, Tiptap editor, signature preview), footer (Enregistrer brouillon / Annuler / Envoyer).

**Zustand store** `useComposePanelStore`:

```ts
{
  isOpen: boolean;
  mode: 'reply' | 'reply_all' | 'forward' | 'new_mail';
  replyTo: EmailMessagePreview | null;
  minimized: boolean;
  open(input): void;
  close(): void;
  toggleMinimize(): void;
}
```

Triggered from:

- `MailReader` — buttons `↩ Répondre`, `↩↩ Répondre à tous`, `➡ Transférer` (replacing the current stub).
- `/communications` page toolbar — button `+ Nouveau mail` (opens the panel in `new_mail` mode).

### 8.2 Rich-text editor — Tiptap

Extensions: `StarterKit` (paragraph, bold, italic, strike, code, heading, bulletList, orderedList, listItem), `Link` (with `HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' }`), `Underline`.

Toolbar 6 buttons: **B I U 🔗 • 1.** — each toggles the corresponding mark or node. All active states styled via design tokens (accent color on active).

Output: `editor.getHTML()` — clean HTML string. Sanitized via `sanitizeMailHtml` before insertion in the DB / send payload.

### 8.3 Pre-fill by mode

Reused from §5.3 of the brainstorming:

| Mode        | From                                                                           | To                    | CC                                                                     | Subject                                               | Body                                                                                  |
| ----------- | ------------------------------------------------------------------------------ | --------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `reply`     | integration of the original                                                    | `[replyTo.fromEmail]` | `[]`                                                                   | `Re: <subject>` (skip if already starts with `Re:`)   | signature + `<br><br>` + quoted original                                              |
| `reply_all` | idem                                                                           | `[replyTo.fromEmail]` | `replyTo.toRecipients ∪ replyTo.ccRecipients` minus caller's own email | idem                                                  | idem                                                                                  |
| `forward`   | idem                                                                           | `[]`                  | `[]`                                                                   | `Fwd: <subject>` (skip if already starts with `Fwd:`) | signature + `<br><br>` + `---------- Forwarded message ----------` header + full body |
| `new_mail`  | first `active` mailbox of the user (Graph or IMAP, ordered by `createdAt asc`) | `[]`                  | `[]`                                                                   | `''`                                                  | signature only                                                                        |

### 8.4 Draft persistence

- On any change to `to/cc/bcc/subject/bodyHtml/from`, debounce 2 s → call `saveDraft(input)` server action.
- `saveDraft` upserts on the composite key `[workspaceId, userId]` — one active slot.
- Panel open:
  - If a draft exists AND (mode='new_mail' OR the draft's `replyToId` matches the current `replyTo?.id`) → load draft.
  - Else if a draft exists AND doesn't match → prompt `Vous avez un brouillon en cours pour un autre mail. Le supprimer ou l'ouvrir à la place ?` with three buttons (`Supprimer et créer nouveau` / `Ouvrir le brouillon existant` / `Annuler`).
- On send success (server action deletes the draft) → close panel + toast.
- On cancel / close-with-content → draft stays in DB (auto-save covered it).

### 8.5 SMTP-not-configured flow

When `sendMail` returns `SMTP_NOT_CONFIGURED`, the ComposePanel shows a blocking inline banner:

```
⚠ Configuration SMTP requise pour envoyer depuis <email>.
[Configurer maintenant]
```

CTA opens `AddMailboxModal` in `updateSmtpFor` mode: email + IMAP host disabled, SMTP host/port/TLS empty and editable, `[Tester la connexion]` then `[Enregistrer]`. On save, the modal emits a Zustand event `smtp-configured:<integrationId>` that the ComposePanel listens to — it clears the banner and re-enables the Send button. No route refresh needed.

## 9. Signatures — Settings UI

New page or section: `apps/web/app/(app)/settings/mailboxes/page.tsx` (or an added section under an existing `/settings` route — check the current shape first).

Per-mailbox card:

- Mailbox label + kind badge
- Tiptap editor (same setup as ComposePanel), pre-filled with `integration.signatureHtml ?? ''`
- `[Enregistrer]` button → server action `updateSignature(integrationId, signatureHtml)`:
  - Ownership check (`workspaceId + ownerUserId`)
  - `sanitizeMailHtml` on input
  - `prisma.integration.update` on `signatureHtml`
  - Audit `signature_updated`

## 10. Security (CLAUDE.md §4)

- **Rate limit `mail_send`** — new `RateLimitKey` value, dual window: 50 / user / hour AND 300 / user / day. Both checked; whichever exhausted first wins. `getRateLimiter('mail_send')` uses Upstash sliding-window (already-installed infra).
- **Recipient hard cap 20** across `to + cc + bcc` — Zod refinement.
- **From lock** — the SMTP `From` header (and Graph `sender`) is **always** derived from `integration.externalAccountId`. The client's From field is display-only + gates which integration to use; the server ignores it.
- **XSS double-barrier** — client sanitize (Tiptap output) + server `sanitizeMailHtml` before DB insert and before payload construction. `dangerouslySetInnerHTML` remains banned except in `MailReader` where the body already passes through the shared sanitize allowlist.
- **Credentials at rest** — SMTP creds live in the same AES-GCM blob as IMAP (`ENCRYPTION_KEY`, versioned `v1:<keyVersion>:iv:tag:ct`). No new keys, no new format.
- **Audit log**:
  - `mail_sent` — actor, integration id, `to_domain` (recipient domain(s), no full addresses), message id
  - `mail_send_failed` — actor, integration id, error code (not the raw message — could contain PII)
  - `signature_updated` — actor, integration id
  - Drafts are **not** audit-logged (bruit + contient body PII).
- **No password / signature / body content in logs**. Sentry `beforeSend` already scrubs `password` and `encryptedTokens`; add `bodyHtml` and `signatureHtml` to the scrub list.

## 11. Testing

**Unit — `packages/integrations/src/smtp/`** (target 100 %):

- `client.ts` — connect timeout, `transport.close()` in finally, mocked nodemailer.
- `send.ts` — payload construction with threading headers (`inReplyTo`, `references`), HTML/text alt part, UTF-8 addr encoding.
- `imap-append.ts` — folder auto-detect (mock LIST responses; ensure `Sent Items` wins over `Trash`, prefix like `INBOX.Sent` works), APPEND with `\Seen` flag.
- `connection-test.ts` — error mapping matches IMAP's shape.

**Unit — `packages/integrations/src/graph/send.ts`**:

- Payload shape, `saveToSentItems=true` default, `/reply` vs `/sendMail` dispatch by `inReplyToMessageId`.

**Unit — `packages/integrations/src/mail/autodiscover.ts`** (refactor):

- Dual return shape from a single XML, backward-compat `autodiscoverImap` wrapper.

**Integration — server actions** (Prisma test DB):

- `sendMail` happy path Graph + IMAP.
- Outbox pattern: row transitions `queued → sending → sent`.
- Failure path: row → `failed` with `sendError`, audit event, draft **not** deleted.
- Rate-limit exhaustion (hour + day).
- Recipient-cap rejection.
- Ownership rejection (mailbox not owned).
- `SMTP_NOT_CONFIGURED` path.
- `retrySendMail` idempotence and ownership check.
- `saveDraft` upsert, `loadDraft`, `deleteDraft`, one-slot-per-user isolation.
- `updateSignature` sanitize + ownership.

**E2E — Playwright smoke** (gated by `E2E_MAIL_SEND` env var to match the existing pattern):

- Reply flow: open a mail → click Reply → panel opens pre-filled → type → Send → toast → panel closes → new row appears with `✓ Envoyé` badge.
- Signature: Settings → save → open compose → signature auto-inserted at cursor position.
- Failure UX: mock a send failure → row appears with `⚠ Échec`, click `Réessayer` → new attempt.

## 12. Follow-ups (post-V1)

- Attachments (V1.5) — Storage bucket + antivirus + upload UI + Forward-reprise of original attachments.
- Multi-compose dockable panels (V1.5).
- Inngest cron auto-retry for `sendStatus='failed'` older than N minutes.
- Persist the RFC 5322 `References` header on inbound IMAP mails (currently we store only the `Message-ID` in `conversationId`). Needed to build deeper threading chains when replying to a reply-to-a-reply — V1 uses `<original Message-ID>` alone which is correct for single-hop threads but truncates the ancestry beyond that.
- HTML signatures with images / logos hosted on our Storage.
- BCC-as-separate-messages (privacy hardening).
- Schedule send.
- Templates / snippets.
- Undo-send (30 s hold).
- Reply-to override.
- Threaded conversation view.
- Dedicated Sent tab in `MailTabs`.

## 13. Rollout

- Runbook `docs/runbooks/mail-send.md` — env vars (none new; reuses `ENCRYPTION_KEY`, Upstash), migration order, rate-limit tuning, common send failures (SMTP AUTH, TLS mismatch, Graph 4xx/5xx).
- Update the two existing mail runbooks (`microsoft-graph-integration.md`, `imap-integration.md`) with cross-links + note the shared autodiscover module now covers SMTP.
- Update `PRD-NexusHub.md` Communications section: V1 mail send + reply / forward / new via Graph + IMAP.
- Update `progress.md`.
- Update `CLAUDE.md` §11 journal.
