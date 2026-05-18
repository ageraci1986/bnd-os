import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@nexushub/db';
import { Roles } from '@nexushub/domain';
import { MetricCard } from '@nexushub/ui';
import { requireUser } from '@/lib/auth';
import { getClientFilterFromSearchParams, resolveActiveClient } from '@/lib/client-filter/server';
import { getOverviewMetrics } from '@/features/overview/lib/metrics';
import { reconcileBeforeRead } from '@/features/projects/lib/reconcile';
import { loadUserScope } from '@/lib/auth/scope';

export const metadata: Metadata = {
  title: 'Tableau de bord',
};

interface OverviewPageProps {
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function OverviewPage({ searchParams }: OverviewPageProps) {
  const ctx = await requireUser();
  const sp = (await searchParams) ?? {};
  const filter = getClientFilterFromSearchParams(sp);

  // Parallelism strategy: every promise that only depends on `ctx` runs
  // concurrently from the start. Reconcile-on-read is fire-and-await but
  // doesn't block the data fetches that follow — those wait on `scope`
  // (and `scope` only on `ctx`). Cuts a ~4-stage waterfall down to ~3.
  const reconcilePromise = reconcileBeforeRead(ctx.workspaceId);
  const profilePromise = prisma.user.findUniqueOrThrow({
    where: { id: ctx.userId },
    select: { firstName: true, email: true },
  });
  const scope = await loadUserScope(ctx);

  const activeClient = await resolveActiveClient(filter, ctx.workspaceId, scope);

  const [, profile, metrics] = await Promise.all([
    reconcilePromise,
    profilePromise,
    getOverviewMetrics({
      workspaceId: ctx.workspaceId,
      scope,
      ...(activeClient ? { clientId: activeClient.id } : {}),
    }),
  ]);

  const greeting = profile.firstName ?? profile.email.split('@')[0] ?? 'vous';
  const isAdmin = ctx.role === Roles.Admin;
  const fmt = (n: number): string => n.toString().padStart(2, '0');

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-9">
        <h1 className="text-[42px] font-extrabold tracking-tight">
          Hello {greeting},{' '}
          <span
            className="bg-clip-text text-transparent"
            style={{ backgroundImage: 'linear-gradient(135deg,#8B2BE2,#FF2A6D)' }}
          >
            {activeClient ? `vue ${activeClient.name}.` : 'bienvenue sur NexusHub.'}
          </span>
        </h1>
        <p className="mt-2 text-[15px] text-[color:var(--color-text-muted)]">
          {activeClient
            ? `Métriques restreintes au client ${activeClient.name}. Retirez le filtre pour la vue globale.`
            : 'Vue d’ensemble de votre espace. Sélectionnez un client dans la sidebar pour filtrer.'}
        </p>
      </div>

      <div className="mb-10 grid grid-cols-2 gap-5 md:grid-cols-4">
        {activeClient ? (
          <MetricCard label="Client actif" value={activeClient.name} />
        ) : (
          <MetricCard label="Clients actifs" value={fmt(metrics.clients)} />
        )}
        <MetricCard label="Projets actifs" value={fmt(metrics.projects)} />
        <MetricCard
          label={activeClient ? 'Membres impliqués' : 'Membres équipe'}
          value={fmt(metrics.members)}
        />
        <MetricCard
          label="Cartes bloquées"
          value={fmt(metrics.blockedCards)}
          valueTone={metrics.blockedCards > 0 ? 'danger' : 'neutral'}
        />
      </div>

      {metrics.projects === 0 ? (
        <EmptyProjectsCard activeClientName={activeClient?.name ?? null} isAdmin={isAdmin} />
      ) : isAdmin ? (
        <AdminWelcomeCard />
      ) : (
        <MemberWelcomeCard />
      )}
    </div>
  );
}

function EmptyProjectsCard({
  activeClientName,
  isAdmin,
}: {
  activeClientName: string | null;
  isAdmin: boolean;
}) {
  const title = activeClientName
    ? `Aucun projet pour ${activeClientName}`
    : 'Aucun projet pour le moment';
  const body = activeClientName
    ? 'Ce client n’a pas encore de projet actif. Créez-en un pour démarrer un Kanban.'
    : 'Lancez votre premier projet pour ouvrir un Kanban et inviter votre équipe.';

  return (
    <div className="rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-6 shadow-sm">
      <h2 className="text-xl font-extrabold tracking-tight">{title}</h2>
      <p className="mt-1 text-sm text-[color:var(--color-text-muted)]">{body}</p>
      {isAdmin ? (
        <Link
          href="/projects"
          className="mt-4 inline-flex rounded-full bg-gradient-to-br from-[#8B2BE2] to-[#FF2A6D] px-5 py-2.5 text-[13px] font-bold text-white shadow-md transition hover:-translate-y-0.5"
        >
          Créer un projet →
        </Link>
      ) : null}
    </div>
  );
}

function AdminWelcomeCard() {
  return (
    <div className="rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-6 shadow-sm">
      <h2 className="text-xl font-extrabold tracking-tight">Inviter votre première personne</h2>
      <p className="mt-1 text-sm text-[color:var(--color-text-muted)]">
        En tant qu&apos;Admin, vous pouvez inviter des membres dès maintenant pour tester le flow de
        bout en bout.
      </p>
      <Link
        href="/team"
        className="mt-4 inline-flex rounded-full bg-gradient-to-br from-[#8B2BE2] to-[#FF2A6D] px-5 py-2.5 text-[13px] font-bold text-white shadow-md transition hover:-translate-y-0.5"
      >
        Aller à la page Équipe →
      </Link>
    </div>
  );
}

function MemberWelcomeCard() {
  return (
    <div className="rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-6 shadow-sm">
      <h2 className="text-xl font-extrabold tracking-tight">Bienvenue dans l’espace</h2>
      <p className="mt-1 text-sm text-[color:var(--color-text-muted)]">
        Les fiches clients sont disponibles dans l’atelier. Les modules Projets et Communications
        arrivent dans les prochaines phases.
      </p>
    </div>
  );
}
