-- Add the unified items column. Populated by data script after deploy.
ALTER TABLE "public"."card_templates"
  ADD COLUMN "items" JSONB NOT NULL DEFAULT '[]';
