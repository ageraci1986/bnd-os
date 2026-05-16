-- Phase B.2 — persist the scope picked by the Admin at invite time so
-- the acceptance flow can materialise it as WorkspaceAccess rows.
-- Empty arrays = "no restriction" (full workspace), same default as the
-- existing Membership model.
ALTER TABLE "public"."invitations"
  ADD COLUMN "scope_client_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];

ALTER TABLE "public"."invitations"
  ADD COLUMN "scope_project_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];
