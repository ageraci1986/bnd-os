import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@nexushub/db';
import { monthGridRange, parseYearMonth } from '@nexushub/domain';
import { requireUser } from '@/lib/auth';
import { loadUserScope } from '@/lib/auth/scope';
import { CalendarView, type CalendarCardItem } from '@/features/projects/components/calendar-view';
import { reconcileBeforeRead } from '@/features/projects/lib/reconcile';
import { ProjectFiltersBar } from '@/features/projects/components/project-filters-bar';
import { ViewToggle } from '@/features/projects/components/view-toggle';
import { listCustomCategories } from '@/features/projects/lib/categories';
import {
  buildCardFilterClauses,
  parseProjectCardFilter,
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
  const parsed = parseYearMonth(monthParam);
  const now = new Date();
  const year = parsed?.year ?? now.getUTCFullYear();
  const month1 = parsed?.month1 ?? now.getUTCMonth() + 1;

  const filter = parseProjectCardFilter(sp);
  const filterClauses = buildCardFilterClauses(filter);

  const project = await prisma.project.findFirst({
    where: { id, workspaceId: ctx.workspaceId, deletedAt: null },
    select: {
      id: true,
      name: true,
      client: { select: { id: true, name: true, colorToken: true } },
      columns: {
        orderBy: { position: 'asc' },
        select: { id: true, name: true, isBlockedSystem: true },
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

  // Reconcile-on-read (PRD §8.3 + ADR 0001 #2). Idempotent — converges
  // before we fetch the cards so the calendar paints fresh state.
  await reconcileBeforeRead(ctx.workspaceId, { projectIds: [project.id] });

  const range = monthGridRange(year, month1);

  // The calendar always constrains by the visible month. If the user
  // also set a `due` filter (today / overdue / range…), we AND it with
  // the month range so the chips visible on screen are the intersection
  // — never widen beyond the displayed grid.
  const { dueDate: filterDueDate, ...restFilterClauses } = filterClauses;
  const monthDue = { gte: range.start, lt: range.endExclusive };
  const dueWhere = filterDueDate
    ? { AND: [{ dueDate: monthDue }, { dueDate: filterDueDate }] }
    : { dueDate: monthDue };

  const [cards, customCategories, workspaceMembers, availableTemplates] = await Promise.all([
    prisma.card.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        projectId: project.id,
        deletedAt: null,
        ...restFilterClauses,
        ...dueWhere,
      },
      orderBy: { dueDate: 'asc' },
      select: {
        id: true,
        title: true,
        shortRef: true,
        dueDate: true,
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

  const items: CalendarCardItem[] = cards.map((c) => ({
    id: c.id,
    projectId: project.id,
    title: c.title,
    shortRef: c.shortRef,
    isoDate: c.dueDate ? c.dueDate.toISOString().slice(0, 10) : '',
    clientColorToken: project.client.colorToken,
    columnIsBlocked: c.column.isBlockedSystem,
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
        clientSlug={null}
        legend={legend}
      />
    </div>
  );
}
