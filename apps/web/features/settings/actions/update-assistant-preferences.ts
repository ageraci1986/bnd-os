'use server';
import 'server-only';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@nexushub/db';
import { requireUser } from '@/lib/auth';
import type { AgentNoticeKind } from '@/features/notifications/lib/notice-core';

/**
 * Settings → Assistant preferences (Plan 3b Task 8). Plain-object JSON
 * action, same convention as `moveCard`/`skipCardToNextColumn`
 * (projects/actions): no CSRF form field, since the caller is always a
 * same-origin client component invoking the action directly (not a
 * `<form>` submit) — Server Actions already enforce an Origin/Referer
 * check at the framework level for this call shape (CLAUDE.md §4.3.2).
 *
 * Writes span two tables:
 *  - `Membership.assistantProactivity` / `assistantBriefingOptIn` — the
 *    workspace-scoped kill switch + briefing opt-in (`workspaceId_userId`
 *    compound key, same as `notice-core.ts`'s read side).
 *  - `NotificationPreference` (userId, kind, channel='in_app') — per-kind
 *    on/off. This table has no `workspaceId` column (it's user-level, not
 *    workspace-level — a user keeps one set of notification prefs across
 *    every workspace they're a member of), so it's scoped by `ctx.userId`
 *    only, matching `notice-core.ts`'s read.
 *
 * ADR #10: save is automatic (no submit button) — the caller fires this on
 * every toggle flip and shows a toast itself.
 */

const AgentNoticeKindSchema = z.enum([
  'agent_briefing',
  'agent_card_blocked',
  'agent_mail_important',
]);

const InputSchema = z
  .object({
    proactivity: z.boolean().optional(),
    briefingOptIn: z.boolean().optional(),
    kinds: z.record(AgentNoticeKindSchema, z.boolean()).optional(),
  })
  .refine(
    (v) =>
      v.proactivity !== undefined ||
      v.briefingOptIn !== undefined ||
      (v.kinds !== undefined && Object.keys(v.kinds).length > 0),
    { message: 'Au moins un champ à mettre à jour.' },
  );

export interface UpdateAssistantPreferencesInput {
  readonly proactivity?: boolean;
  readonly briefingOptIn?: boolean;
  readonly kinds?: Partial<Record<AgentNoticeKind, boolean>>;
}

export type UpdateAssistantPreferencesResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

export async function updateAssistantPreferences(
  input: UpdateAssistantPreferencesInput,
): Promise<UpdateAssistantPreferencesResult> {
  const parsed = InputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Données invalides.' };
  }
  const { proactivity, briefingOptIn, kinds } = parsed.data;

  const ctx = await requireUser();

  if (proactivity !== undefined || briefingOptIn !== undefined) {
    await prisma.membership.update({
      where: { workspaceId_userId: { workspaceId: ctx.workspaceId, userId: ctx.userId } },
      data: {
        ...(proactivity !== undefined ? { assistantProactivity: proactivity } : {}),
        ...(briefingOptIn !== undefined ? { assistantBriefingOptIn: briefingOptIn } : {}),
      },
    });
  }

  if (kinds) {
    for (const [kind, enabled] of Object.entries(kinds) as [AgentNoticeKind, boolean][]) {
      await prisma.notificationPreference.upsert({
        where: { userId_kind_channel: { userId: ctx.userId, kind, channel: 'in_app' } },
        create: { userId: ctx.userId, kind, channel: 'in_app', enabled },
        update: { enabled },
      });
    }
  }

  revalidatePath('/settings');
  return { ok: true };
}
