-- =====================================================================
-- NexusHub — extensions et helpers Postgres (idempotent)
-- À exécuter UNE FOIS sur chaque environnement après prisma migrate.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "citext";    -- email/slug case-insensitive

-- ---------------------------------------------------------------------
-- Helper: workspace_ids_for_current_user()
-- Returns the set of workspace_ids the current Supabase auth user belongs to.
-- Used by every RLS policy to constrain queries.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.workspace_ids_for_current_user()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT m.workspace_id
  FROM public.memberships m
  WHERE m.user_id = auth.uid();
$$;

-- ---------------------------------------------------------------------
-- Helper: is_workspace_admin(workspace_id)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_workspace_admin(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.memberships m
    WHERE m.workspace_id = p_workspace_id
      AND m.user_id = auth.uid()
      AND m.role = 'admin'
  );
$$;
