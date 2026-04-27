import type { Metadata } from 'next';
import { prisma } from '@nexushub/db';
import { Roles } from '@nexushub/domain';
import { requireAdmin } from '@/lib/auth';
import { getCsrfTokenForForm } from '@/lib/csrf';
import { InvitationForm } from '@/features/team/components/invitation-form';
import { MemberRow } from '@/features/team/components/member-row';
import { PendingInvitationRow } from '@/features/team/components/pending-invitation-row';

export const metadata: Metadata = {
  title: 'Équipe',
};

const dateFormatterFr = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'long',
  timeStyle: 'short',
  timeZone: 'Europe/Paris',
});

export default async function TeamPage() {
  const ctx = await requireAdmin();
  const csrf = await getCsrfTokenForForm();

  const [members, invitations] = await Promise.all([
    prisma.membership.findMany({
      where: { workspaceId: ctx.workspaceId },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        role: true,
        userId: true,
        user: { select: { firstName: true, lastName: true, email: true } },
      },
    }),
    prisma.invitation.findMany({
      where: { workspaceId: ctx.workspaceId, status: 'pending' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, email: true, role: true, expiresAt: true },
    }),
  ]);

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-8">
        <h1 className="text-[34px] font-extrabold tracking-tight">Équipe</h1>
        <p className="mt-2 text-sm text-[color:var(--color-text-muted)]">
          Gérez les membres et les invitations en cours pour cet espace.
        </p>
      </header>

      <section aria-labelledby="invite-heading" className="mb-10">
        <h2 id="invite-heading" className="sr-only">
          Inviter une personne
        </h2>
        <InvitationForm csrfToken={csrf} />
      </section>

      <section
        aria-labelledby="members-heading"
        className="mb-10 rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-6 shadow-sm"
      >
        <header className="mb-2 flex items-center justify-between">
          <h2 id="members-heading" className="text-xl font-extrabold tracking-tight">
            Membres ({members.length})
          </h2>
        </header>
        <ul className="divide-y divide-[color:var(--color-border-soft)]">
          {members.map((m) => {
            const displayName =
              [m.user.firstName, m.user.lastName]
                .filter((s): s is string => Boolean(s))
                .join(' ')
                .trim() || m.user.email;
            return (
              <MemberRow
                key={m.id}
                csrfToken={csrf}
                membershipId={m.id}
                userId={m.userId}
                currentUserId={ctx.userId}
                displayName={displayName}
                email={m.user.email}
                role={m.role === Roles.Admin ? 'admin' : 'member'}
              />
            );
          })}
        </ul>
      </section>

      <section
        aria-labelledby="invitations-heading"
        className="rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-6 shadow-sm"
      >
        <header className="mb-2 flex items-center justify-between">
          <h2 id="invitations-heading" className="text-xl font-extrabold tracking-tight">
            Invitations en attente ({invitations.length})
          </h2>
        </header>
        {invitations.length === 0 ? (
          <p className="py-4 text-sm text-[color:var(--color-text-muted)]">
            Aucune invitation en attente.
          </p>
        ) : (
          <ul className="divide-y divide-[color:var(--color-border-soft)]">
            {invitations.map((inv) => (
              <PendingInvitationRow
                key={inv.id}
                csrfToken={csrf}
                invitationId={inv.id}
                email={inv.email}
                role={inv.role === Roles.Admin ? 'admin' : 'member'}
                expiresAtIso={inv.expiresAt.toISOString()}
                expiresLabel={dateFormatterFr.format(inv.expiresAt)}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
