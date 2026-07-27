import 'server-only';

import { z } from 'zod';
import { defineTool, type ToolSpec } from '@nexushub/agent';
import type { AuthContext } from '@/lib/auth';
import { createCardCore, deleteCardCore } from '@/features/projects/lib/card-core';
import { createProjectCore } from '@/features/projects/lib/project-core';
import { CreateProjectSchema } from '@/features/projects/lib/schemas';
import { moveCard } from '@/features/projects/actions/move-card';
import { updateCard } from '@/features/projects/actions/update-card';
import { updateCardDueDate } from '@/features/projects/actions/update-card-due-date';
import { addCardAssignee, removeCardAssignee } from '@/features/projects/actions/card-assignees';

const uuid = z.string().uuid();
const UUID_JSON = { type: 'string', format: 'uuid' } as const;

const RACI_VALUES = ['responsible', 'approver', 'consulted', 'informed'] as const;

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
      handler: async (input) => {
        const result = await createCardCore(ctx, input);
        if (!result.ok) return failure(result.message);
        return JSON.stringify({
          created: true,
          cardId: result.cardId,
          ref: result.shortRef,
          title: result.title,
        });
      },
    }),

    defineTool({
      name: 'create_project',
      description:
        "Crée un projet pour un client à partir d'un template Kanban (get_project_board, list_clients pour trouver le clientId). Ajoute automatiquement les colonnes du template et la colonne Bloqué, et fait de l'utilisateur courant le lead du projet. Une fois créé, l'utilisateur peut ouvrir /projects/{id} pour le voir.",
      inputSchema: z.object({
        name: z.string().trim().min(1).max(160),
        clientId: uuid,
        description: z.string().max(2000).optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        typeId: z.string().optional(),
        templateId: z.string().trim().min(1),
      }),
      jsonSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', maxLength: 160 },
          clientId: UUID_JSON,
          description: { type: 'string', maxLength: 2000 },
          startDate: { type: 'string', format: 'date', description: 'ISO 8601 (YYYY-MM-DD)' },
          endDate: { type: 'string', format: 'date', description: 'ISO 8601 (YYYY-MM-DD)' },
          typeId: { type: 'string', description: "Id d'un type de projet built-in" },
          templateId: {
            type: 'string',
            description: 'Id de template built-in ou UUID de template workspace',
          },
        },
        required: ['name', 'clientId', 'templateId'],
      },
      handler: async (input) => {
        const parsed = CreateProjectSchema.safeParse(input);
        if (!parsed.success) {
          return failure(parsed.error.issues[0]?.message ?? 'Données invalides.');
        }
        const result = await createProjectCore(ctx, parsed.data);
        if (!result.ok) return failure(result.message);
        return JSON.stringify({ created: true, projectId: result.projectId });
      },
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
      handler: async (input) => {
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
        return JSON.stringify({ updated: true });
      },
    }),

    defineTool({
      name: 'set_card_due_date',
      description:
        "Définit (ou efface avec dueDate: null) l'échéance d'une carte. Une échéance dépassée peut faire entrer automatiquement la carte dans la colonne Bloqué (autoBlocked) ; repousser ou effacer une échéance dépassée en sort automatiquement la carte vers sa colonne précédente (autoUnblocked).",
      inputSchema: z.object({
        cardId: uuid,
        dueDate: z.string().nullable(),
      }),
      jsonSchema: {
        type: 'object',
        properties: {
          cardId: UUID_JSON,
          dueDate: {
            type: ['string', 'null'],
            format: 'date',
            description: 'ISO 8601 (YYYY-MM-DD), ou null pour effacer',
          },
        },
        required: ['cardId', 'dueDate'],
      },
      handler: async (input) => {
        const result = await updateCardDueDate(input);
        if (!result.ok) return failure(result.message);
        return JSON.stringify({
          updated: true,
          autoBlocked: result.autoBlocked,
          autoUnblocked: result.autoUnblocked,
          newDueDate: result.newDueDate,
        });
      },
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
      handler: async (input) => {
        const result = await moveCard(input);
        if (!result.ok) return failure(result.message);
        return JSON.stringify({ moved: true, position: result.position });
      },
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
      handler: async (input) => {
        const result = await addCardAssignee(input);
        if (!result.ok) return failure(result.message);
        return JSON.stringify({ assigned: true, userId: input.userId, raci: input.raci });
      },
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
      handler: async (input) => {
        const result = await removeCardAssignee(input);
        if (!result.ok) return failure(result.message);
        return JSON.stringify({ removed: true });
      },
    }),

    defineTool({
      name: 'delete_card',
      description:
        'Supprime une carte (corbeille, restaurable 30 jours). Action sensible : confirmation utilisateur requise.',
      inputSchema: z.object({ cardId: uuid }),
      jsonSchema: { type: 'object', properties: { cardId: UUID_JSON }, required: ['cardId'] },
      gated: true,
      handler: async (input) => {
        const result = await deleteCardCore(ctx, input);
        return result.ok ? 'Carte supprimée (restaurable 30 jours).' : failure(result.message);
      },
    }),
  ];
}
