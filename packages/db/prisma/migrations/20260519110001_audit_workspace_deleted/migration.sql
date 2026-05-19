-- New audit kind for the super-admin console: hard-delete of a
-- workspace (and all its memberships, projects, clients, invitations
-- via existing onDelete: Cascade rules).

ALTER TYPE "public"."AuditAction" ADD VALUE 'workspace_deleted';
