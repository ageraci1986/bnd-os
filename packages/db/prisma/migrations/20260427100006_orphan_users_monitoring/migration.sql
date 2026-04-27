-- ============================================================
-- Defense-in-depth: orphan auth users monitoring.
--
-- A user that exists in auth.users without a matching
-- public.memberships row cannot see or do anything in NexusHub
-- (every RLS policy joins on memberships). They are effectively
-- inert. This view lets ops detect and audit such accounts.
--
-- Useful when:
-- - Public signup was accidentally enabled in the dashboard
-- - An invitation was consumed but membership creation failed
-- - A user was removed from a workspace (their auth.users row stays)
--
-- The view is exposed only to service_role; nobody else reads auth.users.
-- ============================================================
CREATE OR REPLACE VIEW public.v_orphan_auth_users
WITH (security_invoker = true)
AS
SELECT
  u.id          AS user_id,
  u.email       AS email,
  u.created_at  AS auth_created_at,
  pu.created_at AS profile_created_at
FROM auth.users u
LEFT JOIN public.users pu ON pu.id = u.id
LEFT JOIN public.memberships m ON m.user_id = u.id
WHERE m.id IS NULL;

-- service_role only
REVOKE ALL ON public.v_orphan_auth_users FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_orphan_auth_users TO service_role;

COMMENT ON VIEW public.v_orphan_auth_users IS
  'Users present in auth.users without any membership. They cannot access '
  'workspace data via RLS but their auth account exists. Ops should review '
  'periodically (Phase 5 Inngest cron). Defense-in-depth against accidental '
  'public signup.';
