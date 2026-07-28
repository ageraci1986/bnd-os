import 'server-only';

import { z } from 'zod';
import { defineTool, type ToolSpec } from '@nexushub/agent';
import { prisma } from '@nexushub/db';
import {
  KANBAN_COLUMNS_MAX,
  KANBAN_COLUMN_NAME_MAX,
  KANBAN_STEP_CHECKLIST_LABEL_MAX,
  KANBAN_STEP_CHECKLIST_MAX,
} from '@nexushub/domain';
import type { AuthContext } from '@/lib/auth';
import {
  createKanbanTemplate,
  deleteKanbanTemplate,
  updateKanbanTemplate,
} from '@/features/templates/kanban/actions';
import { safeMutation } from './safe-wrappers';

const uuid = z.string().uuid();
const UUID_JSON = { type: 'string', format: 'uuid' } as const;

/**
 * Borne reprise du garde-fou pré-trim de `NameSchema` dans
 * `features/templates/kanban/actions.ts` (`z.string().max(120)`) — PAS la
 * borne finale post-trim du domain (`KANBAN_TEMPLATE_NAME_MAX = 80`, dans
 * `packages/domain/src/kanban-templates/index.ts`) : un nom de 81-120
 * caractères passe le schéma du tool puis échoue proprement côté core
 * (`validateKanbanTemplateName` → "Nom trop long (max 80)"), plutôt que
 * d'être rejeté silencieusement en amont avec un message Zod générique.
 */
const TEMPLATE_NAME_RAW_MAX = 120;

/**
 * Reformule un échec `{ok:false, message}` en message montrable. Contrat
 * `defineTool` : seul un texte user-safe peut s'échapper d'un handler.
 */
function failure(message: string): string {
  return `Échec : ${message}`;
}

const stepChecklistSchema = z
  .array(z.string().trim().min(1).max(KANBAN_STEP_CHECKLIST_LABEL_MAX))
  .max(KANBAN_STEP_CHECKLIST_MAX);

const stepChecklistJson = {
  type: 'array' as const,
  items: { type: 'string', maxLength: KANBAN_STEP_CHECKLIST_LABEL_MAX },
  maxItems: KANBAN_STEP_CHECKLIST_MAX,
  description: 'Étapes copiées sur chaque carte à son entrée dans cette colonne (optionnel).',
};

const columnSchema = z.object({
  name: z.string().trim().min(1).max(KANBAN_COLUMN_NAME_MAX),
  stepChecklist: stepChecklistSchema.optional(),
});

const columnJson = {
  type: 'object' as const,
  properties: {
    name: { type: 'string', maxLength: KANBAN_COLUMN_NAME_MAX },
    stepChecklist: stepChecklistJson,
  },
  required: ['name'],
};

// Au moins 1 colonne : un template sans colonnes n'a pas d'utilité pratique
// (le core, lui, l'autorise via `.default([])` — restriction volontaire du
// tool, pas une limite du domain).
const columnsSchema = z.array(columnSchema).min(1).max(KANBAN_COLUMNS_MAX);

const columnsJson = {
  type: 'array' as const,
  items: columnJson,
  minItems: 1,
  maxItems: KANBAN_COLUMNS_MAX,
};

const CreateTemplateInputSchema = z.object({
  name: z.string().trim().min(1).max(TEMPLATE_NAME_RAW_MAX),
  columns: columnsSchema,
});

const UpdateTemplateInputSchema = z.object({
  templateId: uuid,
  name: z.string().trim().min(1).max(TEMPLATE_NAME_RAW_MAX),
  columns: columnsSchema,
});

const DeleteTemplateInputSchema = z.object({ templateId: uuid });

const DELETE_NOT_FOUND = 'Supprimer un template introuvable dans ce workspace ?';

/**
 * Tools templates Kanban (Plan 5b Task 6). Wrappent les Server Actions
 * `features/templates/kanban/actions.ts` — celles-ci gèrent DÉJÀ leur propre
 * `requireUser()` (contrairement aux cores `client-core.ts` / `card-core.ts`
 * qui reçoivent un `AuthContext` explicite), donc les handlers ci-dessous ne
 * passent PAS `ctx` en argument aux fonctions `create/update/deleteKanbanTemplate` —
 * seule la closure `ctx` sert aux lookups DB locaux (`describeForConfirm`,
 * lecture-après-écriture), workspace-scopés en défense en profondeur.
 *
 * CRUD templates ouvert aux Membres (CLAUDE.md §6.7 — pas de `client.crud`
 * réservé à l'Admin ici) : aucun `adminOnly`. Modifier un template n'impacte
 * JAMAIS les projets existants (copy-on-create, CLAUDE.md §6.4) — rappelé
 * dans les descriptions pour que le modèle ne présente pas `update_template`
 * comme une opération rétroactive.
 *
 * Seul `delete_template` est gated, avec le pattern `describeForConfirm`
 * véridique habituel (kanban-tools.ts / client-tools.ts / team-tools.ts) :
 * re-parse Zod de l'input BRUT en tête (invalide → libellé prudent SANS appel
 * DB), lookup véridique workspace-scopé, phrasé DÉCLARATIFS (pas une
 * question) quand le refus est certain (template système `isBuiltin`) — même
 * précédent que delete_column sur la colonne système « Bloqué ».
 */
export function buildTemplateTools(ctx: AuthContext): ToolSpec[] {
  return [
    defineTool({
      name: 'create_template',
      description:
        'Crée un template Kanban réutilisable. Modifier un template plus tard n’impacte pas les projets existants (les colonnes sont copiées à la création du projet).',
      inputSchema: CreateTemplateInputSchema,
      jsonSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', maxLength: TEMPLATE_NAME_RAW_MAX },
          columns: columnsJson,
        },
        required: ['name', 'columns'],
      },
      handler: async (input) =>
        safeMutation('create_template', async () => {
          const columns = input.columns.map((c) => ({
            name: c.name,
            stepChecklist: c.stepChecklist ?? [],
          }));
          const result = await createKanbanTemplate({ name: input.name, columns });
          if (!result.ok) return failure(result.message);
          return JSON.stringify({ created: true, templateId: result.id });
        }),
    }),

    defineTool({
      name: 'update_template',
      description:
        'Remplace le nom ET les colonnes d’un template Kanban existant (les deux champs sont requis — fournir le nom ET la liste complète des colonnes, l’existant est remplacé). Modifier un template n’impacte pas les projets déjà créés à partir de lui.',
      inputSchema: UpdateTemplateInputSchema,
      jsonSchema: {
        type: 'object',
        properties: {
          templateId: UUID_JSON,
          name: { type: 'string', maxLength: TEMPLATE_NAME_RAW_MAX },
          columns: columnsJson,
        },
        required: ['templateId', 'name', 'columns'],
      },
      handler: async (input) =>
        safeMutation('update_template', async () => {
          const columns = input.columns.map((c) => ({
            name: c.name,
            stepChecklist: c.stepChecklist ?? [],
          }));
          const result = await updateKanbanTemplate({
            id: input.templateId,
            name: input.name,
            columns,
          });
          if (!result.ok) return failure(result.message);

          // Lecture-après-écriture : le post-état est RELU (workspace-scopé)
          // plutôt qu'assemblé depuis l'input, même rationnel que
          // update_client (spec V2 §3.1).
          const after = await prisma.kanbanTemplate.findFirst({
            where: { id: input.templateId, workspaceId: ctx.workspaceId },
            select: {
              name: true,
              columns: { orderBy: { position: 'asc' }, select: { name: true } },
            },
          });
          if (after === null) return failure('Template introuvable après la mise à jour.');
          return JSON.stringify({
            updated: true,
            name: after.name,
            columns: after.columns.map((c) => ({ name: c.name })),
          });
        }),
    }),

    defineTool({
      name: 'delete_template',
      description:
        'Supprime un template Kanban. Les templates système ne peuvent pas être supprimés. Les projets déjà créés à partir de ce template ne sont pas affectés (colonnes copiées à leur création). Action sensible : confirmation utilisateur requise.',
      inputSchema: DeleteTemplateInputSchema,
      jsonSchema: {
        type: 'object',
        properties: { templateId: UUID_JSON },
        required: ['templateId'],
      },
      gated: true,
      // Anti-spoofing (types.ts) : l'input arrive BRUT, avant validation Zod
      // du registry — re-parse local obligatoire. Le nom et le statut
      // `isBuiltin` affichés dans le dialog sont RELUS en DB, scopés au
      // workspace courant via la closure `ctx`.
      describeForConfirm: async (input: unknown) => {
        const parsed = DeleteTemplateInputSchema.safeParse(input);
        if (!parsed.success) return DELETE_NOT_FOUND;

        const tpl = await prisma.kanbanTemplate.findFirst({
          where: { id: parsed.data.templateId, workspaceId: ctx.workspaceId },
          select: { name: true, isBuiltin: true },
        });
        if (tpl === null) return DELETE_NOT_FOUND;

        if (tpl.isBuiltin) {
          // Phrase DÉCLARATIVE, pas une question : le core refusera
          // toujours (`deleteKanbanTemplate` — « Les templates système ne
          // peuvent pas être supprimés. ») — même précédent que
          // delete_column sur la colonne système « Bloqué » / delete_client
          // avec projets actifs.
          return `Le template « ${tpl.name} » est un template système — la suppression sera refusée.`;
        }

        return `Supprimer le template « ${tpl.name} » ? Les projets existants ne seront pas affectés (colonnes copiées à leur création).`;
      },
      handler: async (input) =>
        safeMutation('delete_template', async () => {
          const result = await deleteKanbanTemplate({ id: input.templateId });
          return result.ok ? 'Template supprimé.' : failure(result.message);
        }),
    }),
  ];
}
