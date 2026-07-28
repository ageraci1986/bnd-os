import 'server-only';

import { z } from 'zod';
import { defineTool, type ToolSpec } from '@nexushub/agent';
import { prisma } from '@nexushub/db';
import { BUILTIN_PROJECT_TYPES, BUILTIN_TEMPLATES } from '@nexushub/domain';
import type { AuthContext } from '@/lib/auth';
import { createCardCore, deleteCardCore } from '@/features/projects/lib/card-core';
import { createProjectCore } from '@/features/projects/lib/project-core';
import { CreateProjectSchema } from '@/features/projects/lib/schemas';
import { moveCard } from '@/features/projects/actions/move-card';
import { updateCard } from '@/features/projects/actions/update-card';
import { updateCardDueDate } from '@/features/projects/actions/update-card-due-date';
import { addCardAssignee, removeCardAssignee } from '@/features/projects/actions/card-assignees';
import { safeMutation } from './safe-wrappers';

const uuid = z.string().uuid();
const UUID_JSON = { type: 'string', format: 'uuid' } as const;

/** Format de date accepté par les tools (le seul que les schémas serveur re-valident). */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_FORMAT_MESSAGE = 'Format attendu : YYYY-MM-DD';
const DATE_INVALID_MESSAGE = 'Date invalide.';

/**
 * Vérifie qu'une chaîne `YYYY-MM-DD` correspond à une date réelle du
 * calendrier. `new Date(...)` seul ne suffit pas : il « corrige »
 * silencieusement un jour hors plage (ex. 2026-02-30 → 2 mars 2026), ce qui
 * ferait passer une entrée invalide comme si elle était valide. On construit
 * la date en UTC puis on vérifie que les composants round-trip à l'identique.
 */
function isValidCalendarDate(d: string): boolean {
  const [y, m, day] = d.split('-').map(Number);
  if (y === undefined || m === undefined || day === undefined) return false;
  const dt = new Date(Date.UTC(y, m - 1, day));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === day;
}

const RACI_VALUES = ['responsible', 'approver', 'consulted', 'informed'] as const;

// Construites depuis les constantes domain pour que les descriptions ne
// puissent pas dériver si un template/type built-in est ajouté ou renommé.
const BUILTIN_TEMPLATE_IDS = BUILTIN_TEMPLATES.map((t) => t.id);
const BUILTIN_TYPE_IDS = BUILTIN_PROJECT_TYPES.map((t) => t.id);

/**
 * Reformule un échec `{ok:false, message}` en message montrable. Contrat
 * `defineTool` : seul un texte user-safe peut s'échapper d'un handler.
 */
function failure(message: string): string {
  return `Échec : ${message}`;
}

/**
 * Tools mutants Kanban (Plan 2a Task 8). Wrappent les cores/actions
 * existants — aucune logique métier ici, uniquement la traduction
 * schéma Zod ↔ résultat `{ok}` ↔ message montrable. `ctx` est lié à la
 * construction (jamais fourni par le modèle) : voir `tools/index.ts`.
 */
export function buildKanbanTools(ctx: AuthContext): ToolSpec[] {
  return [
    defineTool({
      name: 'create_card',
      description:
        "Crée une carte dans une colonne d'un projet. Utiliser get_project_board pour trouver projectId et columnId.",
      inputSchema: z.object({
        projectId: uuid,
        columnId: uuid,
        title: z.string().trim().min(1).max(160),
      }),
      jsonSchema: {
        type: 'object',
        properties: {
          projectId: UUID_JSON,
          columnId: UUID_JSON,
          title: { type: 'string', maxLength: 160 },
        },
        required: ['projectId', 'columnId', 'title'],
      },
      handler: async (input) =>
        safeMutation('create_card', async () => {
          const result = await createCardCore(ctx, input);
          if (!result.ok) return failure(result.message);
          return JSON.stringify({
            created: true,
            cardId: result.cardId,
            ref: result.shortRef,
            title: result.title,
          });
        }),
    }),

    defineTool({
      name: 'create_project',
      description:
        "Crée un projet pour un client à partir d'un template Kanban (list_clients pour trouver le clientId). " +
        `templateId : un template built-in (${BUILTIN_TEMPLATE_IDS.join(', ')}) ou l'UUID d'un template du workspace. ` +
        `typeId (optionnel) : ${BUILTIN_TYPE_IDS.join(', ')}. ` +
        "Ajoute automatiquement les colonnes du template et la colonne Bloqué, et fait de l'utilisateur courant le lead du projet. Une fois créé, l'utilisateur peut ouvrir /projects/{id} pour le voir.",
      inputSchema: z.object({
        name: z.string().trim().min(1).max(160),
        clientId: uuid,
        description: z.string().max(2000).optional(),
        startDate: z
          .string()
          .regex(DATE_RE, DATE_FORMAT_MESSAGE)
          .refine(isValidCalendarDate, DATE_INVALID_MESSAGE)
          .optional(),
        endDate: z
          .string()
          .regex(DATE_RE, DATE_FORMAT_MESSAGE)
          .refine(isValidCalendarDate, DATE_INVALID_MESSAGE)
          .optional(),
        typeId: z.string().optional(),
        templateId: z.string().trim().min(1),
      }),
      jsonSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', maxLength: 160 },
          clientId: UUID_JSON,
          description: { type: 'string', maxLength: 2000 },
          startDate: {
            type: 'string',
            pattern: DATE_RE.source,
            description: 'ISO 8601 (YYYY-MM-DD), doit être une date réelle du calendrier',
          },
          endDate: {
            type: 'string',
            pattern: DATE_RE.source,
            description: 'ISO 8601 (YYYY-MM-DD), doit être une date réelle du calendrier',
          },
          typeId: {
            type: 'string',
            enum: BUILTIN_TYPE_IDS,
            description: `Type de projet built-in : ${BUILTIN_TYPE_IDS.join(', ')}`,
          },
          templateId: {
            type: 'string',
            description: `Template built-in (${BUILTIN_TEMPLATE_IDS.join(', ')}) ou UUID de template workspace`,
          },
        },
        required: ['name', 'clientId', 'templateId'],
      },
      handler: async (input) =>
        safeMutation('create_project', async () => {
          const parsed = CreateProjectSchema.safeParse(input);
          if (!parsed.success) {
            return failure(parsed.error.issues[0]?.message ?? 'Données invalides.');
          }
          const result = await createProjectCore(ctx, parsed.data);
          if (!result.ok) return failure(result.message);
          return JSON.stringify({ created: true, projectId: result.projectId });
        }),
    }),

    defineTool({
      name: 'update_card',
      description:
        "Met à jour le titre, la description ou l'étiquette de catégorie d'une carte. Les champs non fournis restent inchangés ; categoryTag: null efface l'étiquette.",
      inputSchema: z.object({
        cardId: uuid,
        title: z.string().trim().min(1).max(200).optional(),
        description: z.string().max(8000).optional(),
        categoryTag: z.string().trim().min(1).max(32).nullable().optional(),
      }),
      jsonSchema: {
        type: 'object',
        properties: {
          cardId: UUID_JSON,
          title: { type: 'string', maxLength: 200 },
          description: { type: 'string', maxLength: 8000 },
          categoryTag: { type: ['string', 'null'], maxLength: 32 },
        },
        required: ['cardId'],
      },
      handler: async (input) =>
        safeMutation('update_card', async () => {
          // Reconstruit l'objet en n'incluant que les clés définies : sous
          // `exactOptionalPropertyTypes`, le type inféré par Zod pour un champ
          // `.optional()` (`string | undefined`) n'est pas assignable au
          // paramètre de `updateCard` (`title?: string`, undefined explicite
          // interdit) — voir la même convention dans update-card.ts.
          const result = await updateCard({
            cardId: input.cardId,
            ...(input.title !== undefined ? { title: input.title } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
            ...(input.categoryTag !== undefined ? { categoryTag: input.categoryTag } : {}),
          });
          if (!result.ok) return failure(result.message);
          // Lecture-après-écriture (spec V2 §3.1) : l'état renvoyé est RELU
          // en DB, jamais déduit de l'input — le modèle ne peut plus
          // affirmer un état qu'aucun tool n'a constaté.
          const after = await prisma.card.findFirst({
            where: { id: input.cardId, workspaceId: ctx.workspaceId, deletedAt: null },
            select: { title: true, description: true, categoryTag: true },
          });
          if (after === null) {
            return 'Mise à jour enregistrée mais vérification impossible (carte introuvable à la relecture).';
          }
          return JSON.stringify({
            updated: true,
            title: after.title,
            ...(after.categoryTag !== null ? { categoryTag: after.categoryTag } : {}),
          });
        }),
    }),

    defineTool({
      name: 'set_card_due_date',
      description:
        "Définit (ou efface avec dueDate: null) l'échéance d'une carte, au format YYYY-MM-DD. Une échéance dépassée peut faire entrer automatiquement la carte dans la colonne Bloqué (autoBlocked) ; repousser ou effacer une échéance dépassée en sort automatiquement la carte vers sa colonne précédente (autoUnblocked).",
      inputSchema: z.object({
        cardId: uuid,
        dueDate: z
          .string()
          .regex(DATE_RE, DATE_FORMAT_MESSAGE)
          .refine(isValidCalendarDate, DATE_INVALID_MESSAGE)
          .nullable(),
      }),
      jsonSchema: {
        type: 'object',
        properties: {
          cardId: UUID_JSON,
          dueDate: {
            type: ['string', 'null'],
            pattern: DATE_RE.source,
            description:
              'ISO 8601 (YYYY-MM-DD), doit être une date réelle du calendrier, ou null pour effacer',
          },
        },
        required: ['cardId', 'dueDate'],
      },
      handler: async (input) =>
        safeMutation('set_card_due_date', async () => {
          const result = await updateCardDueDate(input);
          if (!result.ok) return failure(result.message);
          return JSON.stringify({
            updated: true,
            autoBlocked: result.autoBlocked,
            autoUnblocked: result.autoUnblocked,
            newDueDate: result.newDueDate,
          });
        }),
    }),

    defineTool({
      name: 'move_card',
      description:
        'Déplace une carte vers une colonne et une position (index 0-based) données. Le déplacement vers la colonne « Bloqué » est refusé : elle est gérée automatiquement par les échéances (voir set_card_due_date).',
      inputSchema: z.object({
        cardId: uuid,
        targetColumnId: uuid,
        targetIndex: z.number().int().min(0),
      }),
      jsonSchema: {
        type: 'object',
        properties: {
          cardId: UUID_JSON,
          targetColumnId: UUID_JSON,
          targetIndex: { type: 'integer', minimum: 0 },
        },
        required: ['cardId', 'targetColumnId', 'targetIndex'],
      },
      handler: async (input) =>
        safeMutation('move_card', async () => {
          const result = await moveCard(input);
          if (!result.ok) return failure(result.message);
          // Lecture-après-écriture (spec V2 §3.1) : l'état renvoyé est RELU
          // en DB, jamais déduit de l'input — le modèle ne peut plus
          // affirmer un état qu'aucun tool n'a constaté.
          const after = await prisma.card.findFirst({
            where: { id: input.cardId, workspaceId: ctx.workspaceId, deletedAt: null },
            select: { columnId: true, column: { select: { name: true } } },
          });
          if (after === null) {
            return 'Déplacement enregistré mais vérification impossible (carte introuvable à la relecture).';
          }
          return JSON.stringify({
            moved: true,
            nowInColumn: after.column.name,
            position: result.position,
          });
        }),
    }),

    defineTool({
      name: 'add_card_assignee',
      description:
        'Assigne un membre du workspace à une carte avec un rôle RACI (responsible/approver/consulted/informed). Un seul responsible et un seul approver par carte. Utiliser get_team_members pour trouver les userId.',
      inputSchema: z.object({
        cardId: uuid,
        userId: uuid,
        raci: z.enum(RACI_VALUES),
      }),
      jsonSchema: {
        type: 'object',
        properties: {
          cardId: UUID_JSON,
          userId: UUID_JSON,
          raci: { type: 'string', enum: [...RACI_VALUES] },
        },
        required: ['cardId', 'userId', 'raci'],
      },
      handler: async (input) =>
        safeMutation('add_card_assignee', async () => {
          const result = await addCardAssignee(input);
          if (!result.ok) return failure(result.message);
          return JSON.stringify({ assigned: true, userId: input.userId, raci: input.raci });
        }),
    }),

    defineTool({
      name: 'remove_card_assignee',
      description: "Retire l'assignation RACI d'un membre sur une carte.",
      inputSchema: z.object({ cardId: uuid, userId: uuid }),
      jsonSchema: {
        type: 'object',
        properties: { cardId: UUID_JSON, userId: UUID_JSON },
        required: ['cardId', 'userId'],
      },
      handler: async (input) =>
        safeMutation('remove_card_assignee', async () => {
          const result = await removeCardAssignee(input);
          if (!result.ok) return failure(result.message);
          return JSON.stringify({ removed: true });
        }),
    }),

    defineTool({
      name: 'delete_card',
      description:
        'Supprime une carte (corbeille, restaurable 30 jours). Action sensible : confirmation utilisateur requise.',
      inputSchema: z.object({ cardId: uuid }),
      jsonSchema: { type: 'object', properties: { cardId: UUID_JSON }, required: ['cardId'] },
      gated: true,
      handler: async (input) =>
        safeMutation('delete_card', async () => {
          const result = await deleteCardCore(ctx, input);
          return result.ok ? 'Carte supprimée (restaurable 30 jours).' : failure(result.message);
        }),
    }),
  ];
}
