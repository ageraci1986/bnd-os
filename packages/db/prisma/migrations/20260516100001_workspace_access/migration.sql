-- Phase B.1 — WorkspaceAccess: optional rows that RESTRICT a Membership
-- to specific clients or projects within their workspace. Absence of rows
-- = full workspace access (the default for User; Admin is never scoped).
-- Phase B.2 will use the same table for Viewer-shared projects.

-- Audit kinds first (separate statement so the enum is committed before
-- the table's @check uses it indirectly via Prisma client codegen).
ALTER TYPE "public"."AuditAction" ADD VALUE IF NOT EXISTS 'workspace_access_granted';
ALTER TYPE "public"."AuditAction" ADD VALUE IF NOT EXISTS 'workspace_access_revoked';

CREATE TABLE "public"."workspace_access" (
  "id"             UUID        NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id"   UUID        NOT NULL,
  "membership_id"  UUID        NOT NULL,
  "client_id"      UUID,
  "project_id"     UUID,
  "created_by_id"  UUID        NOT NULL,
  "created_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "workspace_access_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workspace_access_workspace_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE,
  CONSTRAINT "workspace_access_membership_fkey"
    FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE CASCADE,
  CONSTRAINT "workspace_access_client_fkey"
    FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE,
  CONSTRAINT "workspace_access_project_fkey"
    FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE,
  CONSTRAINT "workspace_access_created_by_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT,
  -- Exactly one of client_id / project_id is non-null.
  CONSTRAINT "workspace_access_exactly_one_scope_chk" CHECK (
    (client_id IS NOT NULL AND project_id IS NULL) OR
    (client_id IS NULL AND project_id IS NOT NULL)
  )
);

-- Membership × client uniqueness, NULLs are distinct so each membership
-- can have many project-only rows alongside client-only rows.
CREATE UNIQUE INDEX "workspace_access_membership_client_uniq"
  ON "public"."workspace_access" ("membership_id", "client_id")
  WHERE "client_id" IS NOT NULL;

CREATE UNIQUE INDEX "workspace_access_membership_project_uniq"
  ON "public"."workspace_access" ("membership_id", "project_id")
  WHERE "project_id" IS NOT NULL;

CREATE INDEX "workspace_access_workspace_idx" ON "public"."workspace_access" ("workspace_id");
CREATE INDEX "workspace_access_membership_idx" ON "public"."workspace_access" ("membership_id");

-- Same-workspace integrity: the referenced client / project must live in
-- the same workspace as the Membership. We enforce via trigger because
-- Postgres CHECK can't span tables.
CREATE OR REPLACE FUNCTION public.workspace_access_same_workspace()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  m_ws uuid;
  res_ws uuid;
BEGIN
  SELECT workspace_id INTO m_ws FROM public.memberships WHERE id = NEW.membership_id;
  IF m_ws IS NULL OR m_ws <> NEW.workspace_id THEN
    RAISE EXCEPTION 'WORKSPACE_ACCESS_INVALID: membership belongs to a different workspace'
      USING ERRCODE = 'P0001';
  END IF;
  IF NEW.client_id IS NOT NULL THEN
    SELECT workspace_id INTO res_ws FROM public.clients WHERE id = NEW.client_id;
    IF res_ws IS NULL OR res_ws <> NEW.workspace_id THEN
      RAISE EXCEPTION 'WORKSPACE_ACCESS_INVALID: client belongs to a different workspace'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF NEW.project_id IS NOT NULL THEN
    SELECT workspace_id INTO res_ws FROM public.projects WHERE id = NEW.project_id;
    IF res_ws IS NULL OR res_ws <> NEW.workspace_id THEN
      RAISE EXCEPTION 'WORKSPACE_ACCESS_INVALID: project belongs to a different workspace'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_workspace_access_same_workspace ON public.workspace_access;
CREATE TRIGGER trg_workspace_access_same_workspace
  BEFORE INSERT OR UPDATE ON public.workspace_access
  FOR EACH ROW EXECUTE FUNCTION public.workspace_access_same_workspace();

-- Forbid Admin memberships from carrying scope rows (defence-in-depth;
-- the app guards this too).
CREATE OR REPLACE FUNCTION public.workspace_access_forbid_admin()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  m_role public."Role";
BEGIN
  SELECT role INTO m_role FROM public.memberships WHERE id = NEW.membership_id;
  IF m_role = 'admin'::public."Role" THEN
    RAISE EXCEPTION 'WORKSPACE_ACCESS_ADMIN_SCOPED: admin memberships cannot be scope-restricted'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_workspace_access_forbid_admin ON public.workspace_access;
CREATE TRIGGER trg_workspace_access_forbid_admin
  BEFORE INSERT OR UPDATE ON public.workspace_access
  FOR EACH ROW EXECUTE FUNCTION public.workspace_access_forbid_admin();

-- RLS: workspace-scoped reads + admin-only writes (matches integrations/audit).
ALTER TABLE "public"."workspace_access" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace_access_select" ON "public"."workspace_access"
  FOR SELECT USING (workspace_id IN (SELECT public.workspace_ids_for_current_user()));

CREATE POLICY "workspace_access_admin_insert" ON "public"."workspace_access"
  FOR INSERT WITH CHECK (public.is_workspace_admin(workspace_id));

CREATE POLICY "workspace_access_admin_update" ON "public"."workspace_access"
  FOR UPDATE USING (public.is_workspace_admin(workspace_id))
           WITH CHECK (public.is_workspace_admin(workspace_id));

CREATE POLICY "workspace_access_admin_delete" ON "public"."workspace_access"
  FOR DELETE USING (public.is_workspace_admin(workspace_id));
