import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { KpiCards } from './kpi-cards';

/**
 * Rangée de tuiles KPI pour `get_today_overview` (Plan 4 Task 6,
 * `kpi-cards.tsx`). `data` est validé par un schéma Zod interne
 * (`TodayOverviewSchema`) — les stories passent des payloads statiques
 * conformes, pas d'appel réseau.
 */
const meta = {
  title: 'Assistant/Widgets/KpiCards',
  component: KpiCards,
  parameters: {
    layout: 'padded',
  },
} satisfies Meta<typeof KpiCards>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Données nominales — la tuile « Bloquées » passe en rouge dès qu'elle est > 0. */
export const Nominal: Story = {
  args: {
    data: {
      blockedCards: 3,
      dueTodayCards: 1,
      unreadMails: 5,
      unreadNotifications: 2,
    },
  },
};

/** Tout à zéro — aucune tuile en état "danger". */
export const AllZero: Story = {
  args: {
    data: {
      blockedCards: 0,
      dueTodayCards: 0,
      unreadMails: 0,
      unreadNotifications: 0,
    },
  },
};
