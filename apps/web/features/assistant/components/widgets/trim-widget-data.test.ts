import { describe, expect, it } from 'vitest';
import { CARDS_KEPT_PER_COLUMN, trimWidgetData } from './trim-widget-data';

function boardWithCards(count: number) {
  return {
    id: 'p1',
    name: 'Refonte',
    columns: [
      {
        id: 'c1',
        name: 'À faire',
        blocked: false,
        cards: Array.from({ length: count }, (_, i) => ({
          id: `card-${i}`,
          title: `Carte ${i}`,
          due: null,
        })),
      },
    ],
  };
}

describe('trimWidgetData', () => {
  it('réduit un board à 5 cartes par colonne en préservant le total dans totalCards', () => {
    const trimmed = trimWidgetData('get_project_board', boardWithCards(100)) as {
      name: string;
      columns: { cards: { id: string }[]; totalCards?: number; name: string }[];
    };
    expect(trimmed.columns[0]?.cards).toHaveLength(CARDS_KEPT_PER_COLUMN);
    expect(trimmed.columns[0]?.cards[0]?.id).toBe('card-0');
    expect(trimmed.columns[0]?.totalCards).toBe(100);
    // Les autres champs de la colonne et du board sont préservés.
    expect(trimmed.columns[0]?.name).toBe('À faire');
    expect(trimmed.name).toBe('Refonte');
  });

  it('préserve le vrai totalCards du tool (Task 6, via _count) plutôt que de le dériver de cards.length', () => {
    // Régression : le tool peut désormais renvoyer un total réel supérieur au
    // plafond de 100 cartes fetchées (ex. 140 cartes en base, 100 renvoyées).
    // Avant ce correctif, le trim écrasait ce total avec `cards.length`
    // (=100), perdant l'information.
    const board = boardWithCards(100);
    (board.columns[0] as { totalCards?: number }).totalCards = 140;
    const trimmed = trimWidgetData('get_project_board', board) as {
      columns: { totalCards?: number }[];
    };
    expect(trimmed.columns[0]?.totalCards).toBe(140);
  });

  it('laisse intacte une colonne déjà sous la limite (même référence)', () => {
    const board = boardWithCards(3);
    const trimmed = trimWidgetData('get_project_board', board) as {
      columns: unknown[];
    };
    expect(trimmed.columns[0]).toBe(board.columns[0]);
    expect((trimmed.columns[0] as { totalCards?: number }).totalCards).toBeUndefined();
  });

  it('laisse passer les autres tools inchangés (même référence)', () => {
    const data = { blockedCards: 1, dueTodayCards: 0, unreadMails: 0, unreadNotifications: 0 };
    expect(trimWidgetData('get_today_overview', data)).toBe(data);
  });

  it('renvoie telle quelle une shape inattendue, sans lever', () => {
    expect(trimWidgetData('get_project_board', null)).toBeNull();
    expect(trimWidgetData('get_project_board', 'texte')).toBe('texte');
    const noColumns = { id: 'p1', name: 'X' };
    expect(trimWidgetData('get_project_board', noColumns)).toBe(noColumns);
    const badColumns = { id: 'p1', columns: 'oops' };
    expect(trimWidgetData('get_project_board', badColumns)).toBe(badColumns);
  });
});
