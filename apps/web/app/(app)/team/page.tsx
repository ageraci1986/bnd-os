import type { Metadata } from 'next';
import { prisma } from '@nexushub/db';
import { MetricCard } from '@nexushub/ui';
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

  const [members, invitations, accessRows, clientOptions, projectOptions] = await Promise.all([
    prisma.membership.findMany({
      where: { workspaceId: ctx.workspaceId },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        role: true,
        userId: true,
        user: {
          select: { firstName: true, lastName: true, email: true, isSuperAdmin: true },
        },
      },
    }),
    prisma.invitation.findMany({
      where: { workspaceId: ctx.workspaceId, status: 'pending' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, email: true, role: true, expiresAt: true },
    }),
    prisma.workspaceAccess.findMany({
      where: { workspaceId: ctx.workspaceId },
      select: { membershipId: true, clientId: true, projectId: true },
    }),
    prisma.client.findMany({
      where: { workspaceId: ctx.workspaceId, deletedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.project.findMany({
      where: { workspaceId: ctx.workspaceId, deletedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, client: { select: { name: true } } },
    }),
  ]);

  const scopeByMembership = new Map<string, { clientIds: string[]; projectIds: string[] }>();
  for (const r of accessRows) {
    const cur = scopeByMembership.get(r.membershipId) ?? { clientIds: [], projectIds: [] };
    if (r.clientId) cur.clientIds.push(r.clientId);
    if (r.projectId) cur.projectIds.push(r.projectId);
    scopeByMembership.set(r.membershipId, cur);
  }

  const projectOptionsShaped = projectOptions.map((p) => ({
    id: p.id,
    name: p.name,
    clientName: p.client.name,
  }));

  const fmt = (n: number): string => n.toString().padStart(2, '0');
  const isAlone = members.length <= 1;

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-8">
        <h1 className="text-[34px] font-extrabold tracking-tight">Équipe</h1>
        <p className="mt-2 text-sm text-[color:var(--color-text-muted)]">
          Gérez les membres et les invitations en cours pour cet espace.
        </p>
      </header>

      <div className="mb-8 grid grid-cols-2 gap-5">
        <MetricCard label="Membres" value={fmt(members.length)} />
        <MetricCard
          label="Invitations en attente"
          value={fmt(invitations.length)}
          valueTone={invitations.length > 0 ? 'warning' : 'neutral'}
        />
      </div>

      <section aria-label="Inviter une personne" className="mb-10">
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
        {isAlone ? (
          <p className="py-4 text-sm text-[color:var(--color-text-muted)]">
            Vous êtes seul(e) dans l’espace pour l’instant. Envoyez une invitation ci-dessus pour
            commencer à collaborer.
          </p>
        ) : (
          <ul className="divide-y divide-[color:var(--color-border-soft)]">
            {members.map((m) => {
              const displayName =
                [m.user.firstName, m.user.lastName]
                  .filter((s): s is string => Boolean(s))
                  .join(' ')
                  .trim() || m.user.email;
              const memberScope =
                m.role === 'admin'
                  ? undefined
                  : (() => {
                      const rows = scopeByMembership.get(m.id);
                      if (!rows) return { kind: 'workspace' as const };
                      return {
                        kind: 'restricted' as const,
                        clientIds: rows.clientIds,
                        projectIds: rows.projectIds,
                      };
                    })();
              return (
                <MemberRow
                  key={m.id}
                  csrfToken={csrf}
                  membershipId={m.id}
                  userId={m.userId}
                  currentUserId={ctx.userId}
                  displayName={displayName}
                  email={m.user.email}
                  role={m.role}
                  isSuperAdmin={m.user.isSuperAdmin}
                  {...(memberScope !== undefined ? { scope: memberScope } : {})}
                  clientOptions={clientOptions}
                  projectOptions={projectOptionsShaped}
                />
              );
            })}
          </ul>
        )}
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
            Aucune invitation en attente. Les liens envoyés expirent automatiquement après 72
            heures.
          </p>
        ) : (
          <ul className="divide-y divide-[color:var(--color-border-soft)]">
            {invitations.map((inv) => (
              <PendingInvitationRow
                key={inv.id}
                csrfToken={csrf}
                invitationId={inv.id}
                email={inv.email}
                role={inv.role}
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
