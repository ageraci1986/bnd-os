import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@nexushub/db';
import { Roles, validateCardTemplateItems } from '@nexushub/domain';
import { requireUser } from '@/lib/auth';
import { loadUserScope, scopedProjectWhere } from '@/lib/auth/scope';
import { getCsrfTokenForForm } from '@/lib/csrf';
import { KanbanBoard } from '@/features/projects/components/kanban-board';
import { CardModalController } from '@/features/projects/components/card-modal-controller';
import type { CardModalData } from '@/features/projects/actions/get-card-modal-data';
import { DeleteProjectButton } from '@/features/projects/components/delete-project-button';
import { ProjectFiltersBar } from '@/features/projects/components/project-filters-bar';
import { ShareProjectButton } from '@/features/projects/components/share-project-button';
import { ViewToggle } from '@/features/projects/components/view-toggle';
import {
  buildCardFilterClauses,
  parseProjectCardFilter,
} from '@/features/projects/lib/card-filter';
import { listCustomCategories } from '@/features/projects/lib/categories';
import { reconcileBeforeRead } from '@/features/projects/lib/reconcile';
import { loadCardComments } from '@/features/projects/lib/load-card-comments';

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
  const __pt0 = performance.now(); // TEMP-PERF
  const ctx = await requireUser();
  const __ptAuth = performance.now(); // TEMP-PERF
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const openCardId = readParam(sp['card']);
  const isNew = readParam(sp['new']) === '1';
  const filter = parseProjectCardFilter(sp);
  const filterClauses = buildCardFilterClauses(filter);

  // Load scope eagerly so the parallel openCard fetch can scope-gate its
  // own query (?card=<id> must not leak data from an out-of-scope card
  // even if it happens to live in this same workspace).
  const scope = await loadUserScope(ctx);

  // Reconcile-on-read: align overdue / restored / archived cards before
  // rendering the board so the user always sees up-to-date state without
  // a background cron.
  await reconcileBeforeRead(ctx.workspaceId, { projectIds: [id] });
  const __ptReconcile = performance.now(); // TEMP-PERF

  // Single Promise.all so the modal data fetch doesn't sequentially block
  // the rest of the page (this used to add a visible delay on open/close).
  const [
    csrf,
    workspace,
    project,
    openCard,
    customCategories,
    workspaceMembers,
    availableTemplates,
    viewers,
  ] = await Promise.all([
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
            columnId: true,
            shortRef: true,
            title: true,
            categoryTag: true,
            _count: { select: { comments: { where: { deletedAt: null } } } },
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
            // Forbid `?card=<id>` from leaking a card whose project is
            // outside the current scope, even if it lives in the same
            // workspace.
            project: scopedProjectWhere(scope),
          },
          select: {
            id: true,
            columnId: true,
            title: true,
            description: true,
            dueDate: true,
            shortRef: true,
            categoryTag: true,
            fieldValues: true,
            column: { select: { name: true, isBlockedSystem: true } },
            checklistItems: {
              orderBy: { position: 'asc' },
              select: {
                id: true,
                title: true,
                isChecked: true,
                position: true,
                columnSourceId: true,
              },
            },
            assignees: {
              select: {
                userId: true,
                raci: true,
                user: { select: { firstName: true, lastName: true, email: true } },
              },
            },
            templateId: true,
            template: { select: { items: true } },
          },
        })
      : Promise.resolve(null),
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
    prisma.membership.findMany({
      where: { workspaceId: ctx.workspaceId, role: 'viewer' },
      select: {
        id: true,
        user: { select: { firstName: true, lastName: true, email: true } },
        workspaceAccess: {
          where: { projectId: id },
          select: { id: true },
        },
      },
    }),
  ]);
  // TEMP-PERF: breakdown of the project page server render.
  console.warn(
    `[perf] ProjectPage auth=${Math.round(__ptAuth - __pt0)} scope+reconcile=${Math.round(
      __ptReconcile - __ptAuth,
    )} queries=${Math.round(performance.now() - __ptReconcile)} total=${Math.round(
      performance.now() - __pt0,
    )}ms openCard=${openCardId ? 'yes' : 'no'}`,
  );
  if (!project) notFound();

  if (scope.kind === 'restricted') {
    const allowed =
      scope.projectIds.includes(project.id) || scope.clientIds.includes(project.client.id);
    if (!allowed) notFound();
  }

  const initialCardComments = openCard
    ? await loadCardComments({
        cardId: openCard.id,
        currentUserId: ctx.userId,
        currentRole: ctx.role,
      })
    : [];

  const viewerOptions = viewers.map((v) => {
    const displayName =
      [v.user.firstName, v.user.lastName].filter(Boolean).join(' ').trim() || v.user.email;
    return {
      membershipId: v.id,
      displayName,
      email: v.user.email,
      hasAccess: v.workspaceAccess.length > 0,
    };
  });

  const canShare =
    ctx.isSuperAdmin ||
    ctx.role === 'admin' ||
    (ctx.role === 'user' &&
      (scope.kind === 'workspace' ||
        scope.projectIds.includes(project.id) ||
        scope.clientIds.includes(project.client.id)));

  const canDelete = canShare;

  // Viewer = strict read-only. Orthogonal to canShare/canDelete (scope-based).
  const isViewer = ctx.role === Roles.Viewer;

  const cardCount = project.cards.length;

  const memberOptions = workspaceMembers.map((m) => {
    const displayName =
      [m.user.firstName, m.user.lastName].filter(Boolean).join(' ').trim() || m.user.email;
    const initials =
      [m.user.firstName?.[0], m.user.lastName?.[0]].filter(Boolean).join('').toUpperCase() ||
      m.user.email.slice(0, 2).toUpperCase();
    return { userId: m.userId, displayName, initials };
  });
  const filterColumns = project.columns.map((c) => ({ id: c.id, name: c.name }));

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
        <div className="flex items-center gap-3">
          <ViewToggle projectId={project.id} />
          {canShare ? (
            <ShareProjectButton
              projectId={project.id}
              projectName={project.name}
              csrfToken={csrf}
              viewers={viewerOptions}
            />
          ) : null}
          {canDelete ? (
            <DeleteProjectButton projectId={project.id} projectName={project.name} />
          ) : null}
        </div>
      </header>

      <ProjectFiltersBar
        columns={filterColumns}
        customCategories={customCategories}
        members={memberOptions}
        templates={availableTemplates}
      />

      <KanbanBoard
        csrfToken={csrf}
        projectId={project.id}
        columns={project.columns}
        cards={project.cards.map((c) => ({
          id: c.id,
          columnId: c.columnId,
          shortRef: c.shortRef,
          title: c.title,
          categoryTag: c.categoryTag,
          commentCount: c._count.comments,
        }))}
        isReadOnly={isViewer}
      />

      <CardModalController
        csrfToken={csrf}
        workspaceName={workspace.name}
        projectName={project.name}
        customCategories={customCategories}
        availableTemplates={availableTemplates}
        initialIsNew={isNew}
        isReadOnly={isViewer}
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
        initialCard={
          openCard
            ? ({
                id: openCard.id,
                title: openCard.title,
                description: openCard.description,
                dueDate: openCard.dueDate ? openCard.dueDate.toISOString() : null,
                shortRef: openCard.shortRef,
                columnId: openCard.columnId,
                columnName: openCard.column.name,
                columnIsBlocked: openCard.column.isBlockedSystem,
                nextColumnName,
                categoryTag: openCard.categoryTag,
                templateId: openCard.templateId,
                templateItems: validateCardTemplateItems(openCard.template?.items ?? []) ?? [],
                fieldValues: (() => {
                  const raw = openCard.fieldValues;
                  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
                  const out: Record<string, string> = {};
                  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
                    if (typeof v === 'string') out[k] = v;
                  }
                  return out;
                })(),
                checklist: openCard.checklistItems,
                assignees: openCard.assignees.map((a) => {
                  const name =
                    [a.user.firstName, a.user.lastName].filter(Boolean).join(' ').trim() ||
                    a.user.email;
                  const initials =
                    [a.user.firstName?.[0], a.user.lastName?.[0]]
                      .filter(Boolean)
                      .join('')
                      .toUpperCase() || a.user.email.slice(0, 2).toUpperCase();
                  return {
                    userId: a.userId,
                    displayName: name,
                    initials,
                    raci: a.raci,
                  };
                }),
                comments: initialCardComments,
              } satisfies CardModalData)
            : null
        }
      />
    </div>
  );
}
