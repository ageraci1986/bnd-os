import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { BoardWidget } from './board-widget';

/**
 * Mini-Kanban pour `get_project_board` (Plan 4 Task 6, `board-widget.tsx`).
 *
 * Story bonus en plus des 4 widgets requis par le plan : `BoardWidget` est un
 * composant pur (aucune Server Action, seulement `next/link`), donc gratuit
 * à storifier une fois `.storybook/main.ts` en place — contrairement à
 * `MailListWidget`/`MailDraftWidget` (voir leurs stories et
 * `.storybook/mocks/`), il ne nécessite aucun mock.
 */
const meta = {
  title: 'Assistant/Widgets/BoardWidget',
  component: BoardWidget,
  parameters: {
    layout: 'padded',
    nextjs: { appDirectory: true },
  },
} satisfies Meta<typeof BoardWidget>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Colonnes nominales, dont une "Bloqué" (CLAUDE.md §6.3) avec une échéance dépassée. */
export const Nominal: Story = {
  args: {
    data: {
      id: 'project-1',
      name: 'Refonte site vitrine — Acme',
      columns: [
        {
          id: 'col-todo',
          name: 'À faire',
          blocked: false,
          cards: [
            { id: 'card-1', title: 'Rédiger le brief contenu', due: '2026-08-02T00:00:00.000Z' },
            { id: 'card-2', title: 'Choisir la palette', due: null },
          ],
        },
        {
          id: 'col-progress',
          name: 'En cours',
          blocked: false,
          cards: [
            {
              id: 'card-3',
              title: 'Intégration page d’accueil',
              due: '2026-08-05T00:00:00.000Z',
            },
          ],
        },
        {
          id: 'col-blocked',
          name: 'Bloqué',
          blocked: true,
          cards: [
            {
              id: 'card-4',
              title: 'Validation juridique mentions légales',
              due: '2026-07-20T00:00:00.000Z',
            },
          ],
        },
      ],
    },
  },
};

/** Colonne tronquée (> 5 cartes) — vérifie le compteur « +N autres (liste partielle) ». */
export const TruncatedColumn: Story = {
  args: {
    data: {
      id: 'project-2',
      name: 'Migration CRM',
      columns: [
        {
          id: 'col-todo',
          name: 'À faire',
          blocked: false,
          truncated: true,
          totalCards: 12,
          cards: Array.from({ length: 5 }, (_, i) => ({
            id: `card-${i + 1}`,
            title: `Tâche de migration #${i + 1}`,
            due: null,
          })),
        },
      ],
    },
  },
};
