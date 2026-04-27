-- ============================================================
-- Generic updated_at trigger (search_path tightened in 004)
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'updated_at'
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_%I_updated_at ON public.%I; '
      'CREATE TRIGGER trg_%I_updated_at BEFORE UPDATE ON public.%I '
      'FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();',
      tbl, tbl, tbl, tbl
    );
  END LOOP;
END
$$;

-- ============================================================
-- Mirror auth.users → public.users on signup (pinned in 004)
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  INSERT INTO public.users (id, email, created_at, updated_at)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.created_at, now()), now())
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

CREATE OR REPLACE FUNCTION public.handle_auth_user_email_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    UPDATE public.users SET email = NEW.email, updated_at = now() WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_email_update ON auth.users;
CREATE TRIGGER on_auth_user_email_update
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_auth_user_email_update();

-- ============================================================
-- Last-Admin protection (ADR 0001 #7)
-- ============================================================
CREATE OR REPLACE FUNCTION public.protect_last_admin()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  remaining_admins int;
  target_ws uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_ws := OLD.workspace_id;
  ELSE
    target_ws := NEW.workspace_id;
    IF NEW.role = 'admin' THEN RETURN NEW; END IF;
    IF OLD.role <> 'admin' THEN RETURN NEW; END IF;
  END IF;

  SELECT COUNT(*) INTO remaining_admins
  FROM public.memberships
  WHERE workspace_id = target_ws
    AND role = 'admin'
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

DROP TRIGGER IF EXISTS trg_protect_last_admin_update ON public.memberships;
CREATE TRIGGER trg_protect_last_admin_update
  BEFORE UPDATE OF role ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION public.protect_last_admin();

DROP TRIGGER IF EXISTS trg_protect_last_admin_delete ON public.memberships;
CREATE TRIGGER trg_protect_last_admin_delete
  BEFORE DELETE ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION public.protect_last_admin();

-- ============================================================
-- Exactly one Blocked system column per project (PRD §8.3)
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS uniq_one_blocked_column_per_project
  ON public.columns (project_id)
  WHERE is_blocked_system = true;

CREATE OR REPLACE FUNCTION public.guard_blocked_column()
RETURNS trigger
LANGUAGE plpgsql AS $$
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

DROP TRIGGER IF EXISTS trg_guard_blocked_column ON public.columns;
CREATE TRIGGER trg_guard_blocked_column
  BEFORE UPDATE OR DELETE ON public.columns
  FOR EACH ROW EXECUTE FUNCTION public.guard_blocked_column();

-- ============================================================
-- Card.short_ref auto-increment per project
-- ============================================================
CREATE OR REPLACE FUNCTION public.assign_card_short_ref()
RETURNS trigger
LANGUAGE plpgsql AS $$
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

DROP TRIGGER IF EXISTS trg_assign_card_short_ref ON public.cards;
CREATE TRIGGER trg_assign_card_short_ref
  BEFORE INSERT ON public.cards
  FOR EACH ROW EXECUTE FUNCTION public.assign_card_short_ref();
