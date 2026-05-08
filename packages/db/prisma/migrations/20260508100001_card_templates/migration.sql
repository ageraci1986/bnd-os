-- E.3: workspace-level card templates (markdown body + default checklist).

CREATE TABLE "public"."card_templates" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "body" TEXT NOT NULL DEFAULT '',
  "default_checklist" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "is_default" BOOLEAN NOT NULL DEFAULT FALSE,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  "deleted_at" TIMESTAMPTZ(6),

  CONSTRAINT "card_templates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "card_templates_workspace_id_fkey"
    FOREIGN KEY ("workspace_id")
    REFERENCES "public"."workspaces"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "card_templates_workspace_id_name_key"
  ON "public"."card_templates" ("workspace_id", "name");

CREATE INDEX "card_templates_workspace_id_deleted_at_idx"
  ON "public"."card_templates" ("workspace_id", "deleted_at");

-- At most one default template per workspace, enforced via partial unique.
CREATE UNIQUE INDEX "card_templates_one_default_per_workspace"
  ON "public"."card_templates" ("workspace_id")
  WHERE "is_default" = TRUE AND "deleted_at" IS NULL;

-- RLS — same pattern as email_templates / kanban_templates.
ALTER TABLE "public"."card_templates" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "card_templates_select"
  ON "public"."card_templates"
  FOR SELECT
  TO authenticated
  USING ("workspace_id" IN (SELECT public.workspace_ids_for_current_user()));

CREATE POLICY "card_templates_insert"
  ON "public"."card_templates"
  FOR INSERT
  TO authenticated
  WITH CHECK ("workspace_id" IN (SELECT public.workspace_ids_for_current_user()));

CREATE POLICY "card_templates_update"
  ON "public"."card_templates"
  FOR UPDATE
  TO authenticated
  USING ("workspace_id" IN (SELECT public.workspace_ids_for_current_user()));

CREATE POLICY "card_templates_delete"
  ON "public"."card_templates"
  FOR DELETE
  TO authenticated
  USING ("workspace_id" IN (SELECT public.workspace_ids_for_current_user()));
