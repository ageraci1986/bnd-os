import type { StreamWidget } from '../../lib/sse';

/** projectId d'un widget board, ou null si la donnée n'a pas la forme attendue. */
function boardProjectId(widget: StreamWidget): string | null {
  if (widget.tool !== 'get_project_board') return null;
  const data: unknown = widget.data;
  if (typeof data !== 'object' || data === null) return null;
  const id = (data as { id?: unknown }).id;
  return typeof id === 'string' ? id : null;
}

/** Les deux tools dont la sortie alimente `MailDraftWidget` (mail-tools.ts). */
const MAIL_DRAFT_TOOLS = new Set(['create_mail_draft', 'prepare_reply_draft']);

/**
 * True si le widget est un brouillon mail (`create_mail_draft` ou
 * `prepare_reply_draft`) — un seul brouillon existe par utilisateur
 * (mail-drafts.ts, upsert), donc un seul widget de brouillon a de sens dans
 * le fil à un instant donné, quel que soit le tool exact qui l'a produit.
 */
function isMailDraftWidget(widget: StreamWidget): boolean {
  return MAIL_DRAFT_TOOLS.has(widget.tool);
}

/**
 * Ajoute un widget au fil en garantissant qu'un seul board par projet est
 * affiché : l'état le plus récent remplace l'ancien (spec V2 §3.2 — un board
 * périmé ne peut plus contredire le texte de l'agent). Même garantie pour les
 * brouillons mail (Plan 5c Task 6) : `create_mail_draft` et
 * `prepare_reply_draft` partagent un seul brouillon persisté par utilisateur
 * — un nouveau brouillon (même produit par l'autre tool) remplace l'ancien
 * widget plutôt que d'en afficher deux qui prétendraient représenter des
 * brouillons distincts. Le remplacement se fait EN PLACE (même position dans
 * le fil) : déplacer le widget rafraîchi en fin de liste provoquerait un saut
 * de layout visible pendant le streaming. Les autres widgets sont ajoutés
 * tels quels.
 */
export function appendWidget(
  widgets: readonly StreamWidget[],
  incoming: StreamWidget,
): StreamWidget[] {
  const incomingProject = boardProjectId(incoming);
  if (incomingProject !== null) {
    const idx = widgets.findIndex((w) => boardProjectId(w) === incomingProject);
    if (idx === -1) return [...widgets, incoming];
    const next = [...widgets];
    next[idx] = incoming;
    return next;
  }
  if (isMailDraftWidget(incoming)) {
    const idx = widgets.findIndex((w) => isMailDraftWidget(w));
    if (idx === -1) return [...widgets, incoming];
    const next = [...widgets];
    next[idx] = incoming;
    return next;
  }
  return [...widgets, incoming];
}
