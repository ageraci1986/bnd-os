-- Phase A — platform-level super-admin flag.
-- Default false for everyone; Angelo is the bootstrap super-admin.
-- The Phase C console will own runtime promotions; this migration is
-- the only place that hard-codes an email.
ALTER TABLE "public"."users"
  ADD COLUMN "is_super_admin" BOOLEAN NOT NULL DEFAULT FALSE;

-- Partial index so the auth lookup stays cheap when checking the flag.
CREATE INDEX IF NOT EXISTS "users_is_super_admin_idx"
  ON "public"."users" ("is_super_admin")
  WHERE "is_super_admin" = TRUE;

-- Bootstrap. If the user doesn't exist yet (fresh DB), this is a no-op
-- and the flag will be set when the account is provisioned later.
UPDATE "public"."users"
   SET "is_super_admin" = TRUE
 WHERE "email" = 'ageraci.finance@gmail.com';
