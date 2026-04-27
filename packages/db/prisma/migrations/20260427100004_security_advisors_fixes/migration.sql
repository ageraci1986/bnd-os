-- ============================================================
-- Supabase advisor remediation (lint rules 0011, 0014, 0028, 0029)
-- ============================================================

-- 0014: extension_in_public — move citext out of public
ALTER EXTENSION citext SET SCHEMA extensions;

-- 0011: function_search_path_mutable — pin search_path = '' on every
-- function we own (forces fully-qualified references in body and
-- prevents search-path hijacking via temp objects).

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_last_admin()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  remaining_admins int;
  target_ws uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_ws := OLD.workspace_id;
  ELSE
    target_ws := NEW.workspace_id;
    IF NEW.role = 'admin'::public."Role" THEN RETURN NEW; END IF;
    IF OLD.role <> 'admin'::public."Role" THEN RETURN NEW; END IF;
  END IF;

  SELECT COUNT(*) INTO remaining_admins
  FROM public.memberships
  WHERE workspace_id = target_ws
    AND role = 'admin'::public."Role"
    AND id <> OLD.id;

  IF remaining_admins = 0 THEN
    RAISE EXCEPTION 'LAST_ADMIN_PROTECTED: cannot remove or downgrade the last admin'
      USING ERRCODE = 'P0001';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_blocked_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.is_blocked_system THEN
    RAISE EXCEPTION 'BLOCKED_COLUMN_PROTECTED: cannot delete system Blocked column'
      USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.is_blocked_system AND NEW.is_blocked_system = false THEN
    RAISE EXCEPTION 'BLOCKED_COLUMN_PROTECTED: cannot unflag the system Blocked column'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_card_short_ref()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  next_ref int;
BEGIN
  IF NEW.short_ref IS NOT NULL AND NEW.short_ref > 0 THEN
    RETURN NEW;
  END IF;
  SELECT COALESCE(MAX(short_ref), 0) + 1 INTO next_ref
  FROM public.cards
  WHERE project_id = NEW.project_id;
  NEW.short_ref := next_ref;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.users (id, email, created_at, updated_at)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.created_at, now()), now())
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_auth_user_email_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    UPDATE public.users SET email = NEW.email, updated_at = now() WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.workspace_ids_for_current_user()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT m.workspace_id
  FROM public.memberships m
  WHERE m.user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_workspace_admin(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.memberships m
    WHERE m.workspace_id = p_workspace_id
      AND m.user_id = auth.uid()
      AND m.role = 'admin'::public."Role"
  );
$$;

-- 0028/0029: handle_new_auth_user / handle_auth_user_email_update are
-- trigger payloads only. Revoke EXECUTE entirely so they cannot be
-- called as PostgREST RPCs.
REVOKE EXECUTE ON FUNCTION public.handle_new_auth_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_auth_user_email_update() FROM PUBLIC, anon, authenticated;

-- Helpers must remain executable by `authenticated` because RLS policies
-- invoke them. Re-apply explicit grants after the CREATE OR REPLACE.
REVOKE ALL ON FUNCTION public.workspace_ids_for_current_user() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_workspace_admin(uuid)         FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workspace_ids_for_current_user() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_workspace_admin(uuid)         TO authenticated;
