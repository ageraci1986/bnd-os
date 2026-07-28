-- Plan 3a: assistant long-term memory (per user, strictly personal).
-- One durable fact per row, edited by the agent (tools) and by the user
-- (Mémoire tab). Unlike other workspace tables, rows are visible/editable
-- ONLY by their owner — RLS below requires workspace membership AND
-- user_id = auth.uid() on every operation.

CREATE TABLE "public"."assistant_memory" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "fact" VARCHAR(500) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "assistant_memory_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "assistant_memory_workspace_id_fkey"
    FOREIGN KEY ("workspace_id")
    REFERENCES "public"."workspaces"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "assistant_memory_user_id_fkey"
    FOREIGN KEY ("user_id")
    REFERENCES "public"."users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "assistant_memory_workspace_id_user_id_name_key"
  ON "public"."assistant_memory" ("workspace_id", "user_id", "name");

-- Pas d'index (workspace_id, user_id) séparé : le préfixe de l'unique le couvre.

-- RLS — personal, not workspace-shared: every policy requires BOTH workspace
-- membership (public.workspace_ids_for_current_user(), cf. migration
-- 20260427100002_rls_helpers_and_policies) AND ownership (user_id = auth.uid()).
-- Other workspace members must NOT see or edit another member's memories.
ALTER TABLE "public"."assistant_memory" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "assistant_memory_select"
  ON "public"."assistant_memory"
  FOR SELECT
  TO authenticated
  USING (
    "user_id" = auth.uid()
    AND "workspace_id" IN (SELECT public.workspace_ids_for_current_user())
  );

CREATE POLICY "assistant_memory_insert"
  ON "public"."assistant_memory"
  FOR INSERT
  TO authenticated
  WITH CHECK (
    "user_id" = auth.uid()
    AND "workspace_id" IN (SELECT public.workspace_ids_for_current_user())
  );

CREATE POLICY "assistant_memory_update"
  ON "public"."assistant_memory"
  FOR UPDATE
  TO authenticated
  USING (
    "user_id" = auth.uid()
    AND "workspace_id" IN (SELECT public.workspace_ids_for_current_user())
  )
  WITH CHECK (
    "user_id" = auth.uid()
    AND "workspace_id" IN (SELECT public.workspace_ids_for_current_user())
  );

CREATE POLICY "assistant_memory_delete"
  ON "public"."assistant_memory"
  FOR DELETE
  TO authenticated
  USING (
    "user_id" = auth.uid()
    AND "workspace_id" IN (SELECT public.workspace_ids_for_current_user())
  );
