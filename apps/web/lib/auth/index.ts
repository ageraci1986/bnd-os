/**
 * Auth helpers (CLAUDE.md §4.4).
 *
 * `getUser()` — anonymous-friendly: returns `null` when not signed in.
 * `requireUser()` — throws `RedirectToLogin` for unauthenticated requests.
 * `requireAdmin()` — throws `Forbidden` if the user is not Admin in the workspace.
 * `requireSuperAdmin()` — throws `Forbidden` if the user is not a platform super-admin.
 *
 * SECURITY:
 *  - `supabase.auth.getUser()` validates the JWT against Supabase (network call).
 *    Never rely on `getSession()` alone — it only decodes the cookie locally.
 *  - All checks happen server-side. Client components must call these via Server Actions.
 *  - We always join via `Membership.workspace_id`; never trust a workspace_id sent by the client.
 */
import 'server-only';
import { redirect } from 'next/navigation';
import { prisma } from '@nexushub/db';
import { isRole, Roles, type Role } from '@nexushub/domain';
import { createSupabaseServer } from '../supabase/server';

export interface AuthContext {
  readonly userId: string;
  readonly email: string;
  readonly workspaceId: string;
  readonly role: Role;
  readonly isSuperAdmin: boolean;
}

/**
 * Returns the verified user + workspace membership context, or `null` when
 * the request is unauthenticated.
 */
export async function getAuthContext(): Promise<AuthContext | null> {
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;

  // Single query joining users + first membership so we get isSuperAdmin
  // + role in one trip.
  const user = await prisma.user.findUnique({
    where: { id: data.user.id },
    select: {
      isSuperAdmin: true,
      memberships: {
        select: { workspaceId: true, role: true },
        orderBy: { createdAt: 'asc' },
        take: 1,
      },
    },
  });

  if (!user) return null;
  const membership = user.memberships[0];
  if (!membership) return null;

  if (!isRole(membership.role)) {
    // DB has a value we don't recognise (e.g. enum extended without code
    // update). Treat as not-signed-in so we redirect to /login rather than
    // hand back an unsafe context.
    return null;
  }
  return {
    userId: data.user.id,
    email: data.user.email ?? '',
    workspaceId: membership.workspaceId,
    role: membership.role,
    isSuperAdmin: user.isSuperAdmin,
  };
}

/**
 * Server Action / page guard. Redirects to /login when not authenticated.
 */
export async function requireUser(): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) redirect('/login');
  return ctx;
}

/** Stricter guard: also enforces Admin role (or super-admin override). */
export async function requireAdmin(): Promise<AuthContext> {
  const ctx = await requireUser();
  if (ctx.role !== Roles.Admin && !ctx.isSuperAdmin) {
    throw new Response('Forbidden', { status: 403 });
  }
  return ctx;
}

/** Platform-level guard for super-admin-only routes (Phase C entry points). */
export async function requireSuperAdmin(): Promise<AuthContext> {
  const ctx = await requireUser();
  if (!ctx.isSuperAdmin) {
    throw new Response('Forbidden', { status: 403 });
  }
  return ctx;
}
