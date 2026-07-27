import type { z } from 'zod';

/**
 * Parse Zod partagé des données d'un événement `tool_result` avant rendu
 * d'un widget. Échec → `null` (le widget ne rend rien, le texte du modèle
 * reste) avec un warn dev pour diagnostiquer un drift de shape entre un
 * tool serveur et son widget — même précédent que le warn de `lib/sse.ts`.
 * Jamais le `data` dans le warn (contenu utilisateur potentiel, CLAUDE.md §4.7).
 */
export function parseWidgetData<S extends z.ZodTypeAny>(
  tool: string,
  schema: S,
  data: unknown,
): z.infer<S> | null {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    console.warn('[assistant] widget data invalide', { tool });
    return null;
  }
  return parsed.data as z.infer<S>;
}
