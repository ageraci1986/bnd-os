import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@nexushub/db';
import { requireUser } from '@/lib/auth';
import { getCsrfTokenForForm } from '@/lib/csrf';
import { KanbanBoard } from '@/features/projects/components/kanban-board';
import { CardModal } from '@/features/projects/components/card-modal';

export const metadata: Metadata = { title: 'Projet' };

interface ProjectPageProps {
  readonly params: Promise<{ id: string }>;
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

function readParam(value: string | string[] | undefined): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value[0] ?? null;
  return null;
}

export default async function ProjectPage({ params, searchParams }: ProjectPageProps) {
  const ctx = await requireUser();
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const openCardId = readParam(sp['card']);

  const [csrf, workspace, project] = await Promise.all([
    getCsrfTokenForForm(),
    prisma.workspace.findUniqueOrThrow({
      where: { id: ctx.workspaceId },
      select: { name: true },
    }),
    prisma.project.findFirst({
      where: { id, workspaceId: ctx.workspaceId, deletedAt: null },
      select: {
        id: true,
        name: true,
        description: true,
        client: { select: { id: true, name: true, colorToken: true } },
        type: { select: { name: true, icon: true } },
        columns: {
          orderBy: { position: 'asc' },
          select: { id: true, name: true, isBlockedSystem: true },
        },
        cards: {
          where: { deletedAt: null },
          orderBy: { position: 'asc' },
          select: {
            id: true,
            columnId: true,
            shortRef: true,
            title: true,
            categoryTag: true,
          },
        },
      },
    }),
  ]);
  if (!project) notFound();

  // Optionally load the open card detail.
  const openCard = openCardId
    ? await prisma.card.findFirst({
        where: {
          id: openCardId,
          projectId: project.id,
          workspaceId: ctx.workspaceId,
          deletedAt: null,
        },
        select: {
          id: true,
          title: true,
          description: true,
          dueDate: true,
          shortRef: true,
          categoryTag: true,
          column: { select: { name: true, isBlockedSystem: true } },
          checklistItems: {
            orderBy: { position: 'asc' },
            select: { id: true, title: true, isChecked: true, position: true },
          },
        },
      })
    : null;

  const cardCount = project.cards.length;

  return (
    <div className="mx-auto max-w-[1400px]">
      <nav className="mb-3 text-xs text-[color:var(--color-text-muted)]">
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
          <span>
            ·{' '}
            {cardCount === 0 ? 'aucune carte' : cardCount === 1 ? '1 carte' : `${cardCount} cartes`}
          </span>
        </div>
        <h1 className="text-[32px] font-extrabold tracking-tight">{project.name}</h1>
        {project.description ? (
          <p className="mt-1 max-w-3xl text-sm text-[color:var(--color-text-muted)]">
            {project.description}
          </p>
        ) : null}
      </header>

      <KanbanBoard
        csrfToken={csrf}
        projectId={project.id}
        columns={project.columns}
        cards={project.cards}
      />

      {openCard ? (
        <CardModal
          csrfToken={csrf}
          workspaceName={workspace.name}
          projectName={project.name}
          card={{
            id: openCard.id,
            title: openCard.title,
            description: openCard.description,
            dueDate: openCard.dueDate ? openCard.dueDate.toISOString() : null,
            shortRef: openCard.shortRef,
            columnName: openCard.column.name,
            columnIsBlocked: openCard.column.isBlockedSystem,
            categoryTag: openCard.categoryTag,
            checklist: openCard.checklistItems,
          }}
        />
      ) : null}
    </div>
  );
}
