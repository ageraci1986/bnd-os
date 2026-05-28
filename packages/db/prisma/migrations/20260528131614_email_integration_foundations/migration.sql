-- AlterTable
ALTER TABLE "integrations" ADD COLUMN "delta_token" TEXT;

-- AlterTable
ALTER TABLE "email_messages" ADD COLUMN "deleted_at" TIMESTAMPTZ(6);

-- AlterTable: widen oauth_states.state from VARCHAR(128) to TEXT
-- (signed payload + HMAC exceeds 128 chars).
ALTER TABLE "oauth_states" ALTER COLUMN "state" TYPE TEXT;

-- CreateIndex
CREATE INDEX "email_messages_workspace_id_deleted_at_idx" ON "email_messages" ("workspace_id", "deleted_at");
