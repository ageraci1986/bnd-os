-- Phase A — add the 'viewer' enum value. Kept in its own migration
-- because Postgres forbids using a newly-added enum value inside the
-- same transaction. Phase B uses this value; Phase A leaves it unused
-- (the invitation flow explicitly rejects 'viewer' until then).
ALTER TYPE "public"."Role" ADD VALUE IF NOT EXISTS 'viewer';
