import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@nexushub/db';
import { requireUser } from '@/lib/auth';
import { getCsrfTokenForForm } from '@/lib/csrf';
import { KanbanBoard } from '@/features/projects/components/kanban-board';
import { CardModal } from '@/features/projects/components/card-modal';
import { listCustomCategories } from '@/features/projects/lib/categories';
import { reconcileBeforeRead } from '@/features/projects/lib/reconcile';
import { CalendarIcon, KanbanIcon } from '@/features/shell/components/icons';

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
  const isNew = readParam(sp['new']) === '1';

  // Reconcile-on-read: align overdue / restored / archived cards before
  // rendering the board so the user always sees up-to-date state without
  // a background cron.
  await reconcileBeforeRead(ctx.workspaceId, { projectIds: [id] });

  // Single Promise.all so the modal data fetch doesn't sequentially block
  // the rest of the page (this used to add a visible delay on open/close).
  const [csrf, workspace, project, openCard, customCategories] = await Promise.all([
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
    openCardId
      ? prisma.card.findFirst({
          where: {
            id: openCardId,
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
      : Promise.resolve(null),
    listCustomCategories(ctx.workspaceId),
  ]);
  if (!project) notFound();

  const cardCount = project.cards.length;

  // Compute the next user column for the auto-advance bandeau message.
  let nextColumnName: string | null = null;
  if (openCard) {
    const userCols = project.columns.filter((c) => !c.isBlockedSystem);
    const idx = userCols.findIndex((c) => c.name === openCard.column.name);
    nextColumnName =
      idx >= 0 && idx < userCols.length - 1 ? (userCols[idx + 1]?.name ?? null) : null;
  }

  return (
    <div className="mx-auto max-w-[1400px]">
      <nav className="mb-3 text-xs text-[color:var(--color-text-muted)]">
        <Link href="/projects" className="underline">
          ← Tous les projets
        </Link>
      </nav>

      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
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
              {cardCount === 0
                ? 'aucune carte'
                : cardCount === 1
                  ? '1 carte'
                  : `${cardCount} cartes`}
            </span>
          </div>
          <h1 className="text-[32px] font-extrabold tracking-tight">{project.name}</h1>
          {project.description ? (
            <p className="mt-1 max-w-3xl text-sm text-[color:var(--color-text-muted)]">
              {project.description}
            </p>
          ) : null}
        </div>
        <div className="view-toggle">
          <Link href="" className="active" aria-current="page">
            <KanbanIcon /> Kanban
          </Link>
          <Link href={`/projects/${project.id}/calendar`}>
            <CalendarIcon /> Calendrier
          </Link>
        </div>
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
          customCategories={customCategories}
          isNew={isNew}
          card={{
            id: openCard.id,
            title: openCard.title,
            description: openCard.description,
            dueDate: openCard.dueDate ? openCard.dueDate.toISOString() : null,
            shortRef: openCard.shortRef,
            columnName: openCard.column.name,
            columnIsBlocked: openCard.column.isBlockedSystem,
            nextColumnName,
            categoryTag: openCard.categoryTag,
            checklist: openCard.checklistItems,
          }}
        />
      ) : null}
    </div>
  );
}
