-- E.2: add RACI to card_assignees so internal users can be assigned to cards
-- with R/A/C/I roles, and enforce at-most-one Responsible / Accountable
-- (i.e. "approver") per card via partial unique indexes.

ALTER TABLE "public"."card_assignees"
  ADD COLUMN "raci" "public"."RACI" NOT NULL DEFAULT 'responsible';

-- New compound index used by `findMany({ where: { cardId, raci } })` lookups.
CREATE INDEX "card_assignees_card_id_raci_idx"
  ON "public"."card_assignees" ("card_id", "raci");

-- Exactly one Responsible per card.
CREATE UNIQUE INDEX "card_assignees_one_responsible_per_card"
  ON "public"."card_assignees" ("card_id")
  WHERE "raci" = 'responsible';

-- Exactly one Accountable (= "approver" in our enum) per card.
CREATE UNIQUE INDEX "card_assignees_one_accountable_per_card"
  ON "public"."card_assignees" ("card_id")
  WHERE "raci" = 'approver';
