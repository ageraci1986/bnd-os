-- RACI des cartes : plusieurs personnes peuvent partager un même rôle
-- (demande client 2026-11-13, CLAUDE.md §6.6). On retire les deux index
-- uniques partiels « un seul R / un seul A par carte » de
-- 20260501100001_card_assignee_raci. La PK (card_id, user_id) reste : une
-- personne n'a toujours qu'un rôle par carte. L'index non unique
-- card_assignees_card_id_raci_idx est conservé pour les lookups.

DROP INDEX IF EXISTS "public"."card_assignees_one_responsible_per_card";
DROP INDEX IF EXISTS "public"."card_assignees_one_accountable_per_card";
