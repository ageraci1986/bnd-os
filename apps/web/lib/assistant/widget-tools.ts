/**
 * Source de vérité unique des noms de tools de lecture dont la sortie JSON
 * est assez structurée pour être rendue en widget déterministe dans le fil
 * de discussion (au lieu de texte brut).
 *
 * Consommé par :
 * - la route `/api/assistant/chat` (whitelist d'émission de l'événement SSE `tool_result`) ;
 * - le dispatcher client `features/assistant/components/widgets/index.tsx` (`renderWidget`).
 *
 * Module volontairement sans dépendance (pas de `server-only`, pas de Prisma,
 * pas de React) : importable aussi bien côté serveur que côté client. Surface
 * minimale : le garde `isWidgetTool` est le seul point d'entrée.
 */
const WIDGET_TOOLS = [
  'get_today_overview',
  'get_project_board',
  'search_mails',
  'list_projects',
] as const;

export type WidgetTool = (typeof WIDGET_TOOLS)[number];

const WIDGET_TOOL_SET: ReadonlySet<string> = new Set(WIDGET_TOOLS);

export function isWidgetTool(name: string): name is WidgetTool {
  return WIDGET_TOOL_SET.has(name);
}
