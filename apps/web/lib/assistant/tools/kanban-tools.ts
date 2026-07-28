import 'server-only';

import { z } from 'zod';
import { defineTool, type ToolSpec } from '@nexushub/agent';
import { prisma } from '@nexushub/db';
import { BUILTIN_PROJECT_TYPES, BUILTIN_TEMPLATES } from '@nexushub/domain';
import type { AuthContext } from '@/lib/auth';
import { createCardCore, deleteCardCore } from '@/features/projects/lib/card-core';
import {
  addColumnCore,
  deleteColumnCore,
  renameColumnCore,
  reorderColumnsCore,
} from '@/features/projects/lib/column-core';
import {
  createProjectCore,
  deleteProjectCore,
  updateProjectCore,
} from '@/features/projects/lib/project-core';
import { CreateProjectSchema } from '@/features/projects/lib/schemas';
import { loadUserScope, scopedProjectWhere } from '@/lib/auth/scope';
import { moveCard } from '@/features/projects/actions/move-card';
import { updateCard } from '@/features/projects/actions/update-card';
import { updateCardDueDate } from '@/features/projects/actions/update-card-due-date';
import { addCardAssignee, removeCardAssignee } from '@/features/projects/actions/card-assignees';
import { toggleChecklistItem } from '@/features/projects/actions/checklist';
import { advanceCard } from '@/features/projects/actions/advance-card';
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
          // affirmer un état qu'aucun tool n'a constaté. La relecture est
          // isolée de safeMutation : si elle lève alors que la mutation est
          // committée, renvoyer le message d'échec générique ferait croire à
          // un échec (risque de retry dupliqué). Aucun log de l'erreur brute
          // (contrat safe-wrappers).
          let after;
          try {
            after = await prisma.card.findFirst({
              where: { id: input.cardId, workspaceId: ctx.workspaceId, deletedAt: null },
              select: { title: true, categoryTag: true },
            });
          } catch {
            return 'Mise à jour enregistrée mais vérification impossible (erreur technique).';
          }
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
          // Lecture-après-écriture (spec V2 §3.1) : l'état renvoyé (colonne
          // ET position) est RELU en DB, jamais déduit de l'input ni du
          // résultat de la mutation — le modèle ne peut plus affirmer un état
          // qu'aucun tool n'a constaté. La relecture est isolée de
          // safeMutation : si elle lève alors que la mutation est committée,
          // renvoyer le message d'échec générique ferait croire à un échec
          // (risque de retry dupliqué). Aucun log de l'erreur brute (contrat
          // safe-wrappers).
          let after;
          try {
            after = await prisma.card.findFirst({
              where: { id: input.cardId, workspaceId: ctx.workspaceId, deletedAt: null },
              select: { columnId: true, position: true, column: { select: { name: true } } },
            });
          } catch {
            return 'Déplacement enregistré mais vérification impossible (erreur technique).';
          }
          if (after === null) {
            return 'Déplacement enregistré mais vérification impossible (carte introuvable à la relecture).';
          }
          return JSON.stringify({
            moved: true,
            nowInColumn: after.column.name,
            position: after.position,
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
      name: 'set_checklist_item',
      description:
        "Coche ou décoche un item de checklist d'une carte (ids via get_card_details). Fournir cardId : si le dernier item vient d'être coché, la carte avance automatiquement de colonne (règle métier NexusHub) et le résultat l'indique.",
      inputSchema: z.object({
        itemId: uuid,
        cardId: uuid,
        isChecked: z.boolean(),
      }),
      jsonSchema: {
        type: 'object',
        properties: {
          itemId: UUID_JSON,
          cardId: UUID_JSON,
          isChecked: { type: 'boolean' },
        },
        required: ['itemId', 'cardId', 'isChecked'],
      },
      handler: async (input) =>
        safeMutation('set_checklist_item', async () => {
          const result = await toggleChecklistItem({
            itemId: input.itemId,
            isChecked: input.isChecked,
          });
          if (!result.ok) return failure(result.message);
          const checked = result.items.filter((i) => i.isChecked).length;
          const total = result.items.length;

          // L'auto-avancement (règle métier PRD §8.2) ne se déclenche QUE
          // quand on vient de cocher (jamais au décochage) ET que la
          // checklist est intégralement cochée. Côté UI le déclenchement
          // attend 1800ms (fenêtre d'annulation) ; côté agent il est
          // immédiat — cette fenêtre n'a pas de sens pour un tool.
          let autoAdvanced = false;
          let nowInColumn: string | undefined;
          if (input.isChecked && result.allChecked) {
            // Best-effort : un échec d'avancement ne doit jamais faire
            // passer le toggle (déjà committé) pour un échec — l'agent a
            // simplement l'info que l'auto-avancement n'a pas eu lieu.
            try {
              const advance = await advanceCard({ cardId: input.cardId });
              if (advance.ok && advance.moved) {
                // Lecture-après-écriture (spec V2 §3.1, même convention que
                // move_card) : le nom de colonne est RELU en DB, jamais
                // déduit de l'id renvoyé par advanceCard.
                const after = await prisma.card.findFirst({
                  where: { id: input.cardId, workspaceId: ctx.workspaceId, deletedAt: null },
                  select: { column: { select: { name: true } } },
                });
                if (after !== null) {
                  autoAdvanced = true;
                  nowInColumn = after.column.name;
                }
              }
            } catch {
              // autoAdvanced reste false — le toggle, lui, est déjà acquis.
            }
          }

          return JSON.stringify({
            updated: true,
            checked,
            total,
            autoAdvanced,
            ...(nowInColumn !== undefined ? { nowInColumn } : {}),
          });
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

    defineTool({
      name: 'update_project',
      description:
        "Met à jour le nom, la description ou les dates de début/fin d'un projet. Les champs non fournis restent inchangés ; description: null efface la description, startDate/endDate: null efface la date correspondante.",
      inputSchema: z.object({
        projectId: uuid,
        // 120 : borne du domain (`validateProjectName`, PROJECT_NAME_MAX) —
        // pas 160 comme create_project, dont le schéma serveur re-tronque.
        name: z.string().trim().min(1).max(120).optional(),
        description: z.string().max(2000).nullable().optional(),
        startDate: z
          .string()
          .regex(DATE_RE, DATE_FORMAT_MESSAGE)
          .refine(isValidCalendarDate, DATE_INVALID_MESSAGE)
          .nullable()
          .optional(),
        endDate: z
          .string()
          .regex(DATE_RE, DATE_FORMAT_MESSAGE)
          .refine(isValidCalendarDate, DATE_INVALID_MESSAGE)
          .nullable()
          .optional(),
      }),
      jsonSchema: {
        type: 'object',
        properties: {
          projectId: UUID_JSON,
          name: { type: 'string', maxLength: 120 },
          description: { type: ['string', 'null'], maxLength: 2000 },
          startDate: {
            type: ['string', 'null'],
            pattern: DATE_RE.source,
            description:
              'ISO 8601 (YYYY-MM-DD), doit être une date réelle du calendrier, ou null pour effacer',
          },
          endDate: {
            type: ['string', 'null'],
            pattern: DATE_RE.source,
            description:
              'ISO 8601 (YYYY-MM-DD), doit être une date réelle du calendrier, ou null pour effacer',
          },
        },
        required: ['projectId'],
      },
      handler: async (input) =>
        safeMutation('update_project', async () => {
          // Conditional-spread (exactOptionalPropertyTypes) : voir update_card
          // ci-dessus pour le même rationnel.
          const result = await updateProjectCore(ctx, {
            projectId: input.projectId,
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
            ...(input.startDate !== undefined ? { startDate: input.startDate } : {}),
            ...(input.endDate !== undefined ? { endDate: input.endDate } : {}),
          });
          if (!result.ok) return failure(result.message);
          // Post-état RELU par le core lui-même (spec V2 §3.1).
          return JSON.stringify({
            updated: true,
            name: result.name,
            description: result.description,
            startDate: result.startDate,
            endDate: result.endDate,
          });
        }),
    }),

    defineTool({
      name: 'delete_project',
      description:
        'Supprime un projet (corbeille, restaurable 30 jours). Action sensible : confirmation utilisateur requise.',
      inputSchema: z.object({ projectId: uuid }),
      jsonSchema: { type: 'object', properties: { projectId: UUID_JSON }, required: ['projectId'] },
      gated: true,
      // Anti-spoofing (types.ts) : l'input arrive BRUT, avant validation Zod —
      // on ne fait jamais confiance à un nom fourni par le modèle. Le nom et
      // le compte de cartes affichés dans le dialog sont RELUS en DB, scopés
      // au workspace courant via la closure `ctx`.
      describeForConfirm: async (input: unknown) => {
        // Re-parse local OBLIGATOIRE : sans lui, Prisma 6 ignore `id:
        // undefined` (findFirst → PREMIER projet du workspace !) et accepte
        // un objet ({"not": null}) comme filtre structuré — le dialog
        // pourrait nommer un autre objet que celui réellement supprimé.
        const parsed = z.object({ projectId: uuid }).safeParse(input);
        if (!parsed.success) return 'Supprimer un projet introuvable dans ce workspace ?';
        // Même filtrage scope que les tools de lecture (read-tools) : un
        // restricted ne doit pas apprendre le nom/compte d'un projet hors de
        // son scope via le dialog. Hors scope → même texte que l'inexistant
        // (ne pas révéler l'existence). AND explicite : `scopedProjectWhere`
        // peut renvoyer `{ id: … }`, qui écraserait la clé `id` en spread.
        const scope = await loadUserScope(ctx);
        const project = await prisma.project.findFirst({
          where: {
            AND: [
              { id: parsed.data.projectId, workspaceId: ctx.workspaceId, deletedAt: null },
              scopedProjectWhere(scope),
            ],
          },
          select: { name: true, _count: { select: { cards: { where: { deletedAt: null } } } } },
        });
        if (project === null) return 'Supprimer un projet introuvable dans ce workspace ?';
        const n = project._count.cards;
        return `Supprimer le projet « ${project.name} » (${n} carte${n > 1 ? 's' : ''}) — restaurable 30 jours ?`;
      },
      handler: async (input) =>
        safeMutation('delete_project', async () => {
          const result = await deleteProjectCore(ctx, input);
          return result.ok ? 'Projet supprimé (corbeille 30 jours).' : failure(result.message);
        }),
    }),

    defineTool({
      name: 'add_column',
      description: "Ajoute une colonne au Kanban d'un projet (insérée avant « Bloqué »).",
      inputSchema: z.object({
        projectId: uuid,
        name: z.string().trim().min(1).max(60),
      }),
      jsonSchema: {
        type: 'object',
        properties: { projectId: UUID_JSON, name: { type: 'string', maxLength: 60 } },
        required: ['projectId', 'name'],
      },
      handler: async (input) =>
        safeMutation('add_column', async () => {
          const result = await addColumnCore(ctx, input);
          if (!result.ok) return failure(result.message);
          return JSON.stringify({
            created: true,
            columnId: result.columnId,
            columns: result.columns,
          });
        }),
    }),

    defineTool({
      name: 'rename_column',
      description:
        'Renomme une colonne du Kanban (la colonne système « Bloqué » ne peut pas être renommée).',
      inputSchema: z.object({
        columnId: uuid,
        name: z.string().trim().min(1).max(60),
      }),
      jsonSchema: {
        type: 'object',
        properties: { columnId: UUID_JSON, name: { type: 'string', maxLength: 60 } },
        required: ['columnId', 'name'],
      },
      handler: async (input) =>
        safeMutation('rename_column', async () => {
          const result = await renameColumnCore(ctx, input);
          if (!result.ok) return failure(result.message);
          return JSON.stringify({ renamed: true, name: result.name });
        }),
    }),

    defineTool({
      name: 'reorder_columns',
      description:
        "Réordonne les colonnes d'un projet. orderedColumnIds doit lister la totalité des colonnes du projet hors « Bloqué » (qui reste toujours en dernière position), sans doublon ni omission — utiliser get_project_board pour obtenir la liste actuelle.",
      inputSchema: z.object({
        projectId: uuid,
        orderedColumnIds: z.array(uuid).min(1).max(30),
      }),
      jsonSchema: {
        type: 'object',
        properties: {
          projectId: UUID_JSON,
          orderedColumnIds: { type: 'array', items: UUID_JSON, minItems: 1, maxItems: 30 },
        },
        required: ['projectId', 'orderedColumnIds'],
      },
      handler: async (input) =>
        safeMutation('reorder_columns', async () => {
          const result = await reorderColumnsCore(ctx, input);
          if (!result.ok) return failure(result.message);
          return JSON.stringify({ reordered: true, columns: result.columns });
        }),
    }),

    defineTool({
      name: 'delete_column',
      description:
        'Supprime une colonne du Kanban ; ses cartes (le cas échéant) sont déplacées vers la première colonne restante du projet. La colonne système « Bloqué » ne peut pas être supprimée. Action sensible : confirmation utilisateur requise.',
      inputSchema: z.object({ columnId: uuid }),
      jsonSchema: { type: 'object', properties: { columnId: UUID_JSON }, required: ['columnId'] },
      // Gate inconditionnel : `gated` est une propriété statique du tool (pas
      // fonction de l'input), impossible de la faire dépendre de "y a-t-il des
      // cartes dedans" — le spec envisageait un gate conditionnel (⚡ si
      // cartes non vide) mais ce n'est pas modélisable ici. Confirmer la
      // suppression d'une colonne vide est trivial pour l'utilisateur ; le
      // texte du dialog (describeForConfirm ci-dessous) distingue déjà les
      // deux cas pour rester honnête sur ce qui va se passer.
      gated: true,
      describeForConfirm: async (input: unknown) => {
        // Re-parse local OBLIGATOIRE (même rationnel que delete_project) :
        // l'input arrive BRUT, avant la validation Zod du registry.
        const parsed = z.object({ columnId: uuid }).safeParse(input);
        if (!parsed.success) return 'Supprimer une colonne introuvable dans ce workspace ?';
        // Scope restricted appliqué via le join projet (même filtrage que
        // read-tools) ; hors scope → même texte que l'inexistant.
        const scope = await loadUserScope(ctx);
        const column = await prisma.column.findFirst({
          where: {
            id: parsed.data.columnId,
            project: {
              AND: [{ workspaceId: ctx.workspaceId, deletedAt: null }, scopedProjectWhere(scope)],
            },
          },
          select: { name: true, isBlockedSystem: true },
        });
        if (column === null) return 'Supprimer une colonne introuvable dans ce workspace ?';
        // Cohérent avec le refus du core (BLOCKED_LOCKED) : ne pas afficher
        // un dialog de confirmation pour une action qui sera refusée.
        if (column.isBlockedSystem) {
          return 'La colonne « Bloqué » est gérée par le système et ne peut pas être supprimée.';
        }
        const n = await prisma.card.count({
          where: { columnId: parsed.data.columnId, workspaceId: ctx.workspaceId, deletedAt: null },
        });
        if (n === 0) return `Supprimer la colonne vide « ${column.name} » ?`;
        return `Supprimer la colonne « ${column.name} » et déplacer ses ${n} carte${n > 1 ? 's' : ''} vers la première colonne du projet ?`;
      },
      handler: async (input) =>
        safeMutation('delete_column', async () => {
          const result = await deleteColumnCore(ctx, input);
          if (!result.ok) return failure(result.message);
          return JSON.stringify({
            deleted: true,
            movedCards: result.movedCards,
            movedTo: result.movedTo,
            columns: result.columns,
          });
        }),
    }),
  ];
}
