import 'server-only';
import type { Prisma } from '@nexushub/db';
import { prisma } from '@nexushub/db';
import { type UserScope } from '@nexushub/domain';
import type { AuthContext } from './index';

interface ScopeRow {
  readonly clientId: string | null;
  readonly projectId: string | null;
}

/**
 * Build a UserScope from raw WorkspaceAccess rows. Pure — extracted so
 * tests don't need a Prisma harness.
 */
export function scopeFromRows(rows: readonly ScopeRow[]): UserScope {
  if (rows.length === 0) return { kind: 'workspace' };
  const clientIds: string[] = [];
  const projectIds: string[] = [];
  for (const r of rows) {
    if (r.clientId) clientIds.push(r.clientId);
    if (r.projectId) projectIds.push(r.projectId);
  }
  return { kind: 'restricted', clientIds, projectIds };
}

/**
 * Load the effective scope for the current Membership. Admin and
 * super-admin bypass: always full workspace regardless of any stray rows.
 *
 * Memoised per-request via a WeakMap keyed on the AuthContext object so
 * repeated calls inside a single page render hit Prisma at most once.
 */
const cache = new WeakMap<AuthContext, Promise<UserScope>>();

export async function loadUserScope(ctx: AuthContext): Promise<UserScope> {
  if (ctx.isSuperAdmin || ctx.role === 'admin') return { kind: 'workspace' };
  const cached = cache.get(ctx);
  if (cached) return cached;
  const promise = (async (): Promise<UserScope> => {
    const rows = await prisma.workspaceAccess.findMany({
      where: { workspaceId: ctx.workspaceId, membership: { userId: ctx.userId } },
      select: { clientId: true, projectId: true },
    });
    return scopeFromRows(rows);
  })();
  cache.set(ctx, promise);
  return promise;
}

// ---------- Prisma where-builders ---------------------------------------

export function scopedClientWhere(scope: UserScope): Prisma.ClientWhereInput {
  if (scope.kind === 'workspace') return {};
  const haveClients = scope.clientIds.length > 0;
  const haveProjects = scope.projectIds.length > 0;
  if (haveClients && haveProjects) {
    return {
      OR: [
        { id: { in: [...scope.clientIds] } },
        { projects: { some: { id: { in: [...scope.projectIds] } } } },
      ],
    };
  }
  if (haveClients) return { id: { in: [...scope.clientIds] } };
  if (haveProjects) return { projects: { some: { id: { in: [...scope.projectIds] } } } };
  // Restricted with zero rows = sees nothing.
  return { id: { in: [] } };
}

export function scopedProjectWhere(scope: UserScope): Prisma.ProjectWhereInput {
  if (scope.kind === 'workspace') return {};
  const haveClients = scope.clientIds.length > 0;
  const haveProjects = scope.projectIds.length > 0;
  if (haveClients && haveProjects) {
    return {
      OR: [{ id: { in: [...scope.projectIds] } }, { clientId: { in: [...scope.clientIds] } }],
    };
  }
  if (haveProjects) return { id: { in: [...scope.projectIds] } };
  if (haveClients) return { clientId: { in: [...scope.clientIds] } };
  return { id: { in: [] } };
}

export function scopedCardWhere(scope: UserScope): Prisma.CardWhereInput {
  if (scope.kind === 'workspace') return {};
  const inner = scopedProjectWhere(scope);
  // scopedProjectWhere can return { id: { in: [] } } — preserve by spreading inside
  // the `project` relation predicate.
  return { project: inner };
}
