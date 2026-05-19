-- Add `email` to the NotificationChannel enum so card-comment notifications
-- can be persisted with channel = 'email'.
ALTER TYPE "public"."NotificationChannel" ADD VALUE IF NOT EXISTS 'email';

-- Defensive RLS posture: every comment write must go through the
-- server-action layer (which checks scope, author, admin). The previous
-- author-only INSERT/UPDATE/DELETE policies are dropped so a leaked user
-- JWT can never write directly via supabase-js. SELECT policy stays —
-- members of the workspace can still read.
DROP POLICY IF EXISTS comments_insert_member ON public.comments;
DROP POLICY IF EXISTS comments_update_own ON public.comments;
DROP POLICY IF EXISTS comments_delete_own ON public.comments;

-- Belt-and-braces explicit deny — anyone (other than service-role bypass)
-- attempting INSERT/UPDATE/DELETE on comments via PostgREST is refused.
DROP POLICY IF EXISTS comments_no_direct_writes ON public.comments;
CREATE POLICY comments_no_direct_writes ON public.comments
  AS RESTRICTIVE
  FOR ALL
  USING (false)
  WITH CHECK (false);
