/**
 * Compteur « Mes cartes » de l'Overview : cartes assignées à l'utilisateur
 * (tout rôle RACI), non supprimées / archivées, hors dernière colonne
 * utilisateur de leur projet (= pas terminées). Les cartes en Bloqué
 * comptent : elles sont ouvertes et en retard.
 */
import 'server-only';
import { prisma } from '@nexushub/db';
import { lastUserColumnIds, startOfTodayInParis, type UserScope } from '@nexushub/domain';
import { scopedProjectWhere } from '@/lib/auth/scope';

export interface MyCardsMetrics {
  readonly open: number;
  readonly overdue: number;
}

export interface MyCardsMetricsOptions {
  readonly workspaceId: string;
  readonly userId: string;
  readonly clientId?: string;
  readonly scope?: UserScope;
}

export async function getMyCardsMetrics({
  workspaceId,
  userId,
  clientId,
  scope,
}: MyCardsMetricsOptions): Promise<MyCardsMetrics> {
  const projectWhere = {
    workspaceId,
    deletedAt: null,
    archivedAt: null,
    ...(scope ? scopedProjectWhere(scope) : {}),
    ...(clientId ? { clientId } : {}),
  };

  const columns = await prisma.column.findMany({
    where: { project: projectWhere },
    select: { id: true, name: true, projectId: true, position: true, isBlockedSystem: true },
  });
  const doneIds = lastUserColumnIds(columns);

  const openWhere = {
    workspaceId,
    deletedAt: null,
    archivedAt: null,
    assignees: { some: { userId } },
    project: projectWhere,
    ...(doneIds.length > 0 ? { columnId: { notIn: doneIds } } : {}),
  };

  const [open, overdue] = await prisma.$transaction([
    prisma.card.count({ where: openWhere }),
    prisma.card.count({ where: { ...openWhere, dueDate: { lt: startOfTodayInParis() } } }),
  ]);

  return { open, overdue };
}
