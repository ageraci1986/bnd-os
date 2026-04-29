/**
 * Authenticated app shell — Phase 3 (Step B.3).
 *
 * Composes the design-system primitives (Sidebar, Topbar, ContextBar)
 * and resolves the global client filter from the URL (PRD §8.1).
 *
 * Server Component: every client / project count comes from a single
 * Prisma transaction so the sidebar stays consistent across navigation.
 */
import Link from 'next/link';
import { prisma } from '@nexushub/db';
import { Roles } from '@nexushub/domain';
import {
  Sidebar,
  SidebarBrand,
  SidebarFooter,
  SidebarSection,
  Topbar,
  SearchBar,
} from '@nexushub/ui';

import { requireUser } from '@/lib/auth';
import {
  getClientFilterFromSearchParams,
  resolveActiveClient,
  clientSlug,
} from '@/lib/client-filter/server';

import { NavLink } from '@/features/shell/components/nav-link';
import { ClientLink, AllClientsLink } from '@/features/shell/components/client-link';
import { UserChip } from '@/features/shell/components/user-chip';
import { ContextBarHost } from '@/features/shell/components/context-bar-host';
import {
  DashboardIcon,
  ProjectsIcon,
  MailIcon,
  ClientsIcon,
  PencilIcon,
  GridIcon,
  TeamIcon,
  PlugIcon,
  GearIcon,
  PlusIcon,
} from '@/features/shell/components/icons';

interface AppLayoutProps {
  readonly children: React.ReactNode;
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AppLayout({ children, searchParams }: AppLayoutProps) {
  const ctx = await requireUser();
  const sp = (await searchParams) ?? {};
  const filter = getClientFilterFromSearchParams(sp);

  const [workspace, profile, clients, projectsCount, activeClient] = await Promise.all([
    prisma.workspace.findUniqueOrThrow({
      where: { id: ctx.workspaceId },
      select: { name: true, slug: true },
    }),
    prisma.user.findUniqueOrThrow({
      where: { id: ctx.userId },
      select: { firstName: true, lastName: true, email: true },
    }),
    prisma.client.findMany({
      where: { workspaceId: ctx.workspaceId, deletedAt: null, archivedAt: null },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        colorToken: true,
        _count: {
          select: { projects: { where: { deletedAt: null, archivedAt: null } } },
        },
      },
    }),
    prisma.project.count({
      where: { workspaceId: ctx.workspaceId, deletedAt: null, archivedAt: null },
    }),
    resolveActiveClient(filter, ctx.workspaceId),
  ]);

  const displayName =
    [profile.firstName, profile.lastName]
      .filter((s): s is string => Boolean(s))
      .join(' ')
      .trim() || profile.email;

  const initials =
    [profile.firstName?.[0], profile.lastName?.[0]]
      .filter((c): c is string => Boolean(c))
      .join('')
      .toUpperCase() || profile.email.slice(0, 2).toUpperCase();

  const isAdmin = ctx.role === Roles.Admin;

  return (
    <div className="grid min-h-screen grid-cols-[260px_1fr]">
      <Sidebar>
        <SidebarBrand mark="N" name="NexusHub" subtitle={workspace.name} />

        <SidebarSection label="Main menu">
          <NavLink href="/overview" icon={<DashboardIcon />} label="Tableau de bord" />
          <NavLink href="/projects" icon={<ProjectsIcon />} label="Projets" count={projectsCount} />
          <NavLink href="/communications" icon={<MailIcon />} label="Communications" />
        </SidebarSection>

        <SidebarSection label="Clients actifs">
          <AllClientsLink count={clients.length} />
          {clients.map((c) => (
            <ClientLink
              key={c.id}
              slug={clientSlug(c.name)}
              name={c.name}
              colorToken={c.colorToken}
              count={c._count.projects}
            />
          ))}
        </SidebarSection>

        <SidebarSection label="Atelier">
          <NavLink href="/clients" icon={<ClientsIcon />} label="Clients" />
          <NavLink href="/templates/email" icon={<PencilIcon />} label="Templates e-mail" />
          <NavLink href="/templates/kanban" icon={<GridIcon />} label="Templates Kanban" />
          {isAdmin ? <NavLink href="/team" icon={<TeamIcon />} label="Équipe" /> : null}
          <NavLink href="/integrations" icon={<PlugIcon />} label="Intégrations" />
          <NavLink href="/settings" icon={<GearIcon />} label="Paramètres" />
        </SidebarSection>

        <SidebarFooter>
          <UserChip
            displayName={displayName}
            email={profile.email}
            initials={initials}
            role={isAdmin ? 'Admin' : 'Membre'}
          />
        </SidebarFooter>
      </Sidebar>

      <div className="flex min-w-0 flex-col overflow-x-hidden">
        <Topbar
          left={<SearchBar disabled />}
          right={
            <Link
              href="/projects"
              className="btn btn-primary btn-sm inline-flex items-center gap-1.5"
              aria-label="Créer un nouveau projet"
            >
              <PlusIcon /> Nouveau projet
            </Link>
          }
        />

        <div className="px-10 pb-10">
          <ContextBarHost
            workspaceName={workspace.name}
            activeClient={
              activeClient ? { name: activeClient.name, colorToken: activeClient.colorToken } : null
            }
            totalClients={clients.length}
          />
          {children}
        </div>
      </div>
    </div>
  );
}
