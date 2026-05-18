-- Kanban templates can now declare a default card template. The reference
-- is snapshotted onto projects at project-creation time so editing the
-- Kanban template later does not retroactively change existing projects
-- (PRD §7.2 / CLAUDE.md §6.4 — templates are frozen at project create).
--
-- ON DELETE SET NULL on both sides: if the referenced card template is
-- soft-deleted-then-hard-deleted, the Kanban template / project simply
-- loses the override and falls back to the workspace default at card
-- creation. We never want the deletion of a card template to cascade
-- away an entire Kanban template or project.

ALTER TABLE "public"."kanban_templates"
  ADD COLUMN "default_card_template_id" UUID NULL;

ALTER TABLE "public"."kanban_templates"
  ADD CONSTRAINT "kanban_templates_default_card_template_id_fkey"
  FOREIGN KEY ("default_card_template_id")
  REFERENCES "public"."card_templates"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

CREATE INDEX "kanban_templates_default_card_template_id_idx"
  ON "public"."kanban_templates"("default_card_template_id");

ALTER TABLE "public"."projects"
  ADD COLUMN "default_card_template_id" UUID NULL;

ALTER TABLE "public"."projects"
  ADD CONSTRAINT "projects_default_card_template_id_fkey"
  FOREIGN KEY ("default_card_template_id")
  REFERENCES "public"."card_templates"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

CREATE INDEX "projects_default_card_template_id_idx"
  ON "public"."projects"("default_card_template_id");
