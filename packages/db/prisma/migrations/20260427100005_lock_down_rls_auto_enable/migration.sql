-- ============================================================
-- Lock down rls_auto_enable (Supabase event_trigger function).
--
-- This function is fired by Postgres event triggers on CREATE TABLE
-- under the bootstrap superuser role. It is NEVER meant to be called
-- as a PostgREST RPC. By default Supabase grants it to PUBLIC, which
-- exposes it via /rest/v1/rpc/rls_auto_enable.
--
-- Revoking EXECUTE from PUBLIC + anon + authenticated does not break
-- the event trigger (event triggers run as their owner, not the caller).
-- ============================================================
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;

-- ============================================================
-- Document the two remaining intentional advisor warnings
-- (lint 0029 — authenticated_security_definer_function_executable).
-- These helpers are SECURITY DEFINER and callable by `authenticated`
-- because RLS policies invoke them. Removing EXECUTE from authenticated
-- would break every workspace policy. The Supabase advisor flags this
-- as a "potential" issue; in our case it is intentional and safe:
-- both functions return only data scoped to the calling user's
-- memberships.
-- ============================================================
COMMENT ON FUNCTION public.workspace_ids_for_current_user() IS
  'Intentional: SECURITY DEFINER + EXECUTE for authenticated. Used by RLS '
  'policies to bypass recursive RLS on memberships. Returns only the '
  'caller''s own workspace_ids. Linter warning 0029 acknowledged in CLAUDE.md.';

COMMENT ON FUNCTION public.is_workspace_admin(uuid) IS
  'Intentional: SECURITY DEFINER + EXECUTE for authenticated. Used by RLS '
  'policies to gate Admin-only mutations. Returns boolean only; no info leak. '
  'Linter warning 0029 acknowledged in CLAUDE.md.';
