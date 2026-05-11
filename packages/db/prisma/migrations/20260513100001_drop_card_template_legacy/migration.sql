ALTER TABLE "public"."card_templates"
  DROP CONSTRAINT IF EXISTS "card_templates_description_position_check";

ALTER TABLE "public"."card_templates"
  DROP COLUMN "fields",
  DROP COLUMN "description_position";
