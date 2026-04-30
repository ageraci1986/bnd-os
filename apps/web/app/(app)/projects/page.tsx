import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@nexushub/db';
import { requireUser } from '@/lib/auth';
import { getClientFilterFromSearchParams, resolveActiveClient } from '@/lib/client-filter/server';

export const metadata: Metadata = { title: 'Projets' };

interface ProjectsPageProps {
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ProjectsPage({ searchParams }: ProjectsPageProps) {
  const ctx = await requireUser();
  const sp = (await searchParams) ?? {};
  const filter = getClientFilterFromSearchParams(sp);
  const activeClient = await resolveActiveClient(filter, ctx.workspaceId);

  const projects = await prisma.project.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      deletedAt: null,
      archivedAt: null,
      ...(activeClient ? { clientId: activeClient.id } : {}),
    },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      name: true,
      description: true,
      startDate: true,
      endDate: true,
      client: { select: { name: true, colorToken: true } },
      type: { select: { name: true, icon: true } },
      _count: { select: { cards: { where: { deletedAt: null } } } },
    },
  });

  const calendarHref = activeClient
    ? `/projects/calendar?client=${activeClient.slug}`
    : '/projects/calendar';

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-8 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-[34px] font-extrabold tracking-tight">Projets</h1>
          <p className="mt-2 text-sm text-[color:var(--color-text-muted)]">
            {activeClient
              ? `Projets du client ${activeClient.name}.`
              : 'Tous les projets actifs de votre espace.'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="view-toggle">
            <Link href="" className="active" aria-current="page">
              ▦ Liste
            </Link>
            <Link href={calendarHref}>▭ Calendrier</Link>
          </div>
          <Link href="/projects/new" className="btn btn-primary">
            + Nouveau projet
          </Link>
        </div>
      </header>

      {projects.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-10 text-center">
          <h2 className="text-xl font-extrabold tracking-tight">
            {activeClient ? `Aucun projet pour ${activeClient.name}` : 'Aucun projet'}
          </h2>
          <p className="mt-2 text-sm text-[color:var(--color-text-muted)]">
            Lancez votre premier projet en passant par l’assistant de création.
          </p>
          <Link href="/projects/new" className="btn btn-primary mt-4 inline-block">
            Créer un projet →
          </Link>
        </div>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((p) => (
            <li key={p.id}>
              <Link
                href={`/projects/${p.id}`}
                className="block rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-5 shadow-[var(--shadow-card)] transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-hover)]"
              >
                <div className="mb-2 flex items-center gap-2 text-xs text-[color:var(--color-text-muted)]">
                  <span
                    aria-hidden="true"
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ background: `var(--${p.client.colorToken})` }}
                  />
                  {p.client.name}
                  {p.type ? (
                    <span>
                      · {p.type.icon} {p.type.name}
                    </span>
                  ) : null}
                </div>
                <h2 className="text-lg font-extrabold tracking-tight">{p.name}</h2>
                {p.description ? (
                  <p className="mt-1 line-clamp-2 text-sm text-[color:var(--color-text-muted)]">
                    {p.description}
                  </p>
                ) : null}
                <div className="mt-3 text-xs text-[color:var(--color-text-muted)]">
                  {p._count.cards === 0
                    ? 'Aucune carte'
                    : p._count.cards === 1
                      ? '1 carte'
                      : `${p._count.cards} cartes`}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
