-- Ferme tout accès API (PostgREST / supabase-js) à public.integrations.
--
-- Cette table porte les tokens externes chiffrés (CLAUDE.md §4.2) et les
-- métadonnées des boîtes personnelles (libellé, signature, dernière erreur).
-- Le `REVOKE SELECT (encrypted_tokens)` de 20260427100002 était sans effet :
-- le GRANT au niveau TABLE accordé par défaut à anon/authenticated prévaut sur
-- une révocation de colonne. La policy `integrations_member_read` exposait en
-- plus les boîtes des collègues à tout membre du workspace.
--
-- L'application n'accède à `integrations` QUE via Prisma (rôle qui contourne
-- le RLS) ; aucun client navigateur ne lit cette table et elle n'est pas dans
-- la publication Realtime. Les policies RLS d'autres tables qui en dépendent
-- passent par des fonctions SECURITY DEFINER
-- (`integration_ids_owned_by_current_user`) : non impactées.
--
-- Résultat : RLS actif, aucune policy, aucun privilège pour anon/authenticated
-- → refus total côté API, double verrou si un GRANT revenait.

REVOKE ALL ON TABLE public.integrations FROM anon, authenticated;

DROP POLICY IF EXISTS integrations_member_read ON public.integrations;
DROP POLICY IF EXISTS integrations_admin_or_self ON public.integrations;
