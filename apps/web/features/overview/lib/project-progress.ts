/**
 * Bloc « Avancement projets » de l'Overview : pour les projets actifs
 * visibles, part des cartes terminées (dernière colonne utilisateur, ou
 * archivées après y être passées) sur le total des cartes non supprimées.
 * Tri par date de fin la plus proche (sans date en dernier).
 */
import 'server-only';
import { prisma } from '@nexushub/db';
import { lastUserColumnIds, type UserScope } from '@nexushub/domain';
import { scopedProjectWhere } from '@/lib/auth/scope';

export interface ProjectProgress {
  readonly id: string;
  readonly name: string;
  readonly clientName: string;
  readonly endDate: Date | null;
  readonly total: number;
  readonly done: number;
  readonly blocked: number;
  /** 0–100, arrondi. 0 quand le projet n'a aucune carte. */
  readonly percent: number;
}

export interface ProjectProgressOptions {
  readonly workspaceId: string;
  readonly clientId?: string;
  readonly scope?: UserScope;
  readonly take?: number;
}

export async function getProjectProgress({
  workspaceId,
  clientId,
  scope,
  take = 5,
}: ProjectProgressOptions): Promise<readonly ProjectProgress[]> {
  const projects = await prisma.project.findMany({
    where: {
      workspaceId,
      deletedAt: null,
      archivedAt: null,
      ...(scope ? scopedProjectWhere(scope) : {}),
      ...(clientId ? { clientId } : {}),
    },
    orderBy: [{ endDate: { sort: 'asc', nulls: 'last' } }, { name: 'asc' }],
    take,
    select: { id: true, name: true, endDate: true, client: { select: { name: true } } },
  });
  if (projects.length === 0) return [];

  const projectIds = projects.map((p) => p.id);
  const cardWhere = { workspaceId, deletedAt: null, projectId: { in: projectIds } };

  const columns = await prisma.column.findMany({
    where: { projectId: { in: projectIds } },
    select: { id: true, name: true, projectId: true, position: true, isBlockedSystem: true },
  });
  const [active, archived] = await Promise.all([
    prisma.card.groupBy({
      by: ['columnId'],
      where: { ...cardWhere, archivedAt: null },
      _count: { _all: true },
    }),
    prisma.card.groupBy({
      by: ['projectId'],
      where: { ...cardWhere, archivedAt: { not: null } },
      _count: { _all: true },
    }),
  ]);

  const doneIds = new Set(lastUserColumnIds(columns));
  const columnById = new Map(columns.map((c) => [c.id, c]));
  const tally = new Map(projectIds.map((id) => [id, { total: 0, done: 0, blocked: 0 }]));

  for (const g of active) {
    const column = columnById.get(g.columnId);
    const t = column ? tally.get(column.projectId) : undefined;
    if (!column || !t) continue;
    t.total += g._count._all;
    if (doneIds.has(column.id)) t.done += g._count._all;
    if (column.isBlockedSystem) t.blocked += g._count._all;
  }
  // Une carte archivée l'a été après son passage en dernière colonne : terminée.
  for (const g of archived) {
    const t = tally.get(g.projectId);
    if (!t) continue;
    t.total += g._count._all;
    t.done += g._count._all;
  }

  return projects.map((p) => {
    const t = tally.get(p.id) ?? { total: 0, done: 0, blocked: 0 };
    return {
      id: p.id,
      name: p.name,
      clientName: p.client.name,
      endDate: p.endDate,
      ...t,
      percent: t.total > 0 ? Math.round((t.done / t.total) * 100) : 0,
    };
  });
}
