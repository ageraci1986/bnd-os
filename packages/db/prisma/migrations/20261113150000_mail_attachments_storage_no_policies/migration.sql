-- Bucket Storage `mail-attachments` : plus aucune policy anon/authenticated,
-- aligné sur `card-attachments` (CLAUDE.md §4.5.4, §4.4.6).
--
-- Toutes les opérations passent par la clé service role côté serveur
-- (apps/web/lib/mail-attachment-storage.ts), après vérification applicative
-- workspace + propriétaire de la boîte (fetch-attachment.ts). Les deux
-- policies créées le 2026-07-16 étaient :
--   - `mail_attachments_select_own_workspace` : lecture scopée sur un claim
--     JWT `workspace_id` qui n'existe pas → inerte aujourd'hui, mais aurait
--     ouvert les PJ de TOUTE l'équipe si ce claim était ajouté un jour
--     (contraire à §4.4.6, mails = propriété personnelle) ;
--   - `mail_attachments_write_service_role_only` : redondante, le service
--     role contourne le RLS.
-- Bucket privé + RLS sans policy → refus total via l'API pour les sessions
-- utilisateur ; seules les URL signées (300 s) émises par le serveur servent
-- un fichier.

DROP POLICY IF EXISTS "mail_attachments_select_own_workspace" ON storage.objects;
DROP POLICY IF EXISTS "mail_attachments_write_service_role_only" ON storage.objects;
