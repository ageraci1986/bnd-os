-- Plan 3b: proactivité assistant — notices in-app, préférences par membre.
ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'agent_briefing';
ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'agent_card_blocked';
ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'agent_mail_important';
ALTER TYPE "NotificationChannel" ADD VALUE IF NOT EXISTS 'in_app';

ALTER TABLE "memberships"
  ADD COLUMN "assistant_proactivity" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "assistant_briefing_opt_in" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "notifications_user_id_kind_read_at_idx"
  ON "notifications" ("user_id", "kind", "read_at");
