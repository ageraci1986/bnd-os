-- AlterEnum
ALTER TYPE "IntegrationKind" ADD VALUE IF NOT EXISTS 'imap';

-- AlterTable Integration: additive nullable columns (safe on live DB)
ALTER TABLE "integrations"
  ADD COLUMN "imap_uid_validity"   BIGINT,
  ADD COLUMN "imap_last_seen_uid"  BIGINT;

-- AlterTable EmailMessage: additive nullable FK column
ALTER TABLE "email_messages"
  ADD COLUMN "integration_id" UUID;

-- Backfill: assign every existing email to its workspace's Graph integration.
-- Precondition (checked by the runbook step): at most one Graph integration
-- per workspace exists at migration time. If a workspace has more than one,
-- the runbook says to stop and reconcile manually — the pre-check below hard-
-- fails with a self-explanatory NOTICE.
DO $$
DECLARE
  offenders INT;
BEGIN
  SELECT COUNT(*) INTO offenders
  FROM (
    SELECT workspace_id
    FROM integrations
    WHERE kind = 'graph'
    GROUP BY workspace_id
    HAVING COUNT(*) > 1
  ) s;
  IF offenders > 0 THEN
    RAISE EXCEPTION 'imap_integration_foundations: % workspace(s) have multiple Graph integrations. Backfill cannot pick a source — reconcile manually before re-running.', offenders;
  END IF;
END $$;

UPDATE "email_messages" em
SET "integration_id" = (
  SELECT i.id
  FROM "integrations" i
  WHERE i.workspace_id = em.workspace_id AND i.kind = 'graph'
  ORDER BY i.created_at ASC
  LIMIT 1
);

-- Verify no NULLs remain (fails loudly if a workspace has emails but no Graph).
DO $$
DECLARE
  orphans INT;
BEGIN
  SELECT COUNT(*) INTO orphans FROM "email_messages" WHERE "integration_id" IS NULL;
  IF orphans > 0 THEN
    RAISE EXCEPTION 'imap_integration_foundations: % email row(s) could not be backfilled (no matching Graph integration). Reconcile manually.', orphans;
  END IF;
END $$;

-- Now enforce NOT NULL + FK
ALTER TABLE "email_messages"
  ALTER COLUMN "integration_id" SET NOT NULL,
  ADD CONSTRAINT "email_messages_integration_id_fkey"
    FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Swap the composite unique index
DROP INDEX IF EXISTS "email_messages_workspace_id_external_id_key";
CREATE UNIQUE INDEX "email_messages_workspace_id_integration_id_external_id_key"
  ON "email_messages" ("workspace_id", "integration_id", "external_id");

-- New composite index for filtered-by-mailbox listing
CREATE INDEX "email_messages_workspace_id_integration_id_received_at_idx"
  ON "email_messages" ("workspace_id", "integration_id", "received_at" DESC);

-- Dedicated index for FK cascade DELETE performance (see commit abaa0a4)
CREATE INDEX "email_messages_integration_id_idx"
  ON "email_messages" ("integration_id");
