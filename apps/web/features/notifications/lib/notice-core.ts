import 'server-only';
import { prisma } from '@nexushub/db';
import type { Prisma } from '@nexushub/db';

/**
 * Core creator for assistant-generated notices (Plan 3b Task 3).
 *
 * Consumed by the Inngest functions (Task 4 briefing, Task 5 blocked-cards
 * scan, Task 6 important mails) — never by a user-facing Server Action
 * directly. Centralizes the three proactivity guards (workspace kill switch,
 * briefing opt-in, per-kind NotificationPreference) and the dedup rule so
 * every notice-producing cron shares identical behavior.
 *
 * PII CONTRACT (CLAUDE.md §4.7 — no PII in logs; anti-injection consistency
 * with Plan 5c): this core does NOT scrub or validate `message`/`data` — that
 * is the CALLER'S responsibility. Callers must uphold:
 *   - `message`: a single sentence, containing nothing the user cannot
 *     already see elsewhere in the app (card title, contact name, etc. — all
 *     data the user has access to, never raw external/untrusted content).
 *   - `data.discuss`: IDs and verbs only (e.g. "Parlons de la carte <cardId>
 *     passée en Bloqué") — NEVER raw external content (mail body, Slack
 *     message text, …), since this string is fed back into the assistant as
 *     a user-authored message and must not carry an injection vector.
 */

export type AgentNoticeKind = 'agent_briefing' | 'agent_card_blocked' | 'agent_mail_important';

export interface AgentNoticeInput {
  readonly workspaceId: string;
  readonly userId: string;
  readonly kind: AgentNoticeKind;
  /** Texte montrable de la notice (une phrase, sans PII au-delà de ce que l'utilisateur voit déjà dans l'app). */
  readonly message: string;
  /** Référence structurée (cardId/mailId/date du briefing) + suggestion de message « En discuter ». */
  readonly data: { readonly ref?: string; readonly discuss: string };
}

// Bounded scan for the JS-side dedup fallback (see comment below) — a user
// realistically never has more than a handful of unread notices of the same
// kind at once; 50 is a generous ceiling that keeps the query cheap.
const DEDUP_SCAN_LIMIT = 50;

export async function createAgentNotice(input: AgentNoticeInput): Promise<{ created: boolean }> {
  const membership = await prisma.membership.findUnique({
    where: { workspaceId_userId: { workspaceId: input.workspaceId, userId: input.userId } },
    select: { assistantProactivity: true, assistantBriefingOptIn: true },
  });
  if (!membership) return { created: false };
  if (!membership.assistantProactivity) return { created: false };
  if (input.kind === 'agent_briefing' && !membership.assistantBriefingOptIn) {
    return { created: false };
  }

  const preference = await prisma.notificationPreference.findUnique({
    where: {
      userId_kind_channel: { userId: input.userId, kind: input.kind, channel: 'in_app' },
    },
    select: { enabled: true },
  });
  // Absence of a row means "enabled" (schema default) — only an explicit
  // `enabled: false` row blocks the notice.
  if (preference && !preference.enabled) return { created: false };

  if (input.data.ref !== undefined) {
    // Dedup by (userId, kind, data.ref) among UNREAD notices only — a read
    // notice never blocks a fresh one (e.g. briefing dedupes by
    // `briefing-YYYY-MM-DD`; once read, the next day's ref differs anyway,
    // but a same-day re-run after read should still be allowed to recreate).
    //
    // `data` is a Prisma Json column on Postgres — a native `path`/`equals`
    // JSON filter is possible there, but its behavior on a MISSING key
    // (`ref` is optional) is subtle across Prisma versions. We instead load
    // the bounded set of unread notices of this kind and compare `data.ref`
    // in JS — simpler, provider-agnostic, and easy to unit test without a
    // live Postgres instance.
    const unread = await prisma.notification.findMany({
      where: { userId: input.userId, kind: input.kind, readAt: null },
      select: { data: true },
      take: DEDUP_SCAN_LIMIT,
    });
    const isDuplicate = unread.some((notification) => {
      const data = notification.data as { ref?: string } | null;
      return data?.ref === input.data.ref;
    });
    if (isDuplicate) return { created: false };
  }

  const data: Prisma.InputJsonObject = {
    message: input.message,
    discuss: input.data.discuss,
    ...(input.data.ref !== undefined ? { ref: input.data.ref } : {}),
  };

  await prisma.notification.create({
    data: {
      workspaceId: input.workspaceId,
      userId: input.userId,
      kind: input.kind,
      channel: 'in_app',
      data,
    },
  });
  return { created: true };
}
