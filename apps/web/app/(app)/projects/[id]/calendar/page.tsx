import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@nexushub/db';
import { monthGridRange, parseYearMonth } from '@nexushub/domain';
import { requireUser } from '@/lib/auth';
import { CalendarView, type CalendarCardItem } from '@/features/projects/components/calendar-view';
import { CalendarIcon, KanbanIcon } from '@/features/shell/components/icons';

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

  const project = await prisma.project.findFirst({
    where: { id, workspaceId: ctx.workspaceId, deletedAt: null },
    select: {
      id: true,
      name: true,
      client: { select: { name: true, colorToken: true } },
    },
  });
  if (!project) notFound();

  const range = monthGridRange(year, month1);

  const cards = await prisma.card.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      projectId: project.id,
      deletedAt: null,
      dueDate: { gte: range.start, lt: range.endExclusive },
    },
    orderBy: { dueDate: 'asc' },
    select: {
      id: true,
      title: true,
      shortRef: true,
      dueDate: true,
      column: { select: { isBlockedSystem: true } },
    },
  });

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
        <div className="view-toggle">
          <Link href={`/projects/${project.id}`}>
            <KanbanIcon /> Kanban
          </Link>
          <Link href="" className="active" aria-current="page">
            <CalendarIcon /> Calendrier
          </Link>
        </div>
      </header>

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
