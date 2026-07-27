import type { z } from 'zod';
import type { ProviderToolDef, ToolSpec } from './types';

export interface ExecuteResult {
  readonly output: string;
  readonly isError: boolean;
}

export interface DefineToolInput<T> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: z.ZodType<T>;
  readonly jsonSchema: Record<string, unknown>;
  readonly gated?: boolean;
  readonly adminOnly?: boolean;
  /**
   * Contrat : tout message qui s'échappe du handler (throw compris) doit être
   * montrable à l'utilisateur — attraper et reformuler les erreurs internes
   * (DB, réseau) avant de les laisser remonter.
   */
  readonly handler: (input: T) => Promise<string>;
  /**
   * Description humaine de l'action pour le dialog de confirmation ; à défaut,
   * `describeAction` générique (run-turn.ts) est utilisée.
   */
  readonly describeForConfirm?: (input: T) => string;
}

/**
 * Fabrique type-safe d'un ToolSpec : le handler est vérifié contre le schéma Zod
 * du tool, et l'unique cast vers `ToolSpec['handler']` (paramètre `never`) vit ici,
 * pas dans chaque définition de tool.
 */
export function defineTool<T>(spec: DefineToolInput<T>): ToolSpec {
  return {
    name: spec.name,
    description: spec.description,
    inputSchema: spec.inputSchema,
    jsonSchema: spec.jsonSchema,
    gated: spec.gated ?? false,
    adminOnly: spec.adminOnly ?? false,
    handler: spec.handler as ToolSpec['handler'],
    ...(spec.describeForConfirm !== undefined
      ? {
          describeForConfirm: spec.describeForConfirm as NonNullable<
            ToolSpec['describeForConfirm']
          >,
        }
      : {}),
  };
}

/**
 * Toutes les capacités de l'agent, en un endroit extensible.
 * Une exécution ne crashe jamais la conversation : toute défaillance revient
 * au modèle en texte clair avec `isError: true`.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, ToolSpec>();

  register(spec: ToolSpec): void {
    if (this.tools.has(spec.name)) {
      throw new Error(`duplicate tool name: ${spec.name}`);
    }
    this.tools.set(spec.name, spec);
  }

  get(name: string): ToolSpec | null {
    return this.tools.get(name) ?? null;
  }

  names(): readonly string[] {
    return [...this.tools.keys()];
  }

  toProviderTools(): readonly ProviderToolDef[] {
    return [...this.tools.values()].map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.jsonSchema,
    }));
  }

  async execute(name: string, rawInput: unknown): Promise<ExecuteResult> {
    const spec = this.tools.get(name);
    if (spec === undefined) {
      return { output: `Erreur : aucun tool nommé « ${name} » n'existe.`, isError: true };
    }
    const parsed = spec.inputSchema.safeParse(rawInput);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => i.message).join(' ; ');
      return { output: `Erreur : entrées invalides pour ${name} : ${issues}`, isError: true };
    }
    try {
      const output = await spec.handler(parsed.data as never);
      return { output, isError: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { output: `Erreur pendant ${name} : ${message}`, isError: true };
    }
  }
}
