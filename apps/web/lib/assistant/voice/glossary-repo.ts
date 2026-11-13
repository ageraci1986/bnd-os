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
 * - Toujours filtré par `workspaceId`. Clients, projets et contacts sont en
 *   plus filtrés par le périmètre d'accès de l'utilisateur : un membre
 *   restreint ne reçoit jamais le nom d'un client qu'il ne peut pas voir (les
 *   termes partiront au navigateur au lot 2). Les noms des membres et du
 *   workspace sont visibles de tout membre, comme dans le reste de l'app.
 * - Quotas par table pour qu'aucune catégorie n'affame les autres sous le
 *   plafond de 40 termes : 1 + 10 + 12 + 8 + 8 + 1 = 40.
 * - Ne lève JAMAIS : une transcription sans glossaire vaut mieux qu'une
 *   panne. Aucun nom n'est loggé (CLAUDE.md §4.7).
 */

const OTHER_MEMBERS_TAKE = 10;
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
    // Clients visibles ET actifs — sert aussi de filtre aux contacts, pour ne
    // jamais récolter le contact d'un client supprimé, archivé ou hors périmètre.
    const activeVisibleClients = {
      AND: [
        { workspaceId: ctx.workspaceId, deletedAt: null, archivedAt: null },
        scopedClientWhere(scope),
      ],
    };
    const memberName = { user: { select: { firstName: true, lastName: true } } } as const;
    const [self, others, clients, projects, contacts, workspace] = await Promise.all([
      // L'utilisateur courant est lu À PART : pris dans un `take` commun, il
      // sortirait de la liste dès que le workspace dépasse le quota.
      prisma.membership.findUnique({
        where: { workspaceId_userId: { workspaceId: ctx.workspaceId, userId: ctx.userId } },
        select: memberName,
      }),
      prisma.membership.findMany({
        where: { workspaceId: ctx.workspaceId, userId: { not: ctx.userId } },
        select: memberName,
        orderBy: { createdAt: 'asc' },
        take: OTHER_MEMBERS_TAKE,
      }),
      prisma.client.findMany({
        where: activeVisibleClients,
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
        where: { workspaceId: ctx.workspaceId, deletedAt: null, client: activeVisibleClients },
        select: { firstName: true, lastName: true },
        orderBy: { updatedAt: 'desc' },
        take: CONTACTS_TAKE,
      }),
      prisma.workspace.findUnique({ where: { id: ctx.workspaceId }, select: { name: true } }),
    ]);

    return [
      // L'utilisateur courant d'abord : c'est son propre nom qu'il dicte le plus.
      ...(self === null ? [] : [fullName(self.user.firstName, self.user.lastName)]),
      ...others.map((m) => fullName(m.user.firstName, m.user.lastName)),
      ...clients.map((c) => c.name),
      ...projects.map((p) => p.name),
      ...contacts.map((c) => fullName(c.firstName, c.lastName)),
      ...(workspace === null ? [] : [workspace.name]),
    ].filter((name) => name !== '');
  } catch (err) {
    // Signal sans PII : le nom de l'erreur seulement, jamais son message
    // (un message Prisma peut citer des valeurs de la requête).
    console.error('[assistant] voice glossary load failed', {
      error: err instanceof Error ? err.name : 'unknown',
    });
    return [];
  }
}
