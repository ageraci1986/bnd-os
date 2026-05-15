/**
 * Read-side queries for the /clients module.
 *
 * SECURITY: every query is scoped by `workspaceId` (defence in depth even
 * with RLS). Soft-deleted rows are filtered out — pulling them up requires
 * a future "Corbeille" admin route.
 */
import 'server-only';
import { prisma } from '@nexushub/db';
import { type UserScope } from '@nexushub/domain';
import { clientSlug } from '@/lib/client-filter/server';
import { scopedClientWhere } from '@/lib/auth/scope';

export interface ClientListRow {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly colorToken: string;
  readonly initials: string;
  readonly contactsCount: number;
  readonly projectsCount: number;
}

export async function listClients(
  workspaceId: string,
  scope?: UserScope,
): Promise<readonly ClientListRow[]> {
  const rows = await prisma.client.findMany({
    where: {
      workspaceId,
      deletedAt: null,
      archivedAt: null,
      ...(scope ? scopedClientWhere(scope) : {}),
    },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      colorToken: true,
      initials: true,
      _count: {
        select: {
          contacts: { where: { deletedAt: null } },
          projects: { where: { deletedAt: null, archivedAt: null } },
        },
      },
    },
  });

  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    slug: clientSlug(c.name),
    colorToken: c.colorToken,
    initials: c.initials,
    contactsCount: c._count.contacts,
    projectsCount: c._count.projects,
  }));
}

export interface ClientDetail {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly colorToken: string;
  readonly initials: string;
  readonly domains: readonly string[];
  readonly notes: string | null;
  readonly contacts: readonly {
    readonly id: string;
    readonly firstName: string;
    readonly lastName: string;
    readonly jobTitle: string | null;
    readonly email: string | null;
    readonly phone: string | null;
    readonly raci: 'responsible' | 'approver' | 'consulted' | 'informed' | null;
    readonly notes: string | null;
  }[];
  readonly activeProjectsCount: number;
}

/**
 * Resolve a `?selected=<slug>` URL param to the matching client row + its
 * contacts. Returns null when the slug doesn't match anything visible.
 */
export async function getClientBySlug(
  workspaceId: string,
  slug: string,
  scope?: UserScope,
): Promise<ClientDetail | null> {
  const lowered = slug.toLowerCase();

  const candidates = await prisma.client.findMany({
    where: {
      workspaceId,
      deletedAt: null,
      archivedAt: null,
      ...(scope ? scopedClientWhere(scope) : {}),
    },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      colorToken: true,
      initials: true,
      domains: true,
      notes: true,
    },
  });

  const match = candidates.find((c) => clientSlug(c.name) === lowered);
  if (!match) return null;

  const [contacts, activeProjectsCount] = await Promise.all([
    prisma.contact.findMany({
      where: { clientId: match.id, deletedAt: null },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        jobTitle: true,
        email: true,
        phone: true,
        raci: true,
        notes: true,
      },
    }),
    prisma.project.count({
      where: { workspaceId, clientId: match.id, deletedAt: null, archivedAt: null },
    }),
  ]);

  return {
    id: match.id,
    name: match.name,
    slug: clientSlug(match.name),
    colorToken: match.colorToken,
    initials: match.initials,
    domains: match.domains,
    notes: match.notes,
    contacts,
    activeProjectsCount,
  };
}
