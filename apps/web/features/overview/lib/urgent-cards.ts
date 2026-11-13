/**
 * Bloc « Tâches urgentes » de l'Overview : cartes ouvertes (hors dernière
 * colonne utilisateur) qui sont en Bloqué ou dues d'ici demain soir, dans le
 * périmètre visible par l'utilisateur. `mineOnly` restreint aux cartes qui
 * lui sont assignées (tout rôle RACI).
 *
 * Les compteurs `dueToday` / `blocked` alimentent le titre de la page ; ils
 * ignorent `mineOnly` pour rester stables quand on bascule le filtre.
 */
import 'server-only';
import { prisma } from '@nexushub/db';
import { lastUserColumnIds, startOfTodayInParis, type UserScope } from '@nexushub/domain';
import { scopedProjectWhere } from '@/lib/auth/scope';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface UrgentCard {
  readonly id: string;
  readonly shortRef: number;
  readonly title: string;
  readonly dueDate: Date | null;
  readonly blocked: boolean;
  readonly projectId: string;
  readonly projectName: string;
  readonly clientName: string;
  readonly clientColorToken: string;
}

export interface UrgentCards {
  readonly items: readonly UrgentCard[];
  readonly dueToday: number;
  readonly blocked: number;
}

export interface UrgentCardsOptions {
  readonly workspaceId: string;
  readonly userId: string;
  readonly clientId?: string;
  readonly scope?: UserScope;
  readonly mineOnly?: boolean;
  readonly take?: number;
  readonly now?: Date;
}

export type Urgency =
  | { readonly kind: 'blocked'; readonly daysLate: number }
  | { readonly kind: 'late'; readonly daysLate: number }
  | { readonly kind: 'today' }
  | { readonly kind: 'tomorrow' };

/** Classe une carte urgente par rapport au jour courant (fuseau des échéances). */
export function urgencyOf(
  card: Pick<UrgentCard, 'dueDate' | 'blocked'>,
  now: Date = new Date(),
): Urgency {
  const today = startOfTodayInParis(now).getTime();
  const due = card.dueDate?.getTime() ?? null;
  const daysLate = due !== null && due < today ? Math.ceil((today - due) / DAY_MS) : 0;
  if (card.blocked) return { kind: 'blocked', daysLate };
  if (daysLate > 0) return { kind: 'late', daysLate };
  if (due !== null && due >= today + DAY_MS) return { kind: 'tomorrow' };
  return { kind: 'today' };
}

export async function getUrgentCards({
  workspaceId,
  userId,
  clientId,
  scope,
  mineOnly = false,
  take = 5,
  now = new Date(),
}: UrgentCardsOptions): Promise<UrgentCards> {
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

  const today = startOfTodayInParis(now);
  const tomorrow = new Date(today.getTime() + DAY_MS);
  const afterTomorrow = new Date(today.getTime() + 2 * DAY_MS);

  const openWhere = {
    workspaceId,
    deletedAt: null,
    archivedAt: null,
    project: projectWhere,
    ...(doneIds.length > 0 ? { columnId: { notIn: doneIds } } : {}),
  };
  const blockedWhere = { ...openWhere, column: { isBlockedSystem: true } };

  const [rows, dueToday, blocked] = await prisma.$transaction([
    prisma.card.findMany({
      where: {
        ...openWhere,
        ...(mineOnly ? { assignees: { some: { userId } } } : {}),
        OR: [{ column: { isBlockedSystem: true } }, { dueDate: { lt: afterTomorrow } }],
      },
      orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { shortRef: 'asc' }],
      take,
      select: {
        id: true,
        shortRef: true,
        title: true,
        dueDate: true,
        projectId: true,
        column: { select: { isBlockedSystem: true } },
        project: {
          select: { name: true, client: { select: { name: true, colorToken: true } } },
        },
      },
    }),
    prisma.card.count({
      where: {
        ...openWhere,
        column: { isBlockedSystem: false },
        dueDate: { gte: today, lt: tomorrow },
      },
    }),
    prisma.card.count({ where: blockedWhere }),
  ]);

  return {
    items: rows.map((r) => ({
      id: r.id,
      shortRef: r.shortRef,
      title: r.title,
      dueDate: r.dueDate,
      blocked: r.column.isBlockedSystem,
      projectId: r.projectId,
      projectName: r.project.name,
      clientName: r.project.client.name,
      clientColorToken: r.project.client.colorToken,
    })),
    dueToday,
    blocked,
  };
}
