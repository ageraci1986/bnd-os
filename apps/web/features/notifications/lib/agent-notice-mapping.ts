import type { AgentNoticeKind } from './notice-core';

/**
 * Server → client mapping for the notice stack (Plan 3b Task 7). Pure
 * function, no DB — the `notification` row shape is loaded by
 * `apps/web/app/(app)/assistant/page.tsx`, tolerantly mapped here, and the
 * result is what `NoticeStack` renders.
 */

export const AGENT_NOTICE_KINDS: readonly AgentNoticeKind[] = [
  'agent_briefing',
  'agent_card_blocked',
  'agent_mail_important',
];

const AGENT_NOTICE_KIND_SET = new Set<string>(AGENT_NOTICE_KINDS);

export interface AgentNotice {
  readonly id: string;
  readonly kind: AgentNoticeKind;
  readonly message: string;
  readonly discuss: string;
}

/** Raw shape selected from `prisma.notification.findMany` (`id`, `kind`, `data`). */
export interface RawNoticeRow {
  readonly id: string;
  readonly kind: string;
  readonly data: unknown;
}

/**
 * Tolerant mapper: `createAgentNotice` (notice-core.ts) always writes
 * `data.message`/`data.discuss` as non-empty strings, but this function does
 * NOT trust that invariant blindly — a notice with a malformed `data` blob
 * (older row shape, manual DB edit, future drift) is simply EXCLUDED rather
 * than crashing the page or rendering a broken row. `kind` is re-checked
 * against the 3 known agent kinds even though the caller's query already
 * filters on it, since this function must stay safe to call on arbitrary
 * input (unit-testable without a live query).
 */
export function toAgentNotice(row: RawNoticeRow): AgentNotice | null {
  if (!AGENT_NOTICE_KIND_SET.has(row.kind)) return null;
  if (typeof row.data !== 'object' || row.data === null) return null;
  const data = row.data as Record<string, unknown>;
  const message = data['message'];
  const discuss = data['discuss'];
  if (typeof message !== 'string' || message.trim() === '') return null;
  if (typeof discuss !== 'string' || discuss.trim() === '') return null;
  return { id: row.id, kind: row.kind as AgentNoticeKind, message, discuss };
}
