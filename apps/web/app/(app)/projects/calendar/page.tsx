import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@nexushub/db';
import { monthGridRange, parseYearMonth } from '@nexushub/domain';
import { requireUser } from '@/lib/auth';
import { loadUserScope, scopedProjectWhere } from '@/lib/auth/scope';
import {
  getClientFilterFromSearchParams,
  resolveActiveClient,
  clientSlug as toClientSlug,
} from '@/lib/client-filter/server';
import { CalendarView, type CalendarCardItem } from '@/features/projects/components/calendar-view';
import { reconcileBeforeRead } from '@/features/projects/lib/reconcile';
import { CalendarIcon, KanbanIcon } from '@/features/shell/components/icons';

export const metadata: Metadata = { title: 'Calendrier · Projets' };

interface CalendarPageProps {
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

function readParam(value: string | string[] | undefined): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value[0] ?? null;
  return null;
}

export default async function CalendarPage({ searchParams }: CalendarPageProps) {
  const ctx = await requireUser();
  const sp = (await searchParams) ?? {};

  const monthParam = readParam(sp['month']);
  const parsed = parseYearMonth(monthParam);
  const now = new Date();
  const year = parsed?.year ?? now.getUTCFullYear();
  const month1 = parsed?.month1 ?? now.getUTCMonth() + 1;

  const filter = getClientFilterFromSearchParams(sp);
  const scope = await loadUserScope(ctx);
  const activeClient = await resolveActiveClient(filter, ctx.workspaceId, scope);

  // Reconcile-on-read (PRD §8.3 + ADR 0001 #2) for the workspace before
  // pulling the visible cards.
  await reconcileBeforeRead(ctx.workspaceId);

  const range = monthGridRange(year, month1);

  const cards = await prisma.card.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      deletedAt: null,
      dueDate: { gte: range.start, lt: range.endExclusive },
      project: {
        deletedAt: null,
        archivedAt: null,
        ...scopedProjectWhere(scope),
        ...(activeClient ? { clientId: activeClient.id } : {}),
      },
    },
    orderBy: { dueDate: 'asc' },
    select: {
      id: true,
      title: true,
      shortRef: true,
      dueDate: true,
      project: {
        select: {
          id: true,
          client: { select: { name: true, colorToken: true } },
        },
      },
      column: { select: { isBlockedSystem: true } },
    },
  });

  const items: CalendarCardItem[] = cards.map((c) => ({
    id: c.id,
    projectId: c.project.id,
    title: c.title,
    shortRef: c.shortRef,
    isoDate: c.dueDate ? c.dueDate.toISOString().slice(0, 10) : '',
    clientColorToken: c.project.client.colorToken,
    columnIsBlocked: c.column.isBlockedSystem,
  }));

  // Dynamic legend: only the clients that actually have cards visible.
  const legendMap = new Map<string, { name: string; colorToken: string }>();
  for (const c of cards) {
    legendMap.set(c.project.client.name, {
      name: c.project.client.name,
      colorToken: c.project.client.colorToken,
    });
  }
  const legend = Array.from(legendMap.values()).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="mx-auto max-w-[1400px]">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[34px] font-extrabold tracking-tight">
            Échéances{' '}
            <span
              className="bg-clip-text text-transparent"
              style={{ backgroundImage: 'var(--accent-gradient)' }}
            >
              {activeClient ? `· ${activeClient.name}` : 'du mois'}
            </span>
          </h1>
          <p className="mt-2 text-sm text-[color:var(--color-text-muted)]">
            {items.length === 0
              ? 'Aucune carte avec une date d’échéance ce mois.'
              : `${items.length} carte${items.length > 1 ? 's' : ''} avec date d’échéance ce mois. Cliquez une tâche pour l’ouvrir.`}
          </p>
        </div>
        <div className="view-toggle">
          <Link
            href={`/projects${activeClient ? `?client=${toClientSlug(activeClient.name)}` : ''}`}
          >
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
        basePath="/projects/calendar"
        clientSlug={activeClient ? toClientSlug(activeClient.name) : null}
        legend={legend}
      />
    </div>
  );
}
