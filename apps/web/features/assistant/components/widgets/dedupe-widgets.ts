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
 * périmé ne peut plus contredire le texte de l'agent). Le remplacement se
 * fait EN PLACE (même position dans le fil) : déplacer le board rafraîchi en
 * fin de liste provoquerait un saut de layout visible pendant le streaming.
 * Les autres widgets sont ajoutés tels quels.
 */
export function appendWidget(
  widgets: readonly StreamWidget[],
  incoming: StreamWidget,
): StreamWidget[] {
  const incomingProject = boardProjectId(incoming);
  if (incomingProject === null) return [...widgets, incoming];
  const idx = widgets.findIndex((w) => boardProjectId(w) === incomingProject);
  if (idx === -1) return [...widgets, incoming];
  const next = [...widgets];
  next[idx] = incoming;
  return next;
}
