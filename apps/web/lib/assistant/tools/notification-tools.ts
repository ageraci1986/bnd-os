import 'server-only';
import { z } from 'zod';
import { prisma } from '@nexushub/db';
import { defineTool, type ToolSpec } from '@nexushub/agent';
import type { AuthContext } from '@/lib/auth';
import { toNotificationSummary } from '@/features/notifications/lib/notification-summary';
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
          return JSON.stringify({
            total,
            offset: input.offset ?? 0,
            notifications: rows.map(toNotificationSummary),
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
