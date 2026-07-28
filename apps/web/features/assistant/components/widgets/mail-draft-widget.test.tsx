import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

// Vitest hoists vi.mock above all imports — closures must go through
// vi.hoisted() (même convention que compose-panel.test.tsx / mail-list-widget.test.tsx).
const { saveDraftSpy } = vi.hoisted(() => ({ saveDraftSpy: vi.fn() }));
vi.mock('@/features/communications/actions/mail-drafts', () => ({
  saveDraft: (...a: unknown[]) => saveDraftSpy(...a),
}));

// RecipientField appelle searchRecipients sur un debounce interne de 150ms —
// sous fake timers ce debounce serait lui aussi avancé par
// `advanceTimersByTimeAsync`. Mocké pour éviter tout appel réseau réel dans
// ces tests (même garde que recipient-field.test.tsx).
vi.mock('@/features/communications/actions/search-recipients', () => ({
  searchRecipients: vi.fn(async () => ({ ok: true, suggestions: [] })),
}));

import { MailDraftWidget, textToDraftHtml, type MailDraftWidgetProps } from './mail-draft-widget';
import type { WidgetActions } from './index';

const BASE_DATA = {
  kind: 'new_mail' as const,
  to: ['dest@acme.com'],
  cc: [] as string[],
  bcc: [] as string[],
  subject: 'Objet',
  bodyText: 'Bonjour',
  replyToId: null,
  fromIntegrationId: 'int-1',
};

function actionsOf(overrides: Partial<WidgetActions> = {}): WidgetActions {
  return { sendMessage: vi.fn(), busy: false, ...overrides };
}

function renderWidget(overrides: Partial<MailDraftWidgetProps> = {}) {
  const props: MailDraftWidgetProps = { data: BASE_DATA, ...overrides };
  return render(<MailDraftWidget {...props} />);
}

function subjectInput(): HTMLElement {
  return screen.getByLabelText('Objet');
}

function bodyInput(): HTMLElement {
  return screen.getByLabelText('Corps du message');
}

/** Ordre de montage : À, Cc, Cci (voir mail-draft-widget.tsx). */
function recipientCombobox(index: 0 | 1 | 2): HTMLElement {
  return screen.getAllByRole('combobox')[index] as HTMLElement;
}

beforeEach(() => {
  saveDraftSpy.mockReset();
  saveDraftSpy.mockResolvedValue({ ok: true, id: 'd1' });
});

describe('MailDraftWidget', () => {
  describe('en-tête par kind', () => {
    it.each([
      ['new_mail', 'Nouveau mail'],
      ['reply', 'Réponse'],
      ['reply_all', 'Réponse à tous'],
      ['forward', 'Transfert'],
    ] as const)('kind:%s → « ✏️ Brouillon — %s »', (kind, label) => {
      renderWidget({ data: { ...BASE_DATA, kind, replyToId: kind === 'new_mail' ? null : 'r1' } });
      expect(screen.getByText(`✏️ Brouillon — ${label}`)).toBeInTheDocument();
    });
  });

  describe('sans actions', () => {
    it('lecture seule : champs disabled, aucun bouton', () => {
      renderWidget();
      expect(subjectInput()).toBeDisabled();
      expect(bodyInput()).toBeDisabled();
      expect(recipientCombobox(0)).toBeDisabled();
      expect(screen.queryByText('📤 Envoyer')).not.toBeInTheDocument();
      expect(screen.queryByText('💾 Garder en brouillon')).not.toBeInTheDocument();
    });
  });

  describe('textToDraftHtml (conversion texte → HTML)', () => {
    it('échappe & < > " \' (jamais de HTML interprété)', () => {
      const hostile = 'A & B <script>alert("x")</script> it\'s <b>bold</b>';
      expect(textToDraftHtml(hostile)).toBe(
        '<p>A &amp; B &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; it&#39;s &lt;b&gt;bold&lt;/b&gt;</p>',
      );
    });

    it('double saut de ligne → paragraphes, saut simple → <br>', () => {
      expect(textToDraftHtml('Salut,\n\nÇa va ?\nBien et toi ?')).toBe(
        '<p>Salut,</p><p>Ça va ?<br>Bien et toi ?</p>',
      );
    });

    it('texte vide → paragraphe vide (pas de crash, corps non-vide pour le composer)', () => {
      expect(textToDraftHtml('')).toBe('<p><br></p>');
      expect(textToDraftHtml('   ')).toBe('<p><br></p>');
    });
  });

  describe('autosave debouncé', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('plusieurs éditions rapides (destinataires/objet/corps) → un seul appel saveDraft après 2000ms, payload exact', async () => {
      renderWidget({ actions: actionsOf() });

      // Trois frappes successives sur l'objet — seule la dernière compte.
      fireEvent.change(subjectInput(), { target: { value: 'N' } });
      fireEvent.change(subjectInput(), { target: { value: 'No' } });
      fireEvent.change(subjectInput(), { target: { value: 'Nouvel objet' } });

      fireEvent.change(bodyInput(), { target: { value: 'Salut,\n\nÇa va ?' } });

      const cc = recipientCombobox(1);
      fireEvent.change(cc, { target: { value: 'new@acme.com' } });
      fireEvent.keyDown(cc, { key: 'Enter' });

      expect(saveDraftSpy).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });

      expect(saveDraftSpy).toHaveBeenCalledTimes(1);
      expect(saveDraftSpy).toHaveBeenCalledWith({
        fromIntegrationId: 'int-1',
        kind: 'new_mail',
        toRecipients: ['dest@acme.com'],
        ccRecipients: ['new@acme.com'],
        bccRecipients: [],
        subject: 'Nouvel objet',
        bodyHtml: '<p>Salut,</p><p>Ça va ?</p>',
      });
    });

    it('inclut replyToId quand non-null (kind reply)', async () => {
      renderWidget({
        data: { ...BASE_DATA, kind: 'reply', replyToId: 'reply-1' },
        actions: actionsOf(),
      });
      fireEvent.change(subjectInput(), { target: { value: 'Re: Objet' } });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });

      expect(saveDraftSpy).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'reply', replyToId: 'reply-1' }),
      );
    });

    it('indicateur : « … » pendant, « ✓ sauvegardé » une fois le save résolu', async () => {
      renderWidget({ actions: actionsOf() });
      fireEvent.change(subjectInput(), { target: { value: 'Nouvel objet' } });

      expect(screen.getByRole('status').textContent).toBe('…');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });

      expect(screen.getByRole('status').textContent).toBe('✓ sauvegardé');
    });

    it('échec de saveDraft (ok:false) → indicateur d’échec, sans crash', async () => {
      saveDraftSpy.mockResolvedValue({ ok: false, message: 'Impossible d’enregistrer.' });
      renderWidget({ actions: actionsOf() });
      fireEvent.change(subjectInput(), { target: { value: 'Nouvel objet' } });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });

      expect(screen.getByRole('status').textContent).toBe('échec de sauvegarde');
    });
  });

  describe('Envoyer', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('flush AVANT sendMessage (ordre) : saveDraft attendu puis sendMessage — jamais avant', async () => {
      let resolveSave!: (v: { ok: true; id: string }) => void;
      saveDraftSpy.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveSave = resolve;
          }),
      );
      const sendMessage = vi.fn();
      renderWidget({ actions: actionsOf({ sendMessage }) });

      fireEvent.change(subjectInput(), { target: { value: 'Nouvel objet' } });
      // Édition en attente de debounce (pas encore en vol) — le clic doit
      // déclencher le save immédiatement plutôt qu'attendre 2000ms.
      const sendButton = screen.getByText('📤 Envoyer');

      let clicked!: Promise<void>;
      act(() => {
        clicked = Promise.resolve(fireEvent.click(sendButton)).then(() => undefined);
      });

      // saveDraft démarré, sendMessage pas encore appelé tant qu'il n'est pas résolu.
      await act(async () => {
        await Promise.resolve();
      });
      expect(saveDraftSpy).toHaveBeenCalledTimes(1);
      expect(sendMessage).not.toHaveBeenCalled();

      await act(async () => {
        resolveSave({ ok: true, id: 'd1' });
        await clicked;
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(sendMessage).toHaveBeenCalledWith('Envoie le brouillon actuel (send_draft)');
    });

    it('message exact envoyé au chat, aucun champ du brouillon dedans', async () => {
      saveDraftSpy.mockResolvedValue({ ok: true, id: 'd1' });
      const sendMessage = vi.fn();
      renderWidget({ actions: actionsOf({ sendMessage }) });

      await act(async () => {
        fireEvent.click(screen.getByText('📤 Envoyer'));
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(sendMessage).toHaveBeenCalledWith('Envoie le brouillon actuel (send_draft)');
    });

    it('busy:true → boutons désactivés', () => {
      renderWidget({ actions: actionsOf({ busy: true }) });
      expect(screen.getByText('📤 Envoyer')).toBeDisabled();
      expect(screen.getByText('💾 Garder en brouillon')).toBeDisabled();
    });

    it('save en vol → boutons désactivés', async () => {
      let resolveSave!: (v: { ok: true; id: string }) => void;
      saveDraftSpy.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveSave = resolve;
          }),
      );
      renderWidget({ actions: actionsOf() });
      fireEvent.change(subjectInput(), { target: { value: 'Nouvel objet' } });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });

      expect(screen.getByText('📤 Envoyer')).toBeDisabled();
      expect(screen.getByText('💾 Garder en brouillon')).toBeDisabled();

      await act(async () => {
        resolveSave({ ok: true, id: 'd1' });
        await Promise.resolve();
      });
      expect(screen.getByText('📤 Envoyer')).not.toBeDisabled();
    });
  });

  describe('Garder en brouillon', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('flush puis note de confirmation, sendMessage jamais appelé', async () => {
      saveDraftSpy.mockResolvedValue({ ok: true, id: 'd1' });
      const sendMessage = vi.fn();
      renderWidget({ actions: actionsOf({ sendMessage }) });
      fireEvent.change(subjectInput(), { target: { value: 'Nouvel objet' } });

      await act(async () => {
        fireEvent.click(screen.getByText('💾 Garder en brouillon'));
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(saveDraftSpy).toHaveBeenCalledTimes(1);
      expect(sendMessage).not.toHaveBeenCalled();
      expect(screen.getByText('Sauvegardé — retrouvable dans Communications.')).toBeInTheDocument();
    });
  });
});
