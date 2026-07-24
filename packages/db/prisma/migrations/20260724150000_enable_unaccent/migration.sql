-- Recipient autocomplete V1.6 → V2 follow-up.
--
-- Enables the `unaccent` Postgres extension so `searchRecipients`
-- (apps/web/features/communications/actions/search-recipients.ts) can match
-- queries insensitive to diacritics — "elena" finds "Éléna", "boedec" finds
-- "Boëdec", etc. — per spec §3.2. V1.6 shipped with a plain-ILIKE fallback
-- because the extension wasn't installed on the target Supabase project;
-- this migration removes the debt.
--
-- Already applied to yphedrhofupththvlvoa (shared Supabase) on 2026-07-24
-- via supabase MCP apply_migration. This file exists so the migration is
-- reproducible on any freshly-provisioned env.

CREATE EXTENSION IF NOT EXISTS unaccent;
