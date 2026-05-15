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
 *
 * An optional `scope` narrows the workspace-wide path to only the projects
 * and clients the current user is allowed to see (WorkspaceAccess rows).
 * For Admins and full-workspace Members, `scope` returns {} so there is no
 * overhead.
 */
import 'server-only';
import { prisma } from '@nexushub/db';
import { type UserScope } from '@nexushub/domain';
import { scopedClientWhere, scopedProjectWhere, scopedCardWhere } from '@/lib/auth/scope';

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
  /** When set, further restricts to only the resources visible to the user. */
  readonly scope?: UserScope;
}

export async function getOverviewMetrics({
  workspaceId,
  clientId,
  scope,
}: OverviewMetricsOptions): Promise<OverviewMetrics> {
  const scopeProjectWhere = scope ? scopedProjectWhere(scope) : {};
  const scopeClientWhere = scope ? scopedClientWhere(scope) : {};
  const scopeCardWhere = scope ? scopedCardWhere(scope) : {};

  const projectScope = {
    workspaceId,
    deletedAt: null,
    archivedAt: null,
    ...scopeProjectWhere,
    ...(clientId ? { clientId } : {}),
  };

  const blockedCardWhere = {
    workspaceId,
    deletedAt: null,
    column: { isBlockedSystem: true },
    ...scopeCardWhere,
    ...(clientId ? { project: { clientId } } : {}),
  };

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
      where: { workspaceId, deletedAt: null, archivedAt: null, ...scopeClientWhere },
    }),
    prisma.project.count({ where: projectScope }),
    prisma.membership.count({ where: { workspaceId } }),
    prisma.card.count({ where: blockedCardWhere }),
  ]);

  return { clients, projects, members, blockedCards };
}
