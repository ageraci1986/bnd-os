import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { MailDraftWidget } from './mail-draft-widget';

/**
 * Brouillon éditable pour `create_mail_draft`/`prepare_reply_draft` (Plan 4
 * Task 6, `mail-draft-widget.tsx`). `MailDraftWidget` always calls
 * `loadDraft()` (a Server Action) on mount — its brouillon DB row is the
 * source of truth, the tool's JSON payload is only a loading-time preview
 * (see the widget's own doc comment). `.storybook/main.ts` mocks that
 * Server Action (and `RecipientField`'s `searchRecipients`) via stubs in
 * `.storybook/mocks/` — real ones pull in `@nexushub/db` (Prisma) at their
 * top level, which cannot run in a browser bundle and crashes the story
 * before React even renders (verified: without the mock, Prisma's generated
 * client tries to load its `.prisma/client/index-browser` entry and the
 * browser's ES module loader rejects the bare specifier — `server-only`
 * itself isn't the culprit, Storybook's Next framework already neutralizes
 * that marker package).
 *
 * The mocked `loadDraft` rejects, so the ONLY reachable, stable state here
 * is the widget's own `'unavailable'` phase: fields disabled, no
 * Envoyer/Garder buttons, `LOAD_FAILED_NOTE` shown. That is genuinely what
 * ships in production if `loadDraft` fails — this story documents that
 * failure state, not a "happy path" edit flow (which would need the DB).
 */
const meta = {
  title: 'Assistant/Widgets/MailDraftWidget',
  component: MailDraftWidget,
  parameters: {
    layout: 'padded',
    nextjs: { appDirectory: true },
  },
} satisfies Meta<typeof MailDraftWidget>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * État atteint après l'échec (simulé) du rechargement du brouillon DB —
 * `data` sert d'aperçu tant que `loadDraft()` n'a pas résolu, donc son
 * contenu reste visible en lecture seule sous le message d'erreur.
 */
export const ReadOnlyAfterLoadFailure: Story = {
  args: {
    data: {
      kind: 'new_mail',
      to: ['julie.martin@client-acme.fr'],
      cc: [],
      bcc: [],
      subject: 'Point client — validation maquettes',
      bodyText: 'Bonjour Julie,\n\nVoici les dernières maquettes pour validation.',
      replyToId: null,
      fromIntegrationId: 'integration-1',
    },
  },
};
