import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@nexushub/db';
import { requireUser } from '@/lib/auth';
import { loadUserScope, scopedProjectWhere } from '@/lib/auth/scope';

export const metadata: Metadata = { title: 'Mes projets' };

export default async function MyProjectsPage() {
  const ctx = await requireUser();
  const scope = await loadUserScope(ctx);

  const projects = await prisma.project.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      deletedAt: null,
      archivedAt: null,
      ...scopedProjectWhere(scope),
    },
    orderBy: [{ client: { name: 'asc' } }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      description: true,
      client: { select: { id: true, name: true, colorToken: true } },
      _count: { select: { cards: { where: { deletedAt: null } } } },
    },
  });

  // Group by client name for the visual sections.
  const byClient = new Map<string, typeof projects>();
  for (const p of projects) {
    const key = p.client.name;
    const list = byClient.get(key) ?? [];
    list.push(p);
    byClient.set(key, list);
  }

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-8">
        <h1 className="text-[34px] font-extrabold tracking-tight">Mes projets</h1>
        <p className="mt-2 text-sm text-[color:var(--color-text-muted)]">
          Les projets auxquels tu as accès dans cet espace.
        </p>
      </header>

      {projects.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-10 text-center">
          <h2 className="text-xl font-extrabold tracking-tight">Aucun projet partagé</h2>
          <p className="mt-2 text-sm text-[color:var(--color-text-muted)]">
            Quand un Admin partagera un projet avec toi, il apparaîtra ici.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {Array.from(byClient.entries()).map(([clientName, list]) => {
            const first = list[0];
            if (!first) return null;
            return (
              <section key={clientName}>
                <h2 className="mb-3 flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-[1px] text-[color:var(--color-text-muted)]">
                  <span
                    aria-hidden="true"
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ background: `var(--${first.client.colorToken})` }}
                  />
                  {clientName}
                </h2>
                <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {list.map((p) => (
                    <li key={p.id}>
                      <Link
                        href={`/projects/${p.id}`}
                        className="block rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-5 shadow-[var(--shadow-card)] transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-hover)]"
                      >
                        <h3 className="text-lg font-extrabold tracking-tight">{p.name}</h3>
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
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
