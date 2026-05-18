-- Cards in the last user column can be marked as completed (todo-list
-- semantic): the checkbox in list view persists this snapshot. Card
-- stays in the column, just gets a strikethrough title in the UI.
-- Distinct from `archivedAt` (which removes the card from active views
-- after 30 days in the last column) — completedAt is an *optional* user
-- gesture before that auto-archive.

ALTER TABLE "public"."cards"
  ADD COLUMN "completed_at" TIMESTAMPTZ NULL;

CREATE INDEX "cards_completed_at_idx"
  ON "public"."cards" ("completed_at")
  WHERE "completed_at" IS NOT NULL;
