-- Per-column step checklist for kanban templates (PRD §7.2 ext).
ALTER TABLE "public"."kanban_template_columns"
  ADD COLUMN "step_checklist" TEXT[] NOT NULL DEFAULT '{}';
