import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@nexushub/db';
import { requireUser } from '@/lib/auth';

export const metadata: Metadata = { title: 'Projet' };

interface ProjectPageProps {
  readonly params: Promise<{ id: string }>;
}

export default async function ProjectPage({ params }: ProjectPageProps) {
  const ctx = await requireUser();
  const { id } = await params;

  const project = await prisma.project.findFirst({
    where: { id, workspaceId: ctx.workspaceId, deletedAt: null },
    select: {
      id: true,
      name: true,
      description: true,
      startDate: true,
      endDate: true,
      client: { select: { id: true, name: true, colorToken: true } },
      type: { select: { name: true, icon: true } },
      columns: {
        orderBy: { position: 'asc' },
        select: { id: true, name: true, position: true, isBlockedSystem: true },
      },
      members: {
        select: {
          id: true,
          role: true,
          user: { select: { firstName: true, lastName: true, email: true } },
        },
      },
    },
  });
  if (!project) notFound();

  return (
    <div className="mx-auto max-w-5xl">
      <nav className="mb-4 text-xs text-[color:var(--color-text-muted)]">
        <Link href="/projects" className="underline">
          ← Tous les projets
        </Link>
      </nav>

      <header className="mb-6">
        <div className="mb-2 flex items-center gap-2 text-xs text-[color:var(--color-text-muted)]">
          <span
            aria-hidden="true"
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: `var(--${project.client.colorToken})` }}
          />
          {project.client.name}
          {project.type ? (
            <span>
              · {project.type.icon} {project.type.name}
            </span>
          ) : null}
        </div>
        <h1 className="text-[34px] font-extrabold tracking-tight">{project.name}</h1>
        {project.description ? (
          <p className="mt-2 text-sm text-[color:var(--color-text-muted)]">{project.description}</p>
        ) : null}
      </header>

      <section className="mb-6 rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-5 shadow-sm">
        <h2 className="mb-3 text-xs font-extrabold uppercase tracking-[1px] text-[color:var(--color-text-muted)]">
          Colonnes du Kanban
        </h2>
        <div className="flex flex-wrap gap-2">
          {project.columns.map((c) => (
            <span key={c.id} className={`tpl-pill ${c.isBlockedSystem ? 'blocked' : ''}`}>
              {c.name}
            </span>
          ))}
        </div>
        <p className="mt-4 text-xs text-[color:var(--color-text-muted)]">
          Le board interactif (drag & drop, cartes, auto-progression) arrive en Phase 5 D.2.
        </p>
      </section>

      <section className="rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-5 shadow-sm">
        <h2 className="mb-3 text-xs font-extrabold uppercase tracking-[1px] text-[color:var(--color-text-muted)]">
          Équipe ({project.members.length})
        </h2>
        <ul className="divide-y divide-[color:var(--color-border-soft)]">
          {project.members.map((m) => {
            const name =
              [m.user.firstName, m.user.lastName].filter(Boolean).join(' ').trim() || m.user.email;
            return (
              <li key={m.id} className="flex items-center justify-between py-2.5 text-sm">
                <span className="font-bold">{name}</span>
                <span className="text-xs uppercase tracking-[0.5px] text-[color:var(--color-text-muted)]">
                  {m.role === 'lead' ? 'Pilote' : 'Membre'}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
