-- Phase A — last-super-admin protection.
-- Forbid the transition that would leave the platform with zero super-admins.
-- Mirrors public.protect_last_admin (introduced in 20260427100007).
CREATE OR REPLACE FUNCTION public.protect_last_super_admin()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  remaining int;
BEGIN
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.is_super_admin = TRUE THEN RETURN NEW; END IF;
    IF OLD.is_super_admin = FALSE THEN RETURN NEW; END IF;
  END IF;

  SELECT COUNT(*) INTO remaining
    FROM public.users
   WHERE is_super_admin = TRUE
     AND id <> OLD.id;

  IF remaining = 0 THEN
    RAISE EXCEPTION 'LAST_SUPER_ADMIN_PROTECTED: cannot remove or demote the last super-admin'
      USING ERRCODE = 'P0001';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_last_super_admin_update ON public.users;
CREATE TRIGGER trg_protect_last_super_admin_update
  BEFORE UPDATE OF is_super_admin ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.protect_last_super_admin();

DROP TRIGGER IF EXISTS trg_protect_last_super_admin_delete ON public.users;
CREATE TRIGGER trg_protect_last_super_admin_delete
  BEFORE DELETE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.protect_last_super_admin();
