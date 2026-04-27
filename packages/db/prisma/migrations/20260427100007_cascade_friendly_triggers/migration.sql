-- ============================================================
-- Make guard triggers cascade-friendly.
--
-- The original triggers raised on every DELETE of a Blocked column /
-- last Admin — including when the parent (project / workspace) was
-- itself being cascade-deleted. That breaks legitimate workspace
-- removal (e.g. db:seed re-creating the demo workspace).
--
-- Fix: skip the guard when the parent row no longer exists. With
-- ON DELETE CASCADE, the parent disappears before its children, so by
-- the time the child trigger fires, the parent is already gone and we
-- can safely allow the cascade.
-- ============================================================

CREATE OR REPLACE FUNCTION public.guard_blocked_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.is_blocked_system THEN
    -- Allow cascade: if the parent project is gone, this is a cascade DELETE.
    IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id = OLD.project_id) THEN
      RETURN OLD;
    END IF;
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
    -- Allow cascade: if the parent workspace is gone, this is a cascade DELETE.
    IF NOT EXISTS (SELECT 1 FROM public.workspaces WHERE id = target_ws) THEN
      RETURN OLD;
    END IF;
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
