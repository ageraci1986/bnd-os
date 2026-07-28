import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@nexushub/db';
import { requireUser } from '@/lib/auth';
import { AssistantPreferences } from '@/features/settings/components/assistant-preferences';

export const metadata: Metadata = { title: 'Paramètres' };

/**
 * Settings landing page (Plan 3b Task 8) — first real content, replacing
 * the `ComingSoon` placeholder. Loads the two `Membership` assistant flags
 * plus the `NotificationPreference` rows for the 2 agent kinds surfaced in
 * the UI (`agent_card_blocked`, `agent_mail_important` — `agent_briefing`
 * is controlled solely by `assistantBriefingOptIn`, see
 * `AssistantPreferences`'s doc comment). Absence of a `NotificationPreference`
 * row means "enabled" (schema default `enabled: true`), matching
 * `notice-core.ts`'s read side exactly.
 */
export default async function SettingsPage() {
  const ctx = await requireUser();

  const [membership, preferences] = await Promise.all([
    prisma.membership.findUnique({
      where: { workspaceId_userId: { workspaceId: ctx.workspaceId, userId: ctx.userId } },
      select: { assistantProactivity: true, assistantBriefingOptIn: true },
    }),
    prisma.notificationPreference.findMany({
      where: {
        userId: ctx.userId,
        kind: { in: ['agent_card_blocked', 'agent_mail_important'] },
        channel: 'in_app',
      },
      select: { kind: true, enabled: true },
    }),
  ]);

  const enabledByKind = new Map(preferences.map((p) => [p.kind, p.enabled]));

  return (
    <div className="mx-auto max-w-[900px]">
      <header className="mb-6">
        <h1 className="text-[28px] font-extrabold tracking-tight">Paramètres</h1>
        <p className="mt-1 text-sm text-[color:var(--color-text-muted)]">
          Préférences personnelles pour cet espace de travail.
        </p>
      </header>

      <div className="flex flex-col gap-4">
        <AssistantPreferences
          proactivity={membership?.assistantProactivity ?? true}
          briefingOptIn={membership?.assistantBriefingOptIn ?? false}
          kinds={{
            agent_card_blocked: enabledByKind.get('agent_card_blocked') ?? true,
            agent_mail_important: enabledByKind.get('agent_mail_important') ?? true,
          }}
        />

        <section className="rounded-xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-5">
          <h2 className="text-base font-bold">Boîtes email</h2>
          <p className="mt-1 text-xs text-[color:var(--color-text-muted)]">
            Signatures et préférences par boîte connectée.
          </p>
          <Link href="/settings/mailboxes" className="btn btn-ghost btn-sm mt-3">
            Gérer les boîtes email →
          </Link>
        </section>

        <p className="text-xs text-[color:var(--color-text-muted)]">
          D&apos;autres réglages arrivent (langue, fuseau horaire, notifications push, profil).
        </p>
      </div>
    </div>
  );
}
