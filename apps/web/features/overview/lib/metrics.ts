/**
 * Aggregates the four headline counters shown on /overview.
 *
 * The "active client" filter is plumbed in via an optional `clientId`:
 *  - omitted → workspace-wide counts (default)
 *  - set    → counts scoped to that client only (projects → its projects,
 *             members → people on those projects, blocked cards → cards
 *             living in the blocked column of those projects)
 *
 * Soft-deleted (`deletedAt`) and archived (`archivedAt`) rows are excluded
 * everywhere so the metrics line up with what the sidebar actually shows.
 */
import 'server-only';
import { prisma } from '@nexushub/db';

export interface OverviewMetrics {
  readonly clients: number;
  readonly projects: number;
  readonly members: number;
  readonly blockedCards: number;
}

export interface OverviewMetricsOptions {
  readonly workspaceId: string;
  /** When set, all counters are scoped to that client. */
  readonly clientId?: string;
}

export async function getOverviewMetrics({
  workspaceId,
  clientId,
}: OverviewMetricsOptions): Promise<OverviewMetrics> {
  const projectScope = {
    workspaceId,
    deletedAt: null,
    archivedAt: null,
    ...(clientId ? { clientId } : {}),
  } as const;

  const blockedCardWhere = {
    workspaceId,
    deletedAt: null,
    column: { isBlockedSystem: true },
    ...(clientId ? { project: { clientId } } : {}),
  } as const;

  if (clientId) {
    // Scoped: members = distinct users on this client's projects.
    const [projects, blockedCards, projectMembers] = await prisma.$transaction([
      prisma.project.count({ where: projectScope }),
      prisma.card.count({ where: blockedCardWhere }),
      prisma.projectMember.findMany({
        where: { project: projectScope },
        select: { userId: true },
        distinct: ['userId'],
      }),
    ]);

    return {
      clients: 1,
      projects,
      members: projectMembers.length,
      blockedCards,
    };
  }

  const [clients, projects, members, blockedCards] = await prisma.$transaction([
    prisma.client.count({
      where: { workspaceId, deletedAt: null, archivedAt: null },
    }),
    prisma.project.count({ where: projectScope }),
    prisma.membership.count({ where: { workspaceId } }),
    prisma.card.count({ where: blockedCardWhere }),
  ]);

  return { clients, projects, members, blockedCards };
}
