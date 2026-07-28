import type { StreamWidget } from '../../lib/sse';

/** projectId d'un widget board, ou null si la donnée n'a pas la forme attendue. */
function boardProjectId(widget: StreamWidget): string | null {
  if (widget.tool !== 'get_project_board') return null;
  const data: unknown = widget.data;
  if (typeof data !== 'object' || data === null) return null;
  const id = (data as { id?: unknown }).id;
  return typeof id === 'string' ? id : null;
}

/**
 * Ajoute un widget au fil en garantissant qu'un seul board par projet est
 * affiché : l'état le plus récent remplace l'ancien (spec V2 §3.2 — un board
 * périmé ne peut plus contredire le texte de l'agent). Les autres widgets
 * sont ajoutés tels quels.
 */
export function appendWidget(
  widgets: readonly StreamWidget[],
  incoming: StreamWidget,
): StreamWidget[] {
  const incomingProject = boardProjectId(incoming);
  if (incomingProject === null) return [...widgets, incoming];
  return [...widgets.filter((w) => boardProjectId(w) !== incomingProject), incoming];
}
