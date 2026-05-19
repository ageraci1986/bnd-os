-- A card is "done" iff it sits in the last user-facing column of its
-- project. The state of `completed_at` is therefore fully derived
-- from column position and shouldn't be writable by humans (which
-- would risk drift). We move from a manual toggle to a DB trigger
-- that auto-stamps `completed_at` when the card lands in the last
-- user column and clears it when it moves away.
--
-- "Last user column" = the non-blocked column with the highest
-- `position` for the card's project.

CREATE OR REPLACE FUNCTION public.sync_card_completed_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  last_user_col_id uuid;
BEGIN
  -- For UPDATEs, only act if column_id actually changed (the trigger
  -- registration limits us to UPDATE OF column_id, but Postgres still
  -- fires when the same value is re-assigned — guard explicitly).
  IF TG_OP = 'UPDATE' AND NEW.column_id IS NOT DISTINCT FROM OLD.column_id THEN
    RETURN NEW;
  END IF;

  SELECT id
  INTO last_user_col_id
  FROM public.columns
  WHERE project_id = NEW.project_id AND is_blocked_system = false
  ORDER BY position DESC
  LIMIT 1;

  IF NEW.column_id = last_user_col_id THEN
    NEW.completed_at := NOW();
  ELSE
    NEW.completed_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

-- Fire BEFORE so the new value is written in the same row update —
-- one I/O, no second UPDATE needed.
DROP TRIGGER IF EXISTS sync_card_completed_at_trg ON public.cards;
CREATE TRIGGER sync_card_completed_at_trg
BEFORE INSERT OR UPDATE OF column_id ON public.cards
FOR EACH ROW
EXECUTE FUNCTION public.sync_card_completed_at();

-- Backfill existing rows so the derived field matches the rule:
--   • card in last user column   → completed_at = now() (or kept if set)
--   • card anywhere else         → completed_at = null
-- Using a single UPDATE per project via DISTINCT ON keeps it tight.
WITH last_user_cols AS (
  SELECT DISTINCT ON (project_id) project_id, id AS last_col_id
  FROM public.columns
  WHERE is_blocked_system = false
  ORDER BY project_id, position DESC
)
UPDATE public.cards c
SET completed_at = CASE
  WHEN c.column_id = l.last_col_id THEN COALESCE(c.completed_at, NOW())
  ELSE NULL
END
FROM last_user_cols l
WHERE c.project_id = l.project_id
  AND (
    (c.column_id = l.last_col_id AND c.completed_at IS NULL)
    OR (c.column_id <> l.last_col_id AND c.completed_at IS NOT NULL)
  );
