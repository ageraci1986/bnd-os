import 'server-only';

import { z } from 'zod';
import { defineTool, type ToolSpec } from '@nexushub/agent';
import type { AuthContext } from '@/lib/auth';
import {
  MEMORY_FACT_MAX_CHARS,
  forgetFact,
  rememberFact,
  updateFact,
} from '@/lib/assistant/memory';
import { safeMutation } from './safe-wrappers';

const NAME_MAX_CHARS = 80;

const factField = z.string().trim().min(1).max(MEMORY_FACT_MAX_CHARS);
const FACT_JSON = {
  type: 'string',
  maxLength: MEMORY_FACT_MAX_CHARS,
  description: 'Le fait, en langage naturel, une seule idée par fait',
} as const;

const nameField = z.string().min(1).max(NAME_MAX_CHARS);
const NAME_JSON = {
  type: 'string',
  maxLength: NAME_MAX_CHARS,
  description: 'Nom (slug) du fait existant à modifier — voir la liste dans le system prompt',
} as const;

/** Reformule un échec `{ok:false, message}` en message montrable. */
function failure(message: string): string {
  return `Échec : ${message}`;
}

/**
 * Tools mémoire (Plan 3a Task 3). Wrappent les cores `memory.ts` — aucune
 * logique métier ici, uniquement la traduction schéma Zod ↔ résultat `{ok}`
 * ↔ message montrable. Aucun tool ⚡ n'est `gated` : la mémoire est interne
 * et réversible (l'onglet Mémoire permet de corriger/supprimer à la main),
 * contrairement à `send_mail` ou `delete_card`. `ctx` est lié à la
 * construction (jamais fourni par le modèle) : voir `tools/index.ts`.
 */
export function buildMemoryTools(ctx: AuthContext): ToolSpec[] {
  return [
    defineTool({
      name: 'remember_fact',
      description:
        "Enregistre un fait durable sur l'utilisateur (préférence, décision, contexte) pour s'en souvenir dans les prochaines conversations. PAS les infos déjà en base (projets, cartes, clients — celles-ci sont accessibles via les autres tools) ni les détails éphémères (contenu d'un message ponctuel, question du jour).",
      inputSchema: z.object({ fact: factField }),
      jsonSchema: {
        type: 'object',
        properties: { fact: FACT_JSON },
        required: ['fact'],
      },
      handler: async (input) =>
        safeMutation('remember_fact', async () => {
          const result = await rememberFact(ctx, input.fact);
          if (!result.ok) return failure(result.message);
          return JSON.stringify({ remembered: true, name: result.name });
        }),
    }),

    defineTool({
      name: 'update_fact',
      description:
        "Corrige le fait mémorisé sous un nom existant (voir la liste des faits dans le system prompt). Utiliser quand un fait a changé plutôt que d'en créer un nouveau proche.",
      inputSchema: z.object({ name: nameField, fact: factField }),
      jsonSchema: {
        type: 'object',
        properties: { name: NAME_JSON, fact: FACT_JSON },
        required: ['name', 'fact'],
      },
      handler: async (input) =>
        safeMutation('update_fact', async () => {
          const result = await updateFact(ctx, input.name, input.fact);
          if (!result.ok) return failure(result.message);
          return JSON.stringify({ updated: true });
        }),
    }),

    defineTool({
      name: 'forget_fact',
      description:
        "Supprime un fait mémorisé, par son nom (voir la liste des faits dans le system prompt). Utiliser quand un fait n'est plus pertinent.",
      inputSchema: z.object({ name: nameField }),
      jsonSchema: {
        type: 'object',
        properties: { name: NAME_JSON },
        required: ['name'],
      },
      handler: async (input) =>
        safeMutation('forget_fact', async () => {
          const result = await forgetFact(ctx, input.name);
          if (!result.ok) return failure(result.message);
          return JSON.stringify({ forgotten: true });
        }),
    }),
  ];
}
