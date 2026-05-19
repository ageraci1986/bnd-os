-- New audit kind for the super-admin console (Phase C). Logs the row
-- when a platform super-admin provisions a fresh workspace.

ALTER TYPE "public"."AuditAction" ADD VALUE 'workspace_created';
