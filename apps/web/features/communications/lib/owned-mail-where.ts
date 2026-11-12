import type { AuthContext } from '@/lib/auth';

/**
 * Scope d'accès aux mails : un `EmailMessage` n'est visible / modifiable QUE
 * par le propriétaire de la boîte connectée (`integration.ownerUserId`) —
 * Graph et IMAP sont délégués par utilisateur (PRD §9 hypothèse 8). Être
 * membre du même workspace ne suffit JAMAIS (CLAUDE.md §4.4).
 *
 * Toute requête Prisma sur `emailMessage` exposée à un utilisateur doit
 * partir de ce helper. Doublé en base par la policy RLS `em_owner_all`
 * (migration 20261110120000_email_messages_owner_rls).
 *
 * Régression 2026-11-10 : la liste Communications, `search_mails` et le KPI
 * « mails non lus » filtraient seulement par workspace — chaque membre voyait
 * les mails (corps compris) de toute l'équipe.
 */
export function ownedMailWhere(ctx: Pick<AuthContext, 'userId' | 'workspaceId'>): {
  workspaceId: string;
  integration: { workspaceId: string; ownerUserId: string };
} {
  return {
    workspaceId: ctx.workspaceId,
    integration: { workspaceId: ctx.workspaceId, ownerUserId: ctx.userId },
  };
}

/**
 * `where` de la liste Communications : mails vivants (non supprimés, non
 * archivés) des boîtes de l'appelant, composés avec les filtres optionnels
 * client (`?client=`) et boîte (`?mailbox=`). Les filtres ne peuvent que
 * RESTREINDRE — le scope propriétaire reste toujours présent.
 */
export function buildMailListWhere(
  ctx: Pick<AuthContext, 'userId' | 'workspaceId'>,
  filters: { readonly clientId: string | null; readonly mailboxId: string | null },
) {
  return {
    ...ownedMailWhere(ctx),
    deletedAt: null,
    archivedAt: null,
    ...(filters.clientId ? { clientId: filters.clientId } : {}),
    ...(filters.mailboxId ? { integrationId: filters.mailboxId } : {}),
  };
}
