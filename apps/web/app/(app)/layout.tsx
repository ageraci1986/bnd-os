/**
 * Minimal `(app)` shell — Phase 2.5 (Step C).
 *
 * Provides just enough chrome to test the auth + invitation loop end-to-end:
 *  - Topbar with brand, current workspace, link to /team (Admin only),
 *    and a Sign-out form.
 *  - Server-side `requireUser()` guard. Members without a workspace get
 *    redirected to /login (defense in depth — middleware already gates).
 *
 * The full Sidebar + ContextBar + client filter (PRD §6) lands in Phase 3 (Step B).
 */
import Link from 'next/link';
import { prisma } from '@nexushub/db';
import { Roles } from '@nexushub/domain';
import { requireUser } from '@/lib/auth';
import { signOut } from '@/features/auth/actions/sign-out';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireUser();

  const [workspace, profile] = await Promise.all([
    prisma.workspace.findUniqueOrThrow({
      where: { id: ctx.workspaceId },
      select: { name: true, slug: true },
    }),
    prisma.user.findUniqueOrThrow({
      where: { id: ctx.userId },
      select: { firstName: true, lastName: true, email: true },
    }),
  ]);

  const initials =
    [profile.firstName?.[0], profile.lastName?.[0]]
      .filter((c): c is string => Boolean(c))
      .join('')
      .toUpperCase() || profile.email.slice(0, 2).toUpperCase();

  const displayName =
    [profile.firstName, profile.lastName]
      .filter((s): s is string => Boolean(s))
      .join(' ')
      .trim() || profile.email;

  return (
    <div className="min-h-screen">
      <header
        className="sticky top-0 z-10 flex items-center justify-between border-b border-[color:var(--color-border-soft)] bg-[color:var(--glass-bg)] px-10 py-5 backdrop-blur"
        style={{ backgroundColor: 'var(--color-bg-app)' }}
      >
        <div className="flex items-center gap-4">
          <Link href="/overview" className="flex items-center gap-3" aria-label="Tableau de bord">
            <span
              className="grid h-9 w-9 place-items-center rounded-[10px] font-extrabold text-white shadow-md"
              style={{ background: 'linear-gradient(135deg,#8B2BE2,#FF2A6D)' }}
            >
              N
            </span>
            <span className="flex flex-col leading-tight">
              <span className="text-[15px] font-extrabold tracking-tight">NexusHub</span>
              <span className="text-[10px] font-semibold uppercase tracking-[1.2px] text-[color:var(--color-text-muted)]">
                {workspace.name}
              </span>
            </span>
          </Link>
        </div>

        <nav className="flex items-center gap-2">
          <Link
            href="/overview"
            className="rounded-full px-4 py-2 text-[13px] font-semibold text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-bg-hover)] hover:text-[color:var(--color-text-main)]"
          >
            Overview
          </Link>
          {ctx.role === Roles.Admin ? (
            <Link
              href="/team"
              className="rounded-full px-4 py-2 text-[13px] font-semibold text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-bg-hover)] hover:text-[color:var(--color-text-main)]"
            >
              Équipe
            </Link>
          ) : null}
        </nav>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-right">
            <div className="hidden flex-col text-right leading-tight sm:flex">
              <span className="text-[13px] font-bold">{displayName}</span>
              <span className="text-[10px] font-semibold uppercase tracking-[0.5px] text-[color:var(--color-text-muted)]">
                {ctx.role === Roles.Admin ? 'Admin' : 'Membre'}
              </span>
            </div>
            <span
              className="grid h-9 w-9 place-items-center rounded-full text-xs font-bold text-white"
              style={{ background: 'linear-gradient(135deg,#8B2BE2,#FF2A6D)' }}
              aria-hidden="true"
            >
              {initials}
            </span>
          </div>
          <form action={signOut}>
            <button
              type="submit"
              className="rounded-full border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] px-4 py-2 text-[13px] font-bold shadow-sm transition hover:bg-[color:var(--color-bg-hover)]"
            >
              Déconnexion
            </button>
          </form>
        </div>
      </header>

      <main className="px-10 py-10">{children}</main>
    </div>
  );
}
