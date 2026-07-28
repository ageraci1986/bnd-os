import 'server-only';
import { prisma } from '@nexushub/db';
import { createAgentNotice, type AgentNoticeInput } from './notice-core';

/**
 * Notices « carte passée en Bloqué » (Plan 3b Task 5, revue groupée 4-6 fix 1)
 * — helper PARTAGÉ entre les DEUX chemins de blocage :
 *
 * 1. le cron horaire Inngest (`lib/inngest/functions/blocked-cards-scan.ts`,
 *    CLAUDE.md §6.3) ;
 * 2. le reconcile-on-read (`features/projects/lib/reconcile.ts`,
 *    `reconcileBeforeRead`) — dans un workspace ACTIF, c'est presque toujours
 *    LUI qui bloque les cartes en premier (les routes reconcilient à chaque
 *    chargement, le cron ne passe qu'une fois par heure) : sans notices sur ce
 *    chemin, `newlyBlocked` du cron serait quasi toujours vide et aucune
 *    notice ne partirait jamais.
 *
 * La déduplication entre les deux chemins est assurée par `createAgentNotice`
 * (une notice NON LUE par (userId, kind, ref=cardId) — voir `notice-core.ts`) :
 * si le read-path a déjà notifié une carte, le cron no-ope, et inversement.
 *
 * NOTE — `BlockedCardRef` est structurellement identique à `NewlyBlockedCard`
 * de `reconcile.ts` mais déclaré ici pour éviter un import circulaire
 * (`reconcile.ts` importe CE module pour le chemin read).
 */

export interface BlockedCardRef {
  readonly cardId: string;
  readonly title: string;
  readonly projectId: string;
}

export function blockedCardMessage(card: BlockedCardRef): string {
  // Le titre est OK dans `message` : l'utilisateur notifié est membre du
  // projet et le voit déjà dans l'app (contrat PII de `notice-core.ts`).
  return `« ${card.title} » est passée en Bloqué (échéance dépassée).`;
}

export function blockedCardDiscuss(card: BlockedCardRef): string {
  // ID + verbes SEULEMENT (contrat anti-injection de `notice-core.ts` — le
  // titre, potentiellement écrit par un tiers via l'app, ne doit JAMAIS
  // atterrir dans `discuss`, qui est réinjecté comme message utilisateur
  // dans le chat de l'assistant).
  return `Parlons de la carte ${card.cardId} passée en Bloqué`;
}

/**
 * Prisma leaf — membres d'un projet (uuids seulement). Un projet sans membre
 * renvoie `[]` : c'est un no-op documenté (aucune notice envoyée), PAS une
 * erreur — voir `notifyNewlyBlocked`.
 */
export async function listProjectMemberUserIds(projectId: string): Promise<string[]> {
  const rows = await prisma.projectMember.findMany({
    where: { projectId },
    select: { userId: true },
  });
  return rows.map((row) => row.userId);
}

export interface NotifyNewlyBlockedDeps {
  readonly listProjectMemberUserIds: (projectId: string) => Promise<readonly string[]>;
  readonly createNotice: (input: AgentNoticeInput) => Promise<{ created: boolean }>;
}

const defaultDeps: NotifyNewlyBlockedDeps = {
  listProjectMemberUserIds,
  createNotice: createAgentNotice,
};

/**
 * Crée une notice `agent_card_blocked` pour chaque MEMBRE DU PROJET de chaque
 * carte nouvellement bloquée. Retourne le nombre de notices effectivement
 * créées (le core peut no-oper : kill switch, préférence par type, dédup).
 *
 * Les erreurs NE sont PAS avalées ici — c'est à l'appelant de choisir sa
 * politique : best-effort (read-path, try/catch → un échec de notices ne doit
 * jamais casser un chargement de page) ou retry (cron, step Inngest dédié).
 */
export async function notifyNewlyBlocked(
  workspaceId: string,
  newlyBlocked: readonly BlockedCardRef[],
  deps: NotifyNewlyBlockedDeps = defaultDeps,
): Promise<{ notices: number }> {
  let notices = 0;
  for (const card of newlyBlocked) {
    const memberUserIds = await deps.listProjectMemberUserIds(card.projectId);
    for (const userId of memberUserIds) {
      const outcome = await deps.createNotice({
        workspaceId,
        userId,
        kind: 'agent_card_blocked',
        message: blockedCardMessage(card),
        data: { ref: card.cardId, discuss: blockedCardDiscuss(card) },
      });
      if (outcome.created) notices += 1;
    }
  }
  return { notices };
}
