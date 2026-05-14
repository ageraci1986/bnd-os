-- Per-column step checklist + ChecklistItem source tagging.

-- Project-level Column gets the same TEXT[] as the template's.
ALTER TABLE "public"."columns"
  ADD COLUMN "step_checklist" TEXT[] NOT NULL DEFAULT '{}';

-- ChecklistItem optional FK back to the Column that seeded it. NULL
-- means "owned by the card" (regular template-driven checklist).
ALTER TABLE "public"."checklist_items"
  ADD COLUMN "column_source_id" UUID;

ALTER TABLE "public"."checklist_items"
  ADD CONSTRAINT "checklist_items_column_source_id_fkey"
  FOREIGN KEY ("column_source_id")
  REFERENCES "public"."columns"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "checklist_items_card_id_column_source_id_idx"
  ON "public"."checklist_items"("card_id", "column_source_id");
