import 'server-only';
import { z } from 'zod';
import { prisma } from '@nexushub/db';
import { defineTool, type ToolSpec } from '@nexushub/agent';
import type { AuthContext } from '@/lib/auth';
import {
  TITLE_MAX_CHARS,
  toNotificationSummary,
  type NotificationSummary,
} from '@/features/notifications/lib/notification-summary';
import { safeDb } from './safe-wrappers';

/**
 * Tools notifications (spec visibilité totale §1) — strictement PERSONNELS
 * (workspaceId + userId), non gated : lister/marquer lu est réversible et ne
 * touche que l'utilisateur courant. Le marquage suit la même sémantique que
 * l'action UI (features/notifications/actions/mark-read.ts) : updateMany
 * idempotent, compte réellement modifié renvoyé (règle fiabilité V2 §3).
 */

const LIST_DEFAULT = 20;
const LIST_MAX = 50;
const MARK_IDS_MAX = 100;

const listSchema = z.object({
  unreadOnly: z.boolean().optional(),
  limit: z.number().int().min(1).max(LIST_MAX).optional(),
  offset: z.number().int().min(0).optional(),
});

/**
 * `z.union` produit un message d'erreur composite peu montrable ; on préfère
 * un objet unique avec `.refine` (exactement un des deux champs) — message
 * FR direct, et surtout re-parsable tel quel côté handler (voir plus bas :
 * le handler est appelé directement par les tests, hors ToolRegistry, donc il
 * doit valider lui-même — même rationnel que les `describeForConfirm` « brut »
 * de mail-tools.ts).
 */
const markSchema = z
  .object({
    ids: z.array(z.string().uuid()).min(1).max(MARK_IDS_MAX).optional(),
    all: z.literal(true).optional(),
  })
  .refine((v) => (v.ids !== undefined) !== (v.all !== undefined), {
    message: 'Fournissez soit "ids" (tableau), soit "all": true, exclusivement.',
  });

/**
 * Résout en un seul aller-retour les cartes référencées par `data.cardId`
 * dans un lot de résumés (jamais de N+1) — suivi de la revue de sécurité
 * « total visibility » : une notification affiche un titre humain et un
 * `cardId` actionnable (chaînable avec `get_card`) SEULEMENT si `get_card`
 * pourrait effectivement l'ouvrir. Détail des branches :
 *
 * - carte vivante, projet vivant → titre « <titre> — <projet> » + cardId ;
 * - carte vivante, projet en corbeille (soft delete, ADR 0001 #15) → titre
 *   suffixé « (projet en corbeille) » + cardId QUAND MÊME exposé :
 *   `get_card`/`get_card_details` ne filtrent PAS `project.deletedAt` (voir
 *   read-tools.ts + scopedCardWhere), la carte reste donc lisible ;
 * - carte soft-deleted → NOMMÉE « <titre> — <projet> (carte supprimée) »
 *   pour que la notification reste explicable, mais SANS cardId : `get_card`
 *   filtre `deletedAt: null`, l'id serait inactionnable ;
 * - id inconnu / autre workspace → rien d'exposé, titre reste null (jamais
 *   d'id que l'utilisateur ne peut pas ouvrir).
 *
 * La requête ne filtre donc PAS `deletedAt` (il faut résoudre les cartes
 * supprimées pour les nommer) mais reste STRICTEMENT scopée `workspaceId`.
 */
async function enrichWithCardContext(
  summaries: readonly NotificationSummary[],
  workspaceId: string,
): Promise<NotificationSummary[]> {
  const cardIds = Array.from(
    new Set(summaries.flatMap((s) => (s.cardId !== undefined ? [s.cardId] : []))),
  );
  if (cardIds.length === 0) return summaries.slice();

  const cards = await prisma.card.findMany({
    where: { id: { in: cardIds }, workspaceId },
    select: {
      id: true,
      title: true,
      deletedAt: true,
      project: { select: { name: true, deletedAt: true } },
    },
  });
  const cardById = new Map(cards.map((c) => [c.id, c]));

  return summaries.map((summary) => {
    if (summary.cardId === undefined) return summary;
    const card = cardById.get(summary.cardId);
    if (card === undefined) {
      // Non résolue dans ce workspace (id inconnu, autre workspace) : on ne
      // renvoie JAMAIS un cardId que l'utilisateur ne peut pas ouvrir.
      const { cardId: _drop, ...rest } = summary;
      return rest;
    }
    const cardDeleted = card.deletedAt !== null;
    // Carte supprimée : nommée ci-dessous, mais id inactionnable → retiré.
    const { cardId: _actionable, ...withoutCardId } = summary;
    const enriched: NotificationSummary = cardDeleted ? withoutCardId : summary;
    if (summary.title !== null) return enriched; // titre déjà rempli (agent_*), on ne l'écrase pas
    const suffix = cardDeleted
      ? ' (carte supprimée)'
      : card.project.deletedAt !== null
        ? ' (projet en corbeille)'
        : '';
    const composedTitle = `${card.title} — ${card.project.name}${suffix}`.slice(0, TITLE_MAX_CHARS);
    return { ...enriched, title: composedTitle };
  });
}

export function buildNotificationTools(ctx: AuthContext): ToolSpec[] {
  const { workspaceId, userId } = ctx;
  return [
    defineTool({
      name: 'list_notifications',
      description:
        'Liste VOS notifications in-app (celles du compteur du briefing), les non lues par défaut. Renvoie total/offset pour paginer, et un résumé humain de chaque notification.',
      inputSchema: listSchema,
      jsonSchema: {
        type: 'object',
        properties: {
          unreadOnly: { type: 'boolean', description: 'Défaut true — false pour tout lister' },
          limit: { type: 'integer', minimum: 1, maximum: LIST_MAX },
          offset: { type: 'integer', minimum: 0 },
        },
      },
      handler: async (input) =>
        safeDb('list_notifications', async () => {
          const unreadOnly = input.unreadOnly ?? true;
          const where = {
            workspaceId,
            userId,
            ...(unreadOnly ? { readAt: null } : {}),
          };
          const [total, rows] = await Promise.all([
            prisma.notification.count({ where }),
            prisma.notification.findMany({
              where,
              select: { id: true, kind: true, data: true, readAt: true, createdAt: true },
              orderBy: { createdAt: 'desc' },
              take: input.limit ?? LIST_DEFAULT,
              skip: input.offset ?? 0,
            }),
          ]);
          const notifications = await enrichWithCardContext(
            rows.map(toNotificationSummary),
            workspaceId,
          );
          return JSON.stringify({
            total,
            offset: input.offset ?? 0,
            notifications,
          });
        }),
    }),

    defineTool({
      name: 'mark_notifications_read',
      description:
        'Marque VOS notifications comme lues : { ids: [...] } pour une sélection (ids via list_notifications), ou { all: true } pour toutes les non lues. Réversible, sans confirmation. Renvoie le compte réellement marqué.',
      inputSchema: markSchema,
      jsonSchema: {
        type: 'object',
        properties: {
          ids: {
            type: 'array',
            items: { type: 'string', format: 'uuid' },
            minItems: 1,
            maxItems: MARK_IDS_MAX,
          },
          all: { type: 'boolean', description: 'true = toutes les non lues (exclusif avec ids)' },
        },
      },
      handler: async (input) =>
        safeDb('mark_notifications_read', async () => {
          const parsed = markSchema.safeParse(input);
          if (!parsed.success) {
            return 'Erreur : entrée invalide pour mark_notifications_read — fournissez soit "ids" soit "all", exclusivement.';
          }
          const result = await prisma.notification.updateMany({
            where: {
              workspaceId,
              userId,
              ...(parsed.data.ids !== undefined
                ? { id: { in: parsed.data.ids } }
                : { readAt: null }),
            },
            data: { readAt: new Date() },
          });
          return JSON.stringify({ marked: result.count });
        }),
    }),
  ];
}
