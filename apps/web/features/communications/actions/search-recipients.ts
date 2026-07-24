'use server';
import 'server-only';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { getRateLimiter } from '@/lib/rate-limit';
import { prisma } from '@nexushub/db';
import { dedupeByEmail, scoreRow, type RecipientRow } from '../lib/recipient-match';

/**
 * searchRecipients — Communications iter V1.6 (recipient autocomplete).
 *
 * Backing store: `email_messages` (user-scoped via `integration.ownerUserId`)
 * unioned with `contacts` (workspace-scoped). Ranked by recency × frequency
 * with a fixed RACI-contact bonus (see `recipient-match.ts`).
 *
 * Spec: docs/superpowers/specs/2026-07-24-recipient-autocomplete-design.md
 * Plan: docs/superpowers/plans/2026-07-24-recipient-autocomplete.md (Task 3)
 *
 * SQL deviations from the plan's sketch (see plan Task 3 "Adaptation
 * authority"):
 *  1. `unaccent()` is applied to both sides of every ILIKE comparison and
 *     to the dedup key, so "elena" finds "Éléna" and vice versa. The
 *     extension is enabled by migration
 *     `packages/db/prisma/migrations/20260724150000_enable_unaccent/` —
 *     added in the V2 follow-up after V1.6 shipped with a plain-ILIKE
 *     fallback.
 *  2. Added `deleted_at IS NULL` to the `email_messages` scan — the plan's
 *     sketch omitted it, which would have surfaced soft-deleted mail
 *     (Graph `@removed` delta) as recipient suggestions.
 *  3. `contacts.raci` is a Postgres enum of full words
 *     (`responsible|approver|consulted|informed`), not single letters — the
 *     plan's `RawRow`/`RecipientSuggestion` types use the single-letter
 *     `'R'|'A'|'C'|'I'` shape (mirroring `raciLabelFr` in
 *     `@nexushub/domain`). The letter mapping is done in SQL via a `CASE`
 *     expression so the raw row already carries the letter — the TypeScript
 *     side stays a pure passthrough, matching the plan's implementation.
 */

const inputSchema = z.object({
  query: z.string().trim().min(1).max(100),
  limit: z.number().int().min(1).max(20).default(10),
});

export type SearchRecipientsInput = z.input<typeof inputSchema>;

export interface RecipientSuggestion {
  readonly email: string;
  readonly name: string | null;
  readonly source: 'mail' | 'contact';
  readonly jobTitle: string | null;
  readonly clientName: string | null;
  readonly raci: 'R' | 'A' | 'C' | 'I' | null;
}

export type SearchRecipientsResult =
  | { readonly ok: true; readonly suggestions: readonly RecipientSuggestion[] }
  | { readonly ok: false; readonly code: 'RATE_LIMIT' | 'INVALID_INPUT' };

interface RawRow {
  email: string;
  name: string | null;
  source: 'mail' | 'contact';
  hits: number;
  last_seen_at: string | Date;
  job_title: string | null;
  client_name: string | null;
  raci: 'R' | 'A' | 'C' | 'I' | null;
}

export async function searchRecipients(
  raw: SearchRecipientsInput,
): Promise<SearchRecipientsResult> {
  const ctx = await requireUser();

  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  const { query, limit } = parsed.data;

  const gate = await getRateLimiter('recipient_search').check(ctx.userId);
  if (!gate.success) return { ok: false, code: 'RATE_LIMIT' };

  // Ownership pattern: mail history filtered by integration.ownerUserId
  // (per-user boundary — PRD §10 hypothesis #8) AND by workspace. Contacts
  // are workspace-scoped by nature. Both scope values are sourced from
  // `ctx` (requireUser()) only — never from `raw`/`parsed` input.
  //
  // The query pre-filters on `query` inside the CTEs (via ILIKE) so the
  // outer UNION only walks matching rows. We bind the same query string 4
  // times via the tagged-template — Prisma parameterizes each interpolation,
  // so this is never string concatenation.
  const rows = await prisma.$queryRaw<RawRow[]>`
    WITH owned_integrations AS (
      SELECT id FROM integrations
      WHERE workspace_id = ${ctx.workspaceId}::uuid
        AND owner_user_id = ${ctx.userId}::uuid
        AND kind IN ('graph', 'imap')
    ),
    mail_addresses AS (
      SELECT from_email AS email,
             from_name AS name,
             received_at
      FROM email_messages
      WHERE workspace_id = ${ctx.workspaceId}::uuid
        AND integration_id IN (SELECT id FROM owned_integrations)
        AND deleted_at IS NULL
        AND from_email IS NOT NULL
      UNION ALL
      SELECT addr AS email,
             NULL AS name,
             received_at
      FROM email_messages,
           unnest(to_recipients) AS addr
      WHERE workspace_id = ${ctx.workspaceId}::uuid
        AND integration_id IN (SELECT id FROM owned_integrations)
        AND deleted_at IS NULL
      UNION ALL
      SELECT addr AS email,
             NULL AS name,
             received_at
      FROM email_messages,
           unnest(cc_recipients) AS addr
      WHERE workspace_id = ${ctx.workspaceId}::uuid
        AND integration_id IN (SELECT id FROM owned_integrations)
        AND deleted_at IS NULL
    ),
    mail_stats AS (
      SELECT lower(unaccent(email)) AS key,
             (array_agg(email ORDER BY received_at DESC))[1] AS email,
             (array_agg(name) FILTER (WHERE name IS NOT NULL))[1] AS name,
             'mail'::text AS source,
             count(*)::int AS hits,
             max(received_at) AS last_seen_at,
             NULL::text AS job_title,
             NULL::text AS client_name,
             NULL::text AS raci
      FROM mail_addresses
      WHERE lower(unaccent(email)) LIKE '%' || lower(unaccent(${query})) || '%'
         OR lower(unaccent(coalesce(name, ''))) LIKE '%' || lower(unaccent(${query})) || '%'
      GROUP BY lower(unaccent(email))
    ),
    contact_stats AS (
      SELECT lower(unaccent(c.email)) AS key,
             c.email,
             c.first_name || ' ' || c.last_name AS name,
             'contact'::text AS source,
             0::int AS hits,
             NOW() AS last_seen_at,
             c.job_title,
             cl.name AS client_name,
             CASE c.raci
               WHEN 'responsible' THEN 'R'
               WHEN 'approver' THEN 'A'
               WHEN 'consulted' THEN 'C'
               WHEN 'informed' THEN 'I'
               ELSE NULL
             END::text AS raci
      FROM contacts c
      LEFT JOIN clients cl ON cl.id = c.client_id
      WHERE c.workspace_id = ${ctx.workspaceId}::uuid
        AND c.email IS NOT NULL
        AND c.deleted_at IS NULL
        AND ( lower(unaccent(c.email)) LIKE '%' || lower(unaccent(${query})) || '%'
              OR lower(unaccent(c.first_name || ' ' || c.last_name)) LIKE '%' || lower(unaccent(${query})) || '%' )
    )
    SELECT * FROM mail_stats
    UNION ALL
    SELECT * FROM contact_stats
    LIMIT ${limit * 4};
  `;

  // Dedupe + rank in TypeScript (small N, and this is where the tested
  // matcher/scorer lives — SQL side is a coarse filter).
  const nowMs = Date.now();
  const merged = dedupeByEmail(
    rows.map(
      (r): RecipientRow => ({
        email: r.email,
        name: r.name,
        source: r.source,
        hits: r.hits,
        lastSeenAt: new Date(r.last_seen_at).toISOString(),
        jobTitle: r.job_title,
        clientName: r.client_name,
        raci: r.raci,
      }),
    ),
  );
  const ranked = merged
    .map((row) => ({
      row,
      score: scoreRow({ hits: row.hits, lastSeenAt: row.lastSeenAt, source: row.source }, nowMs),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(
      ({ row }): RecipientSuggestion => ({
        email: row.email,
        name: row.name,
        source: row.source,
        jobTitle: row.jobTitle,
        clientName: row.clientName,
        raci: row.raci,
      }),
    );

  return { ok: true, suggestions: ranked };
}
