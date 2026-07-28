-- Plan 5b: audit du CRUD assistant (clients/contacts/templates/mail) +
-- archivage local des mails (archived_at — PAS de sync retour IMAP/Graph).
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'client_created';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'client_updated';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'contact_created';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'contact_updated';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'contact_deleted';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'template_created';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'template_updated';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'template_deleted';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'mail_archived';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'mail_deleted';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'mail_marked_read';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'mail_marked_unread';

-- AlterTable EmailMessage: local archive flag (nullable timestamp, no backfill needed)
ALTER TABLE "email_messages"
  ADD COLUMN "archived_at" TIMESTAMPTZ(6);

CREATE INDEX "email_messages_workspace_id_archived_at_idx"
  ON "email_messages" ("workspace_id", "archived_at");
