-- Track who created each card so we can notify the creator on new
-- comments (in addition to the card's assignees). Nullable: existing
-- rows predate this column and have no recorded creator.
ALTER TABLE "public"."cards" ADD COLUMN "created_by_id" UUID;

-- ON DELETE SET NULL: deleting a user must not cascade-delete their cards.
ALTER TABLE "public"."cards"
  ADD CONSTRAINT "cards_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "cards_created_by_id_idx" ON "public"."cards"("created_by_id");
