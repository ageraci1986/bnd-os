-- E.3 v2: replace markdown-only templates with structured field
-- definitions rendered as inputs in the card modal.

-- Templates: add the `fields` array (kept body for optional intro markdown).
ALTER TABLE "public"."card_templates"
  ADD COLUMN "fields" JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Cards: link to the template the card was created from + per-card values
-- for every template field, keyed by field id.
ALTER TABLE "public"."cards"
  ADD COLUMN "template_id" UUID,
  ADD COLUMN "field_values" JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE "public"."cards"
  ADD CONSTRAINT "cards_template_id_fkey"
  FOREIGN KEY ("template_id")
  REFERENCES "public"."card_templates"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "cards_template_id_idx" ON "public"."cards" ("template_id");
