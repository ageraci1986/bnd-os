import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@nexushub/db';
import { requireUser } from '@/lib/auth';
import { loadUserScope } from '@/lib/auth/scope';
import { getCsrfTokenForForm } from '@/lib/csrf';
import { reconcileBeforeRead } from '@/features/projects/lib/reconcile';
import { listCustomCategories } from '@/features/projects/lib/categories';
import { ListView, type ListViewCard } from '@/features/projects/components/list-view';
import { DeleteProjectButton } from '@/features/projects/components/delete-project-button';
import { ProjectFiltersBar } from '@/features/projects/components/project-filters-bar';
import { ViewToggle } from '@/features/projects/components/view-toggle';
import { CardModalController } from '@/features/projects/components/card-modal-controller';
import {
  buildCardFilterClauses,
  parseProjectCardFilter,
} from '@/features/projects/lib/card-filter';

export const metadata: Metadata = { title: 'Liste · Projet' };

interface ProjectListPageProps {
  readonly params: Promise<{ id: string }>;
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ProjectListPage({ params, searchParams }: ProjectListPageProps) {
  const ctx = await requireUser();
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const filter = parseProjectCardFilter(sp);
  const filterClauses = buildCardFilterClauses(filter);

  await reconcileBeforeRead(ctx.workspaceId, { projectIds: [id] });

  const scope = await loadUserScope(ctx);

  const [csrf, workspace, project, customCategories, workspaceMembers, availableTemplates] =
    await Promise.all([
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
            where: { deletedAt: null, ...filterClauses },
            orderBy: { position: 'asc' },
            select: {
              id: true,
              shortRef: true,
              title: true,
              categoryTag: true,
              dueDate: true,
              columnId: true,
              column: { select: { name: true } },
              template: { select: { name: true } },
              assignees: {
                select: {
                  userId: true,
                  user: { select: { firstName: true, lastName: true, email: true } },
                },
              },
              checklistItems: {
                select: { isChecked: true, columnSourceId: true },
              },
            },
          },
        },
      }),
      listCustomCategories(ctx.workspaceId, scope),
      prisma.membership.findMany({
        where: { workspaceId: ctx.workspaceId },
        select: {
          userId: true,
          user: { select: { firstName: true, lastName: true, email: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.cardTemplate.findMany({
        where: { workspaceId: ctx.workspaceId, deletedAt: null },
        orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
        select: { id: true, name: true },
      }),
    ]);
  if (!project) notFound();

  if (scope.kind === 'restricted') {
    const allowed =
      scope.projectIds.includes(project.id) || scope.clientIds.includes(project.client.id);
    if (!allowed) notFound();
  }

  // Map cards to the ListView shape. Counts are filtered the same way
  // the modal does it (other columns' step items are hidden).
  const listCards: ListViewCard[] = project.cards.map((c) => {
    const visibleChecklist = c.checklistItems.filter(
      (it) => it.columnSourceId === null || it.columnSourceId === c.columnId,
    );
    const checked = visibleChecklist.filter((it) => it.isChecked).length;
    const assignees = c.assignees.map((a) => {
      const displayName =
        [a.user.firstName, a.user.lastName]
          .filter((s): s is string => Boolean(s))
          .join(' ')
          .trim() || a.user.email;
      const initials =
        [a.user.firstName?.[0], a.user.lastName?.[0]]
          .filter((c2): c2 is string => Boolean(c2))
          .join('')
          .toUpperCase() || a.user.email.slice(0, 2).toUpperCase();
      return { userId: a.userId, displayName, initials };
    });
    return {
      id: c.id,
      shortRef: c.shortRef,
      title: c.title,
      columnId: c.columnId,
      columnName: c.column.name,
      categoryTag: c.categoryTag,
      dueDate: c.dueDate ? c.dueDate.toISOString() : null,
      assignees,
      checklistTotal: visibleChecklist.length,
      checklistChecked: checked,
      templateName: c.template?.name ?? null,
    } satisfies ListViewCard;
  });

  // User-facing columns first, then system "Bloqué" — the list groups
  // by column id so we keep the full meta (id + name + isBlockedSystem)
  // for the advance-checkbox to know where the dead ends are.
  const orderedColumns = [
    ...project.columns.filter((c) => !c.isBlockedSystem),
    ...project.columns.filter((c) => c.isBlockedSystem),
  ].map((c) => ({ id: c.id, name: c.name, isBlockedSystem: c.isBlockedSystem }));

  const memberOptions = workspaceMembers.map((m) => {
    const displayName =
      [m.user.firstName, m.user.lastName].filter(Boolean).join(' ').trim() || m.user.email;
    const initials =
      [m.user.firstName?.[0], m.user.lastName?.[0]].filter(Boolean).join('').toUpperCase() ||
      m.user.email.slice(0, 2).toUpperCase();
    return { userId: m.userId, displayName, initials };
  });
  const filterColumns = orderedColumns.map((c) => ({ id: c.id, name: c.name }));

  return (
    <div className="mx-auto max-w-[1400px]">
      <nav className="mb-4">
        <Link href="/projects" className="btn btn-ghost btn-sm">
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
              {project.cards.length === 0
                ? 'aucune carte'
                : project.cards.length === 1
                  ? '1 carte'
                  : `${project.cards.length} cartes`}
            </span>
          </div>
          <h1 className="text-[32px] font-extrabold tracking-tight">{project.name}</h1>
          {project.description ? (
            <p className="mt-1 max-w-3xl text-sm text-[color:var(--color-text-muted)]">
              {project.description}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          <ViewToggle projectId={project.id} />
          <DeleteProjectButton projectId={project.id} projectName={project.name} />
        </div>
      </header>

      <ProjectFiltersBar
        columns={filterColumns}
        customCategories={customCategories}
        members={memberOptions}
        templates={availableTemplates}
      />

      <ListView
        projectId={project.id}
        csrfToken={csrf}
        cards={listCards}
        columns={orderedColumns}
      />

      <CardModalController
        csrfToken={csrf}
        workspaceName={workspace.name}
        projectName={project.name}
        customCategories={customCategories}
        availableTemplates={availableTemplates}
        initialIsNew={false}
        initialCard={null}
        workspaceMembers={workspaceMembers.map((m) => {
          const name =
            [m.user.firstName, m.user.lastName].filter(Boolean).join(' ').trim() || m.user.email;
          const initials =
            [m.user.firstName?.[0], m.user.lastName?.[0]].filter(Boolean).join('').toUpperCase() ||
            m.user.email.slice(0, 2).toUpperCase();
          return {
            userId: m.userId,
            displayName: name,
            initials,
            email: m.user.email,
          };
        })}
      />
    </div>
  );
}
