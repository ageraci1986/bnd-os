import type { Metadata } from 'next';
import { prisma } from '@nexushub/db';
import { requireSuperAdmin } from '@/lib/auth';
import { getCsrfTokenForForm } from '@/lib/csrf';
import { CreateWorkspaceForm } from '@/features/super-admin/components/create-workspace-form';
import { WorkspaceRow } from '@/features/super-admin/components/workspace-row';

export const metadata: Metadata = {
  title: 'Console super-admin',
};

const dateFormatterFr = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'long',
  timeZone: 'Europe/Paris',
});

export default async function SuperAdminPage() {
  await requireSuperAdmin();
  const csrf = await getCsrfTokenForForm();

  const workspaces = await prisma.workspace.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      slug: true,
      createdAt: true,
      _count: {
        select: {
          memberships: true,
          invitations: { where: { status: 'pending' } },
        },
      },
      memberships: {
        where: { role: 'admin' },
        select: {
          user: { select: { firstName: true, lastName: true, email: true } },
        },
      },
    },
  });

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-8">
        <h1 className="text-[34px] font-extrabold tracking-tight">
          Console <span className="gradient-text">super-admin</span>
        </h1>
        <p className="mt-2 text-sm text-[color:var(--color-text-muted)]">
          Provisionnez de nouveaux workspaces et invitez leur premier Admin. Le super-admin reste
          extérieur aux workspaces qu&apos;il crée — il ne devient pas membre automatiquement.
        </p>
      </header>

      <section className="mb-10">
        <h2 className="mb-4 text-[11px] font-extrabold uppercase tracking-[1px] text-[color:var(--color-text-muted)]">
          Créer un nouveau workspace
        </h2>
        <CreateWorkspaceForm csrfToken={csrf} />
      </section>

      <section>
        <h2 className="mb-4 text-[11px] font-extrabold uppercase tracking-[1px] text-[color:var(--color-text-muted)]">
          Workspaces existants ({workspaces.length})
        </h2>
        {workspaces.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-12 text-center text-sm text-[color:var(--color-text-muted)]">
            Aucun workspace pour le moment.
          </div>
        ) : (
          <ul className="rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] px-5 py-1">
            {workspaces.map((w) => {
              const admins = w.memberships.map((m) => {
                const displayName =
                  [m.user.firstName, m.user.lastName]
                    .filter((s): s is string => Boolean(s))
                    .join(' ')
                    .trim() || m.user.email;
                return { displayName, email: m.user.email };
              });
              return (
                <WorkspaceRow
                  key={w.id}
                  csrfToken={csrf}
                  id={w.id}
                  name={w.name}
                  slug={w.slug}
                  createdAtLabel={dateFormatterFr.format(w.createdAt)}
                  memberCount={w._count.memberships}
                  pendingInvitationCount={w._count.invitations}
                  admins={admins}
                />
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
