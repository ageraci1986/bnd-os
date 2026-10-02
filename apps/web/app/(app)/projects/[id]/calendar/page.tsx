import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { prisma } from '@nexushub/db';
import {
  clientColorCss,
  lastUserColumnIds,
  monthGridRange,
  parseYearMonth,
} from '@nexushub/domain';
import { requireUser } from '@/lib/auth';
import { buildHrefWithClient, isOutsideClientFilter } from '@/features/shell/lib/client-filter-url';
import { loadUserScope } from '@/lib/auth/scope';
import { CalendarView, type CalendarCardItem } from '@/features/projects/components/calendar-view';
import { reconcileBeforeRead } from '@/features/projects/lib/reconcile';
import { ProjectFiltersBar } from '@/features/projects/components/project-filters-bar';
import { ViewToggle } from '@/features/projects/components/view-toggle';
import { listCustomCategories } from '@/features/projects/lib/categories';
import {
  buildCardFilterClauses,
  parseProjectCardFilter,
  writeProjectCardFilter,
} from '@/features/projects/lib/card-filter';

export const metadata: Metadata = { title: 'Calendrier · Projet' };

interface ProjectCalendarPageProps {
  readonly params: Promise<{ id: string }>;
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

function readParam(value: string | string[] | undefined): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value[0] ?? null;
  return null;
}

export default async function ProjectCalendarPage({
  params,
  searchParams,
}: ProjectCalendarPageProps) {
  const ctx = await requireUser();
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const monthParam = readParam(sp['month']);
  // Global client filter (PRD §8.1) — kept on month nav and the way back.
  const clientSlug = readParam(sp['client']);
  const parsed = parseYearMonth(monthParam);
  const now = new Date();
  const year = parsed?.year ?? now.getUTCFullYear();
  const month1 = parsed?.month1 ?? now.getUTCMonth() + 1;

  const filter = parseProjectCardFilter(sp);
  const filterClauses = buildCardFilterClauses(filter, ctx.userId);

  const project = await prisma.project.findFirst({
    where: { id, workspaceId: ctx.workspaceId, deletedAt: null },
    select: {
      id: true,
      name: true,
      client: { select: { id: true, name: true, colorToken: true } },
      columns: {
        orderBy: { position: 'asc' },
        select: { id: true, name: true, position: true, isBlockedSystem: true },
      },
    },
  });
  if (!project) notFound();

  const scope = await loadUserScope(ctx);
  if (scope.kind === 'restricted') {
    const allowed =
      scope.projectIds.includes(project.id) || scope.clientIds.includes(project.client.id);
    if (!allowed) notFound();
  }

  // Active client filter excludes this project (e.g. another client picked
  // in the sidebar while inside it) → show that client's projects instead.
  if (isOutsideClientFilter(clientSlug, project.client)) {
    redirect(buildHrefWithClient('/projects', '', clientSlug));
  }

  // Reconcile-on-read (PRD §8.3 + ADR 0001 #2). Idempotent — converges
  // before we fetch the cards so the calendar paints fresh state.
  await reconcileBeforeRead(ctx.workspaceId, { projectIds: [project.id] });

  const range = monthGridRange(year, month1);

  // Mois visible ∩ éventuel filtre `due` ∩ éventuel AND du filtre (asg + mine) :
  // tout passe dans un seul AND pour qu'aucune clé n'en écrase une autre.
  const { dueDate: filterDueDate, AND: filterAnd, ...restFilterClauses } = filterClauses;
  const monthDue = { gte: range.start, lt: range.endExclusive };
  const andClauses = [
    ...(Array.isArray(filterAnd) ? filterAnd : filterAnd ? [filterAnd] : []),
    { dueDate: monthDue },
    ...(filterDueDate ? [{ dueDate: filterDueDate }] : []),
  ];

  const [cards, customCategories, workspaceMembers, availableTemplates] = await Promise.all([
    prisma.card.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        projectId: project.id,
        deletedAt: null,
        ...restFilterClauses,
        AND: andClauses,
      },
      orderBy: { dueDate: 'asc' },
      select: {
        id: true,
        title: true,
        shortRef: true,
        dueDate: true,
        columnId: true,
        column: { select: { isBlockedSystem: true } },
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

  const doneColumnIds = new Set(
    lastUserColumnIds(project.columns.map((c) => ({ ...c, projectId: project.id }))),
  );

  const items: CalendarCardItem[] = cards.map((c) => ({
    id: c.id,
    projectId: project.id,
    title: c.title,
    shortRef: c.shortRef,
    isoDate: c.dueDate ? c.dueDate.toISOString().slice(0, 10) : '',
    clientColorToken: project.client.colorToken,
    columnIsBlocked: c.column.isBlockedSystem,
    isDone: doneColumnIds.has(c.columnId),
  }));

  // Project-scoped: legend only contains the project's client.
  const legend = [{ name: project.client.name, colorToken: project.client.colorToken }];

  const memberOptions = workspaceMembers.map((m) => {
    const displayName =
      [m.user.firstName, m.user.lastName].filter(Boolean).join(' ').trim() || m.user.email;
    const initials =
      [m.user.firstName?.[0], m.user.lastName?.[0]].filter(Boolean).join('').toUpperCase() ||
      m.user.email.slice(0, 2).toUpperCase();
    return { userId: m.userId, displayName, initials };
  });
  const filterColumns = project.columns.map((c) => ({ id: c.id, name: c.name }));

  return (
    <div className="mx-auto max-w-[1400px]">
      <nav className="mb-3 text-xs text-[color:var(--color-text-muted)]">
        <Link href={buildHrefWithClient('/projects', '', clientSlug)} className="underline">
          ← Tous les projets
        </Link>
      </nav>

      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs text-[color:var(--color-text-muted)]">
            <span
              aria-hidden="true"
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: clientColorCss(project.client.colorToken) }}
            />
            {project.client.name}
          </div>
          <h1 className="text-[32px] font-extrabold tracking-tight">
            {project.name}{' '}
            <span
              className="bg-clip-text text-transparent"
              style={{ backgroundImage: 'var(--accent-gradient)' }}
            >
              · calendrier
            </span>
          </h1>
        </div>
        <ViewToggle projectId={project.id} />
      </header>

      <ProjectFiltersBar
        columns={filterColumns}
        customCategories={customCategories}
        members={memberOptions}
        templates={availableTemplates}
      />

      <CalendarView
        year={year}
        month1={month1}
        cards={items}
        basePath={`/projects/${project.id}/calendar`}
        clientSlug={clientSlug}
        legend={legend}
        extraParams={Object.fromEntries(writeProjectCardFilter(new URLSearchParams(), filter))}
      />
    </div>
  );
}
