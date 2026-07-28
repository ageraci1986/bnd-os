import type { z } from 'zod';

/** Rôles workspace, alignés sur `Role` de @nexushub/domain (copiés pour rester sans dépendance). */
export type AgentRole = 'admin' | 'user' | 'viewer';

/** Un message du fil, côté provider. `content` : string (texte simple) ou blocs bruts (tool_use / tool_result). */
export interface ChatMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string | readonly Record<string, unknown>[];
}

/** Définition d'un tool telle qu'envoyée au provider (format API Anthropic). */
export interface ProviderToolDef {
  readonly name: string;
  readonly description: string;
  readonly input_schema: Record<string, unknown>;
}

export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
}

/**
 * Contrat du seam provider : `toolCalls` doit refléter exactement les blocs
 * `tool_use` présents dans `content` (mêmes ids, même ordre) — la validité de
 * l'historique construit par la boucle en dépend (chaque tool_use doit recevoir
 * son tool_result, y compris sur un arrêt tronqué type max_tokens).
 */
export interface ProviderTurnResult {
  /** Blocs de contenu assistant, prêts à être réinjectés dans l'historique. */
  readonly content: readonly Record<string, unknown>[];
  readonly text: string;
  readonly stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' | 'other';
  readonly toolCalls: readonly ToolCall[];
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/** Seam provider : la seule interface que le cerveau connaît. Implémentée dans apps/web (SDK Anthropic). */
export interface Provider {
  streamTurn(opts: {
    readonly system: string;
    readonly messages: readonly ChatMessage[];
    readonly tools: readonly ProviderToolDef[];
    readonly onText?: (chunk: string) => void;
    /** Annulation amont (ex: client SSE déconnecté) — le provider doit interrompre la requête. */
    readonly signal?: AbortSignal;
  }): Promise<ProviderTurnResult>;
}

/**
 * Un tool : validation Zod côté exécution + JSON Schema écrit à la main pour le
 * provider (Zod v3 ne sait pas émettre du JSON Schema — les deux doivent décrire
 * la même forme).
 */
export interface ToolSpec {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: z.ZodType<unknown>;
  readonly jsonSchema: Record<string, unknown>;
  /** true = exécution soumise à confirmation explicite (un oui = une exécution). */
  readonly gated: boolean;
  /** true = réservé au rôle admin ; refus propre sinon, sans exécution. */
  readonly adminOnly: boolean;
  /**
   * Paramètre typé `never` (variance contravariante) pour qu'un handler concret
   * `(input: T) => Promise<string>` soit assignable ici. Construire les tools via
   * `defineTool()` (registry.ts), qui vérifie handler ↔ inputSchema et porte
   * l'unique cast.
   */
  readonly handler: (input: never) => Promise<string>;
  /**
   * Description humaine de l'action pour le dialog de confirmation ; à défaut,
   * `describeAction` générique (run-turn.ts) est utilisée.
   * Contrat : montrable et concise — elle transite en clair côté client (SSE).
   * Ne jamais y mettre plus que ce que l'utilisateur voit déjà (pas de corps
   * de message brut, pas de tokens) ; l'audit ne journalise que le nom du tool.
   */
  readonly describeForConfirm?: (input: never) => string | Promise<string>;
}

/** Événements émis pendant un tour, consommés par les adaptateurs (SSE, tests). */
export type AgentEvent =
  | { readonly type: 'tool_start'; readonly name: string }
  | {
      readonly type: 'tool_end';
      readonly name: string;
      readonly isError: boolean;
      readonly output: string;
    }
  | { readonly type: 'confirm_request'; readonly tool: string; readonly description: string };

/** Demande de confirmation : description humaine + nom du tool → oui/non. */
export type Confirmer = (description: string, tool: string) => Promise<boolean>;
