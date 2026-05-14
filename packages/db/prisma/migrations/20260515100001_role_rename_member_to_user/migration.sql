-- Phase A — rename the existing 'member' enum value to 'user' in place.
-- Postgres 12+ ALTER TYPE ... RENAME VALUE rewrites the label without
-- touching any row data; every membership/invitation that was 'member'
-- now reads as 'user' atomically.
ALTER TYPE "public"."Role" RENAME VALUE 'member' TO 'user';