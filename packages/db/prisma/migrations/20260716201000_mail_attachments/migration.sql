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
