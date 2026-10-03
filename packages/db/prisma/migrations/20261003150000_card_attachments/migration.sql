-- Lot C : pièces jointes de cartes.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'card_attachment_rejected';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'card_attachment_deleted';

CREATE TABLE "card_attachments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "card_id" UUID NOT NULL,
  "uploaded_by_id" UUID,
  "filename" VARCHAR(255) NOT NULL,
  "content_type" VARCHAR(255) NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "storage_path" VARCHAR(512) NOT NULL,
  "scan_status" "AttachmentScanStatus" NOT NULL DEFAULT 'pending',
  "sha256" CHAR(64),
  "scan_report" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "card_attachments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "card_attachments_card_id_fkey" FOREIGN KEY ("card_id")
    REFERENCES "cards"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "card_attachments_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id")
    REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "card_attachments_size_check" CHECK ("size_bytes" > 0 AND "size_bytes" <= 52428800)
);

CREATE UNIQUE INDEX "card_attachments_storage_path_key" ON "card_attachments"("storage_path");
CREATE INDEX "card_attachments_workspace_id_card_id_idx" ON "card_attachments"("workspace_id", "card_id");
CREATE INDEX "card_attachments_scan_status_created_at_idx" ON "card_attachments"("scan_status", "created_at");

ALTER TABLE public.card_attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY card_attachments_member_all ON public.card_attachments FOR ALL
  USING (workspace_id IN (SELECT public.workspace_ids_for_current_user()))
  WITH CHECK (workspace_id IN (SELECT public.workspace_ids_for_current_user()));
