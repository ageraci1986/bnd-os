/**
 * Auth helpers (CLAUDE.md §4.4).
 *
 * `getUser()` — anonymous-friendly: returns `null` when not signed in.
 * `requireUser()` — throws `RedirectToLogin` for unauthenticated requests.
 * `requireAdmin()` — throws `Forbidden` if the user is not Admin in the workspace.
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
import { Roles, type Role } from '@nexushub/domain';
import { createSupabaseServer } from '../supabase/server';

export interface AuthContext {
  readonly userId: string;
  readonly email: string;
  readonly workspaceId: string;
  readonly role: Role;
}

/**
 * Returns the verified user + workspace membership context, or `null` when
 * the request is unauthenticated. Suitable for Server Components that render
 * differently based on auth state.
 */
export async function getAuthContext(): Promise<AuthContext | null> {
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;

  // Find the user's first membership. Multi-workspace selection (Phase V1.5)
  // will read from a session-scoped cookie; for V1, every user belongs to
  // exactly one workspace.
  const membership = await prisma.membership.findFirst({
    where: { userId: data.user.id },
    select: { workspaceId: true, role: true },
    orderBy: { createdAt: 'asc' },
  });

  if (!membership) return null;

  return {
    userId: data.user.id,
    email: data.user.email ?? '',
    workspaceId: membership.workspaceId,
    role: membership.role as Role,
  };
}

/**
 * Server Action / page guard. Redirects to /login when not authenticated.
 * Use in `(app)` segment pages and any privileged Server Action.
 */
export async function requireUser(): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) redirect('/login');
  return ctx;
}

/** Stricter guard: also enforces Admin role. */
export async function requireAdmin(): Promise<AuthContext> {
  const ctx = await requireUser();
  if (ctx.role !== Roles.Admin) {
    throw new Response('Forbidden', { status: 403 });
  }
  return ctx;
}
