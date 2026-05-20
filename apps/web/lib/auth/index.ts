/**
 * Auth helpers (CLAUDE.md §4.4).
 *
 * `getUser()` — anonymous-friendly: returns `null` when not signed in.
 * `requireUser()` — throws `RedirectToLogin` for unauthenticated requests.
 * `requireAdmin()` — renders the 404 page if the user is not Admin in the workspace
 *   (super-admin always passes).
 * `requireSuperAdmin()` — renders the 404 page if the user is not a platform super-admin.
 * `requireUserVerified()` — like `requireUser` but adds a network `getUser()` call to
 *   reject revoked/banned sessions immediately (used for destructive actions).
 *
 * SECURITY:
 *  - The JWT signature is now verified locally via `verify-jwt.ts` (no per-request
 *    network call for the common authenticated case).
 *  - DB existence is still confirmed via a Prisma `findUnique` call on every request.
 *  - Revocation latency is bounded by the token lifetime (≤1h, per CLAUDE.md §4.3.1).
 *  - Destructive actions use `requireUserVerified` which adds a network `getUser()` call
 *    so a revoked or banned Supabase session is rejected immediately (no ≤1h window).
 *  - All checks happen server-side. Client components must call these via Server Actions.
 *  - We always join via `Membership.workspace_id`; never trust a workspace_id sent by the client.
 */
import 'server-only';
import { cache } from 'react';
import { notFound, redirect } from 'next/navigation';
import { prisma } from '@nexushub/db';
import { isRole, Roles, type Role } from '@nexushub/domain';
import { createSupabaseServer } from '../supabase/server';
import { verifyAccessToken } from './verify-jwt';

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
 *
 * Wrapped in React `cache()` so multiple `requireUser()` calls within a
 * single server render (page + nested server components + helpers) share
 * one execution. Without this, `getAuthContext` would re-hit Supabase
 * Auth (network) and re-query Prisma every time, easily adding 100ms+
 * per duplicate call on auth-gated pages.
 */
export const getAuthContext = cache(async (): Promise<AuthContext | null> => {
  const supabase = await createSupabaseServer();
  // getSession() reads the token from cookies locally (and refreshes only
  // when expired). It does NOT verify the signature — so we verify it
  // ourselves below. This removes the per-request network getUser() call.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) return null;

  const verified = await verifyAccessToken(session.access_token);
  if (!verified) return null;

  const user = await prisma.user.findUnique({
    where: { id: verified.sub },
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
  if (!isRole(membership.role)) return null;

  return {
    userId: verified.sub,
    email: verified.email ?? '',
    workspaceId: membership.workspaceId,
    role: membership.role,
    isSuperAdmin: user.isSuperAdmin,
  };
});

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
    notFound();
  }
  return ctx;
}

/** Platform-level guard for super-admin-only routes (Phase C entry points). */
export async function requireSuperAdmin(): Promise<AuthContext> {
  const ctx = await requireUser();
  if (!ctx.isSuperAdmin) {
    notFound();
  }
  return ctx;
}

/**
 * Stronger guard for DESTRUCTIVE / privilege-changing actions. Adds a
 * network `getUser()` call on top of the local-verified context so a
 * revoked/banned Supabase session is rejected immediately (no ≤1h window).
 */
export async function requireUserVerified(): Promise<AuthContext> {
  const ctx = await requireUser();
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user || data.user.id !== ctx.userId) {
    redirect('/login');
  }
  return ctx;
}
