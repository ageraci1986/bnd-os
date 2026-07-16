-- CreateEnum
CREATE TYPE "MailDraftKind" AS ENUM ('reply', 'reply_all', 'forward', 'new_mail');

-- CreateEnum
CREATE TYPE "EmailSendStatus" AS ENUM ('queued', 'sending', 'sent', 'failed');

-- AlterTable Integration: per-mailbox signature (nullable, sanitized on save)
ALTER TABLE "integrations"
  ADD COLUMN "signature_html" TEXT;

-- AlterTable EmailMessage: outbox pattern columns (all nullable, only set on sends)
ALTER TABLE "email_messages"
  ADD COLUMN "send_status"     "EmailSendStatus",
  ADD COLUMN "send_error"      TEXT,
  ADD COLUMN "sent_by_user_id" UUID;

-- FK for sentByUser (SET NULL on user delete — outbox trace should survive user removal)
ALTER TABLE "email_messages"
  ADD CONSTRAINT "email_messages_sent_by_user_id_fkey"
    FOREIGN KEY ("sent_by_user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable MailDraft (one active draft per user per workspace)
CREATE TABLE "mail_drafts" (
  "id"                   UUID        NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id"         UUID        NOT NULL,
  "user_id"              UUID        NOT NULL,
  "from_integration_id"  UUID        NOT NULL,
  "kind"                 "MailDraftKind" NOT NULL,
  "reply_to_id"          UUID,
  "to_recipients"        TEXT[]      NOT NULL DEFAULT ARRAY[]::TEXT[],
  "cc_recipients"        TEXT[]      NOT NULL DEFAULT ARRAY[]::TEXT[],
  "bcc_recipients"       TEXT[]      NOT NULL DEFAULT ARRAY[]::TEXT[],
  "subject"              TEXT        NOT NULL DEFAULT '',
  "body_html"            TEXT        NOT NULL DEFAULT '',
  "created_at"           TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"           TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "mail_drafts_pkey" PRIMARY KEY ("id")
);

-- One-slot-per-user
CREATE UNIQUE INDEX "mail_drafts_workspace_id_user_id_key"
  ON "mail_drafts" ("workspace_id", "user_id");

-- Speeds up the "load my draft" query (identical to the unique above but Prisma
-- generates it separately when @@index is declared alongside @@unique).
CREATE INDEX "mail_drafts_workspace_id_user_id_idx"
  ON "mail_drafts" ("workspace_id", "user_id");

-- FKs (cascade on workspace + integration + user; nullify on original mail delete)
ALTER TABLE "mail_drafts"
  ADD CONSTRAINT "mail_drafts_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "mail_drafts_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "mail_drafts_from_integration_id_fkey"
    FOREIGN KEY ("from_integration_id") REFERENCES "integrations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "mail_drafts_reply_to_id_fkey"
    FOREIGN KEY ("reply_to_id") REFERENCES "email_messages"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
