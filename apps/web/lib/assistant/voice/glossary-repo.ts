import 'server-only';
import { prisma } from '@nexushub/db';
import {
  loadUserScope,
  scopedClientWhere,
  scopedProjectWhere,
  type ScopeAuthContext,
} from '@/lib/auth/scope';

/**
 * Récolte des noms propres du workspace pour le glossaire vocal (spec
 * 2026-11-13 §4.2). Rend les noms BRUTS, par ordre de priorité — le
 * nettoyage (chiffres, bornes) appartient à `toKeyterms` (domain).
 *
 * - Toujours filtré par `workspaceId` ET par le périmètre d'accès de
 *   l'utilisateur : un membre restreint ne reçoit jamais le nom d'un client
 *   qu'il ne peut pas voir (les termes partiront au navigateur au lot 2).
 * - Quotas par table pour qu'aucune catégorie n'affame les autres sous le
 *   plafond de 40 termes : 11 + 12 + 8 + 8 + 1 = 40.
 * - Ne lève JAMAIS : une transcription sans glossaire vaut mieux qu'une
 *   panne. Aucun nom n'est loggé (CLAUDE.md §4.7).
 */

const MEMBERS_TAKE = 11; // utilisateur courant compris
const CLIENTS_TAKE = 12;
const PROJECTS_TAKE = 8;
const CONTACTS_TAKE = 8;

function fullName(firstName: string | null, lastName: string | null): string {
  return [firstName, lastName]
    .filter((part): part is string => part !== null && part.trim() !== '')
    .join(' ');
}

export async function loadProperNouns(ctx: ScopeAuthContext): Promise<string[]> {
  try {
    const scope = await loadUserScope(ctx);
    const visibleClients = {
      AND: [{ workspaceId: ctx.workspaceId, deletedAt: null }, scopedClientWhere(scope)],
    };
    const [members, clients, projects, contacts, workspace] = await Promise.all([
      prisma.membership.findMany({
        where: { workspaceId: ctx.workspaceId },
        select: { userId: true, user: { select: { firstName: true, lastName: true } } },
        orderBy: { createdAt: 'asc' },
        take: MEMBERS_TAKE,
      }),
      prisma.client.findMany({
        where: {
          AND: [
            { workspaceId: ctx.workspaceId, deletedAt: null, archivedAt: null },
            scopedClientWhere(scope),
          ],
        },
        select: { name: true },
        orderBy: { updatedAt: 'desc' },
        take: CLIENTS_TAKE,
      }),
      prisma.project.findMany({
        where: {
          AND: [
            { workspaceId: ctx.workspaceId, deletedAt: null, archivedAt: null },
            scopedProjectWhere(scope),
          ],
        },
        select: { name: true },
        orderBy: { updatedAt: 'desc' },
        take: PROJECTS_TAKE,
      }),
      prisma.contact.findMany({
        where: { workspaceId: ctx.workspaceId, deletedAt: null, client: visibleClients },
        select: { firstName: true, lastName: true },
        orderBy: { updatedAt: 'desc' },
        take: CONTACTS_TAKE,
      }),
      prisma.workspace.findUnique({ where: { id: ctx.workspaceId }, select: { name: true } }),
    ]);

    // L'utilisateur courant d'abord : c'est son propre nom qu'il dicte le plus.
    const self = members.filter((m) => m.userId === ctx.userId);
    const others = members.filter((m) => m.userId !== ctx.userId);

    return [
      ...[...self, ...others].map((m) => fullName(m.user.firstName, m.user.lastName)),
      ...clients.map((c) => c.name),
      ...projects.map((p) => p.name),
      ...contacts.map((c) => fullName(c.firstName, c.lastName)),
      ...(workspace === null ? [] : [workspace.name]),
    ].filter((name) => name !== '');
  } catch {
    return [];
  }
}
