-- ============================================================
-- email_messages : RLS owner-only (correctif sécurité 2026-11-10)
-- ============================================================
-- La policy initiale `em_member_all` (20260427100002) ouvrait les mails à
-- TOUT membre du workspace. `authenticated` ayant SELECT sur la table et la
-- clé anon étant publique, n'importe quel membre pouvait lire via PostgREST
-- (son propre JWT) les mails — corps compris — des boîtes de ses collègues.
-- Les boîtes Graph/IMAP sont déléguées par utilisateur (PRD §9 hypothèse 8) :
-- un mail n'est visible que par le propriétaire de l'intégration.
--
-- L'app (Prisma, rôle qui bypass RLS) applique le même scope côté code via
-- `ownedMailWhere` (apps/web/features/communications/lib/owned-mail-where.ts).
-- `email_attachments` et `mail_drafts` ont déjà RLS activée SANS policy
-- (deny-all pour authenticated/anon) — inchangés.

-- Helper SECURITY DEFINER : évite que la policy dépende des policies RLS de
-- `integrations` (dont `integrations_member_read` est workspace-wide).
CREATE OR REPLACE FUNCTION public.integration_ids_owned_by_current_user()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT i.id
  FROM public.integrations i
  WHERE i.owner_user_id = auth.uid()
    AND i.workspace_id IN (
      SELECT m.workspace_id FROM public.memberships m WHERE m.user_id = auth.uid()
    );
$$;

REVOKE ALL ON FUNCTION public.integration_ids_owned_by_current_user() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.integration_ids_owned_by_current_user() TO authenticated;

DROP POLICY IF EXISTS em_member_all ON public.email_messages;
DROP POLICY IF EXISTS em_owner_all ON public.email_messages;

CREATE POLICY em_owner_all ON public.email_messages FOR ALL
  USING (
    workspace_id IN (SELECT public.workspace_ids_for_current_user())
    AND integration_id IN (SELECT public.integration_ids_owned_by_current_user())
  )
  WITH CHECK (
    workspace_id IN (SELECT public.workspace_ids_for_current_user())
    AND integration_id IN (SELECT public.integration_ids_owned_by_current_user())
  );
