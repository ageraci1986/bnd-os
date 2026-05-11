-- Per-template control over the description block's position in the card modal.

ALTER TABLE "public"."card_templates"
  ADD COLUMN "description_position" TEXT NOT NULL DEFAULT 'after-fields';

-- Tightening: only the three documented values are accepted.
ALTER TABLE "public"."card_templates"
  ADD CONSTRAINT "card_templates_description_position_check"
  CHECK ("description_position" IN ('before-fields', 'after-fields', 'hidden'));
