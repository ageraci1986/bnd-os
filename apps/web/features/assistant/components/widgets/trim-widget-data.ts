/**
 * Nombre de cartes conservées par colonne dans la donnée STOCKÉE d'un widget
 * board — aligné sur ce que `BoardWidget` affiche (`CARDS_SHOWN_PER_COLUMN`).
 * Le tool serveur peut renvoyer jusqu'à 100 cartes/colonne : sans trim, chaque
 * message commité porterait ce JSON complet en mémoire pour toute la session.
 */
export const CARDS_KEPT_PER_COLUMN = 5;

/**
 * Réduit la donnée d'un événement `tool_result` à ce que son widget affiche,
 * avant stockage dans l'état du chat. Aujourd'hui seul `get_project_board`
 * est trimé : chaque colonne garde ses `CARDS_KEPT_PER_COLUMN` premières
 * cartes, et le total d'origine est préservé dans `totalCards` pour que
 * `BoardWidget` continue d'afficher le compteur et « +N autres » exacts.
 *
 * Helper pur et défensif : une shape inattendue est renvoyée telle quelle
 * (le parse Zod du widget tranchera au rendu), jamais d'exception.
 */
export function trimWidgetData(tool: string, data: unknown): unknown {
  if (tool !== 'get_project_board') return data;
  if (typeof data !== 'object' || data === null) return data;
  const board = data as { readonly columns?: unknown };
  if (!Array.isArray(board.columns)) return data;
  return {
    ...board,
    columns: board.columns.map((column: unknown) => {
      if (typeof column === 'object' && column !== null) {
        const cards = (column as { readonly cards?: unknown }).cards;
        if (Array.isArray(cards) && cards.length > CARDS_KEPT_PER_COLUMN) {
          return {
            ...column,
            cards: cards.slice(0, CARDS_KEPT_PER_COLUMN),
            totalCards: cards.length,
          };
        }
      }
      return column;
    }),
  };
}
