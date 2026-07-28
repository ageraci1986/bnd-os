import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { MailListWidget } from './mail-list-widget';

/**
 * Liste de mails pour `search_mails` (Plan 4 Task 6, `mail-list-widget.tsx`).
 *
 * Story volontairement READ-ONLY (pas de prop `actions`) : sans elle, le
 * widget n'affiche ni « Tout marquer lu » ni les pills Répondre/Transférer/
 * Archiver/Supprimer (elles dépendent de `actions.sendMessage`, câblé par
 * `assistant-chat.tsx` — hors périmètre Storybook, pas de chat ici).
 *
 * Pas de story "dépliée" : cliquer une ligne appelle `fetchMailBody`
 * (`@/features/communications/actions/fetch-mail-body`), une Server Action
 * `'use server'`. `.storybook/main.ts` mocks that module (and its siblings —
 * see `.storybook/mocks/`) purely so the widget's TOP-LEVEL import doesn't
 * crash the browser bundle by pulling in `@nexushub/db`/Prisma — the mock
 * still just returns `{ ok: false }`, so an expanded row would show a static
 * "contenu du mail non disponible" message, not real content. Not worth a
 * dedicated story here: this component stays props-only/no-interaction per
 * this plan's scope (no `play` functions), and the list-level story below
 * never clicks a row.
 */
const meta = {
  title: 'Assistant/Widgets/MailListWidget',
  component: MailListWidget,
  parameters: {
    layout: 'padded',
    nextjs: { appDirectory: true },
  },
} satisfies Meta<typeof MailListWidget>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 3 mails, 2 non lus — données conformes au schéma `MailRowSchema` interne. */
export const ThreeMailsTwoUnread: Story = {
  args: {
    data: [
      {
        id: 'mail-1',
        subject: 'Point client — validation maquettes',
        fromEmail: 'julie.martin@client-acme.fr',
        fromName: 'Julie Martin',
        receivedAt: '2026-07-28T08:12:00.000Z',
        isRead: false,
        folder: 'INBOX',
        integrationId: 'integration-1',
      },
      {
        id: 'mail-2',
        subject: 'Facture #4521 en retard',
        fromEmail: 'compta@fournisseur.example',
        fromName: 'Comptabilité Fournisseur',
        receivedAt: '2026-07-27T16:45:00.000Z',
        isRead: false,
        folder: 'INBOX',
        integrationId: 'integration-1',
      },
      {
        id: 'mail-3',
        subject: null,
        fromEmail: 'no-reply@service-notifications.example',
        fromName: null,
        receivedAt: '2026-07-26T09:00:00.000Z',
        isRead: true,
        folder: 'INBOX',
      },
    ],
  },
};
