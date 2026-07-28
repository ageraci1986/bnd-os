-- Guarantee every workspace has a default card template containing the
-- description item, and attach template-less cards to it.
-- Spec: docs/superpowers/specs/2026-07-28-card-template-visibility-design.md

-- 1. A workspace already owning an active template named 'Standard' but no
--    default: promote it (partial unique index
--    card_templates_one_default_per_workspace guarantees at most one default;
--    the NOT EXISTS guard keeps us clear of it).
UPDATE "card_templates" ct
SET "is_default" = TRUE
WHERE ct."deleted_at" IS NULL
  AND ct."name" = 'Standard'
  AND NOT EXISTS (
    SELECT 1 FROM "card_templates" d
    WHERE d."workspace_id" = ct."workspace_id"
      AND d."is_default" AND d."deleted_at" IS NULL
  );

-- 2. Workspaces still lacking a default: insert the bootstrapped 'Standard'
--    template (same shape as @nexushub/domain defaultCardTemplateItems()).
--    The unique index (workspace_id, name) also covers soft-deleted rows, so
--    skip workspaces holding ANY row named 'Standard' — those (rare) cases
--    keep no default and are fixable via /templates/cards.
INSERT INTO "card_templates" ("workspace_id", "name", "is_default", "items", "created_at", "updated_at")
SELECT w."id", 'Standard', TRUE,
       '[{"id":"description","type":"description"},{"id":"checklist","type":"checklist","items":[]}]'::jsonb,
       NOW(), NOW()
FROM "workspaces" w
WHERE NOT EXISTS (
    SELECT 1 FROM "card_templates" d
    WHERE d."workspace_id" = w."id" AND d."is_default" AND d."deleted_at" IS NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM "card_templates" s
    WHERE s."workspace_id" = w."id" AND s."name" = 'Standard'
  );

-- 3. Backfill: attach active template-less cards to their workspace default
--    so already-created cards render the description section. Deliberate
--    trade-off (validated 2026-07-28): cards manually set to « Sans template »
--    are re-templated too.
UPDATE "cards" c
SET "template_id" = d."id"
FROM "card_templates" d
WHERE d."workspace_id" = c."workspace_id"
  AND d."is_default" AND d."deleted_at" IS NULL
  AND c."template_id" IS NULL
  AND c."deleted_at" IS NULL;
