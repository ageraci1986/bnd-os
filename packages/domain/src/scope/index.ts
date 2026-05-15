/**
 * User-scope evaluation (PRD Phase B). Pure domain — no Prisma, no I/O.
 *
 * A Membership is "full workspace" by default (no `WorkspaceAccess` rows).
 * Adding rows narrows the scope to specific clients or projects.
 *
 * The Prisma where-builders that consume this module live in
 * `apps/web/lib/auth/scope.ts` — they call `loadUserScope` to fetch the
 * rows for a request, then translate the resulting `UserScope` into a
 * Prisma WhereInput partial.
 */

export type UserScope =
  | { readonly kind: 'workspace' }
  | {
      readonly kind: 'restricted';
      readonly clientIds: readonly string[];
      readonly projectIds: readonly string[];
    };

export type Resource =
  | { readonly kind: 'client'; readonly clientId: string }
  | { readonly kind: 'project'; readonly projectId: string; readonly clientId: string };

export function evaluateScopeMatch(scope: UserScope, resource: Resource): boolean {
  if (scope.kind === 'workspace') return true;
  if (resource.kind === 'client') return scope.clientIds.includes(resource.clientId);
  // project: matches if its own id is shared OR its parent client is shared.
  return (
    scope.projectIds.includes(resource.projectId) || scope.clientIds.includes(resource.clientId)
  );
}

export function isScopeRestricted(
  scope: UserScope,
): scope is Extract<UserScope, { kind: 'restricted' }> {
  return scope.kind === 'restricted';
}
