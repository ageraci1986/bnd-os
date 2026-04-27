import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@nexushub/db';
import { Roles } from '@nexushub/domain';
import { requireUser } from '@/lib/auth';

export const metadata: Metadata = {
  title: 'Tableau de bord',
};

/**
 * Placeholder Overview — full dashboard with metrics, urgent tasks and
 * activity feed lands in Phase 8.
 */
export default async function OverviewPage() {
  const ctx = await requireUser();

  const [profile, counts] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: ctx.userId },
      select: { firstName: true, email: true },
    }),
    prisma.$transaction([
      prisma.client.count({ where: { workspaceId: ctx.workspaceId, deletedAt: null } }),
      prisma.project.count({ where: { workspaceId: ctx.workspaceId, deletedAt: null } }),
      prisma.membership.count({ where: { workspaceId: ctx.workspaceId } }),
    ]),
  ]);

  const [clientCount, projectCount, memberCount] = counts;
  const greeting = profile.firstName ?? profile.email.split('@')[0] ?? 'vous';

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-9">
        <h1 className="text-[42px] font-extrabold tracking-tight">
          Hello {greeting},{' '}
          <span
            className="bg-clip-text text-transparent"
            style={{ backgroundImage: 'linear-gradient(135deg,#8B2BE2,#FF2A6D)' }}
          >
            bienvenue sur NexusHub.
          </span>
        </h1>
        <p className="mt-2 text-[15px] text-[color:var(--color-text-muted)]">
          Le shell complet (Sidebar, métriques, activité) arrive en Phase 3 + 8. En attendant, voici
          votre espace.
        </p>
      </div>

      <div className="mb-10 grid grid-cols-3 gap-5">
        <Stat label="Clients actifs" value={clientCount} />
        <Stat label="Projets" value={projectCount} />
        <Stat label="Membres" value={memberCount} />
      </div>

      {ctx.role === Roles.Admin ? (
        <div className="rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-6 shadow-sm">
          <h2 className="text-xl font-extrabold tracking-tight">Inviter votre première personne</h2>
          <p className="mt-1 text-sm text-[color:var(--color-text-muted)]">
            En tant qu&apos;Admin, vous pouvez inviter des membres dès maintenant pour tester le
            flow de bout en bout.
          </p>
          <Link
            href="/team"
            className="mt-4 inline-flex rounded-full bg-gradient-to-br from-[#8B2BE2] to-[#FF2A6D] px-5 py-2.5 text-[13px] font-bold text-white shadow-md transition hover:-translate-y-0.5"
          >
            Aller à la page Équipe →
          </Link>
        </div>
      ) : (
        <div className="rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-6 shadow-sm">
          <h2 className="text-xl font-extrabold tracking-tight">Rien à faire pour vous ici</h2>
          <p className="mt-1 text-sm text-[color:var(--color-text-muted)]">
            Les modules Projets, Communications et Clients arrivent en Phases 4 à 8.
          </p>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div
      className="rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-6 shadow-sm"
      style={{ boxShadow: 'var(--shadow-card)' }}
    >
      <p className="text-[11px] font-bold uppercase tracking-[1px] text-[color:var(--color-text-muted)]">
        {label}
      </p>
      <p className="mt-3 text-[34px] font-extrabold leading-none tracking-tight">{value}</p>
    </div>
  );
}
