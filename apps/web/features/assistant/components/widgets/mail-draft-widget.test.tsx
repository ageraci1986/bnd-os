import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

// Vitest hoists vi.mock above all imports — closures must go through
// vi.hoisted() (même convention que compose-panel.test.tsx / mail-list-widget.test.tsx).
const { saveDraftSpy, loadDraftSpy } = vi.hoisted(() => ({
  saveDraftSpy: vi.fn(),
  loadDraftSpy: vi.fn(),
}));
vi.mock('@/features/communications/actions/mail-drafts', () => ({
  saveDraft: (...a: unknown[]) => saveDraftSpy(...a),
  loadDraft: (...a: unknown[]) => loadDraftSpy(...a),
}));

// RecipientField appelle searchRecipients sur un debounce interne de 150ms —
// sous fake timers ce debounce serait lui aussi avancé par
// `advanceTimersByTimeAsync`. Mocké pour éviter tout appel réseau réel dans
// ces tests (même garde que recipient-field.test.tsx).
vi.mock('@/features/communications/actions/search-recipients', () => ({
  searchRecipients: vi.fn(async () => ({ ok: true, suggestions: [] })),
}));

import {
  MailDraftWidget,
  draftHtmlToText,
  textToDraftHtml,
  type MailDraftWidgetProps,
} from './mail-draft-widget';
import type { WidgetActions } from './index';

/** Sortie structurée du tool (create_mail_draft) — VOLONTAIREMENT différente
 * du brouillon DB ci-dessous : les tests de seed prouvent que le widget
 * affiche l'état DB, pas la projection du tool (revue C1). */
const BASE_DATA = {
  kind: 'new_mail' as const,
  to: ['tool-dest@acme.com'],
  cc: [] as string[],
  bcc: [] as string[],
  subject: 'Objet',
  bodyText: 'Bonjour',
  replyToId: null,
  fromIntegrationId: 'int-tool',
  updatedAt: '2026-07-27T09:00:00.000Z',
};

const DB_ATTACHMENT = {
  id: '4c9d3f0a-2222-4444-8888-aaaaaaaaaaaa',
  filename: 'devis.pdf',
  contentType: 'application/pdf',
  sizeBytes: 1234,
  storagePath: 'w1/u1/devis.pdf',
  sha256: 'a'.repeat(64),
};

/** Brouillon persisté (loadDraft) — la source de vérité seedée dans le widget. */
const DB_DRAFT = {
  id: 'd1',
  fromIntegrationId: 'int-db',
  kind: 'new_mail' as const,
  replyToId: null,
  toRecipients: ['db-dest@acme.com'],
  ccRecipients: ['db-cc@acme.com'],
  bccRecipients: [] as string[],
  subject: 'Objet DB',
  bodyHtml: '<p>Bonjour <b>DB</b></p>',
  composeAttachments: [DB_ATTACHMENT],
  updatedAt: '2026-07-27T10:00:00.000Z',
};

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function actionsOf(overrides: Partial<WidgetActions> = {}): WidgetActions {
  return { sendMessage: vi.fn(), busy: false, ...overrides };
}

function renderWidget(overrides: Partial<MailDraftWidgetProps> = {}) {
  const props: MailDraftWidgetProps = { data: BASE_DATA, ...overrides };
  return render(<MailDraftWidget {...props} />);
}

/** Rend le widget et flushe le seed loadDraft (microtâches — marche sous fake timers). */
async function renderReady(overrides: Partial<MailDraftWidgetProps> = {}) {
  const utils = renderWidget(overrides);
  await act(async () => {
    await Promise.resolve();
  });
  return utils;
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
  loadDraftSpy.mockReset();
  saveDraftSpy.mockResolvedValue({ ok: true, id: 'd1' });
  loadDraftSpy.mockResolvedValue({ ok: true, draft: DB_DRAFT });
});

describe('conversions texte ↔ HTML', () => {
  describe('textToDraftHtml', () => {
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

  describe('draftHtmlToText (DOMParser, fidèle, sans troncature)', () => {
    it('blocs <p>/<div> → lignes vides, <br> → saut de ligne, inline aplati', () => {
      expect(draftHtmlToText('<p>Salut,</p><p>Ça va ?<br>Bien</p>')).toBe(
        'Salut,\n\nÇa va ?\nBien',
      );
      expect(draftHtmlToText('<div>Un<br>Deux</div><p>Trois</p>')).toBe('Un\nDeux\n\nTrois');
      expect(draftHtmlToText('<p>Gras <b>ici</b> et <i>là</i></p>')).toBe('Gras ici et là');
    });

    it('décode les entités UNE seule fois (&amp;amp; → &amp;, jamais &)', () => {
      expect(draftHtmlToText('<p>A &amp; B</p>')).toBe('A & B');
      expect(draftHtmlToText('<p>A &amp;amp; B</p>')).toBe('A &amp; B');
      expect(draftHtmlToText('<p>&lt;b&gt; it&#39;s &quot;q&quot;</p>')).toBe('<b> it\'s "q"');
    });

    it('ne tronque jamais (contenu long intact)', () => {
      const long = 'a'.repeat(10_000);
      expect(draftHtmlToText(`<p>${long}</p>`)).toBe(long);
    });
  });

  it('round-trip stable pinné : texte → HTML → texte → HTML identique (pas de double-échappement)', () => {
    const text = 'Salut,\n\nA & "B" <i> it\'s\nligne2';
    const html = textToDraftHtml(text);
    expect(html).toBe('<p>Salut,</p><p>A &amp; &quot;B&quot; &lt;i&gt; it&#39;s<br>ligne2</p>');
    expect(draftHtmlToText(html)).toBe(text);
    expect(textToDraftHtml(draftHtmlToText(html))).toBe(html);
  });
});

describe('MailDraftWidget', () => {
  describe('seed depuis loadDraft (revue C1 — le brouillon DB fait foi)', () => {
    it('affiche les valeurs DB, pas celles du JSON du tool (destinataires, objet, corps converti)', async () => {
      await renderReady({ actions: actionsOf() });
      expect(loadDraftSpy).toHaveBeenCalledTimes(1);
      expect(subjectInput()).toHaveValue('Objet DB');
      expect(bodyInput()).toHaveValue('Bonjour DB');
      expect(screen.getByText('db-dest@acme.com')).toBeInTheDocument();
      expect(screen.getByText('db-cc@acme.com')).toBeInTheDocument();
      expect(screen.queryByText('tool-dest@acme.com')).not.toBeInTheDocument();
    });

    it.each([
      ['new_mail', 'Nouveau mail'],
      ['reply', 'Réponse'],
      ['reply_all', 'Réponse à tous'],
      ['forward', 'Transfert'],
    ] as const)(
      'kind DB %s → « ✏️ Brouillon — %s » (le kind DB prime sur le JSON du tool)',
      async (kind, label) => {
        loadDraftSpy.mockResolvedValue({
          ok: true,
          draft: { ...DB_DRAFT, kind, replyToId: kind === 'new_mail' ? null : 'r1' },
        });
        await renderReady({ actions: actionsOf() });
        expect(screen.getByText(`✏️ Brouillon — ${label}`)).toBeInTheDocument();
      },
    );

    it('pendant le chargement : aperçu du JSON du tool, champs et boutons désactivés, libellé de chargement', async () => {
      const load = deferred<{ ok: true; draft: typeof DB_DRAFT }>();
      loadDraftSpy.mockImplementation(() => load.promise);
      renderWidget({ actions: actionsOf() });

      expect(screen.getByText('Chargement du brouillon…')).toBeInTheDocument();
      expect(subjectInput()).toBeDisabled();
      expect(subjectInput()).toHaveValue('Objet');
      expect(screen.getByText('📤 Envoyer')).toBeDisabled();
      expect(screen.getByText('💾 Garder en brouillon')).toBeDisabled();

      await act(async () => {
        load.resolve({ ok: true, draft: DB_DRAFT });
        await Promise.resolve();
      });
      expect(subjectInput()).not.toBeDisabled();
      expect(subjectInput()).toHaveValue('Objet DB');
      expect(screen.getByText('📤 Envoyer')).not.toBeDisabled();
    });

    it('loadDraft échoue → lecture seule avec note, sans crash', async () => {
      loadDraftSpy.mockRejectedValue(new Error('boom'));
      await renderReady({ actions: actionsOf() });
      await waitFor(() =>
        expect(
          screen.getByText(
            'Impossible de charger le brouillon — ouvrez Communications pour l’éditer.',
          ),
        ).toBeInTheDocument(),
      );
      expect(subjectInput()).toBeDisabled();
      expect(screen.getByText('📤 Envoyer')).toBeDisabled();
    });

    it('loadDraft renvoie draft:null (brouillon disparu) → lecture seule avec note', async () => {
      loadDraftSpy.mockResolvedValue({ ok: true, draft: null });
      await renderReady({ actions: actionsOf() });
      expect(
        screen.getByText('Aucun brouillon en base — il a peut-être déjà été envoyé ou supprimé.'),
      ).toBeInTheDocument();
      expect(subjectInput()).toBeDisabled();
      expect(screen.getByText('📤 Envoyer')).toBeDisabled();
    });
  });

  describe('sans actions', () => {
    it('lecture seule même une fois chargé : champs disabled, aucun bouton', async () => {
      await renderReady();
      expect(subjectInput()).toBeDisabled();
      expect(bodyInput()).toBeDisabled();
      expect(recipientCombobox(0)).toBeDisabled();
      expect(screen.queryByText('📤 Envoyer')).not.toBeInTheDocument();
      expect(screen.queryByText('💾 Garder en brouillon')).not.toBeInTheDocument();
    });
  });

  describe('autosave debouncé', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('plusieurs éditions rapides → un seul saveDraft après 2000ms ; payload exact : champs édités + fromIntegrationId/kind DB + composeAttachments CANONIQUES + bodyHtml canonique (corps non touché)', async () => {
      await renderReady({ actions: actionsOf() });

      // Trois frappes successives sur l'objet — seule la dernière compte.
      fireEvent.change(subjectInput(), { target: { value: 'N' } });
      fireEvent.change(subjectInput(), { target: { value: 'No' } });
      fireEvent.change(subjectInput(), { target: { value: 'Nouvel objet' } });

      const cc = recipientCombobox(1);
      fireEvent.change(cc, { target: { value: 'new@acme.com' } });
      fireEvent.keyDown(cc, { key: 'Enter' });

      expect(saveDraftSpy).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });

      expect(saveDraftSpy).toHaveBeenCalledTimes(1);
      expect(saveDraftSpy).toHaveBeenCalledWith({
        fromIntegrationId: 'int-db',
        kind: 'new_mail',
        toRecipients: ['db-dest@acme.com'],
        ccRecipients: ['db-cc@acme.com', 'new@acme.com'],
        bccRecipients: [],
        subject: 'Nouvel objet',
        // Corps non touché → bodyHtml CANONIQUE inchangé, jamais une
        // reconversion qui aplatirait le HTML riche (revue C1).
        bodyHtml: '<p>Bonjour <b>DB</b></p>',
        // Pièces jointes canoniques préservées telles quelles (revue I2).
        composeAttachments: [DB_ATTACHMENT],
      });
    });

    it('corps touché → bodyHtml reconstruit par échappement depuis la textarea', async () => {
      await renderReady({ actions: actionsOf() });
      fireEvent.change(bodyInput(), { target: { value: 'Salut,\n\nÇa va ?' } });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });

      expect(saveDraftSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          bodyHtml: '<p>Salut,</p><p>Ça va ?</p>',
          composeAttachments: [DB_ATTACHMENT],
        }),
      );
    });

    it('inclut replyToId quand le brouillon DB en porte un (kind reply)', async () => {
      loadDraftSpy.mockResolvedValue({
        ok: true,
        draft: { ...DB_DRAFT, kind: 'reply', replyToId: 'reply-1' },
      });
      await renderReady({ actions: actionsOf() });
      fireEvent.change(subjectInput(), { target: { value: 'Re: Objet' } });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });

      expect(saveDraftSpy).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'reply', replyToId: 'reply-1' }),
      );
    });

    it('indicateur : « … » pendant, « ✓ sauvegardé » une fois le save résolu', async () => {
      await renderReady({ actions: actionsOf() });
      fireEvent.change(subjectInput(), { target: { value: 'Nouvel objet' } });

      expect(screen.getByRole('status').textContent).toBe('…');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });

      expect(screen.getByRole('status').textContent).toBe('✓ sauvegardé');
    });

    it('échec de saveDraft (ok:false) → indicateur d’échec, sans crash', async () => {
      saveDraftSpy.mockResolvedValue({ ok: false, message: 'Impossible d’enregistrer.' });
      await renderReady({ actions: actionsOf() });
      fireEvent.change(subjectInput(), { target: { value: 'Nouvel objet' } });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });

      expect(screen.getByRole('status').textContent).toBe('échec de sauvegarde');
    });

    it('saves SÉRIALISÉS (revue I4) : un save déclenché pendant qu’un autre est en vol attend sa résolution — ordre des upserts pinné', async () => {
      const first = deferred<{ ok: true; id: string }>();
      saveDraftSpy.mockImplementationOnce(() => first.promise);
      await renderReady({ actions: actionsOf() });

      fireEvent.change(subjectInput(), { target: { value: 'Edit 1' } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(saveDraftSpy).toHaveBeenCalledTimes(1);
      expect(saveDraftSpy.mock.calls[0]?.[0]).toMatchObject({ subject: 'Edit 1' });

      // Deuxième édition pendant que le premier upsert est toujours en vol.
      fireEvent.change(subjectInput(), { target: { value: 'Edit 2' } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      // Chaîné : le second upsert n'a PAS démarré tant que le premier n'est
      // pas résolu — jamais deux upserts concurrents.
      expect(saveDraftSpy).toHaveBeenCalledTimes(1);

      await act(async () => {
        first.resolve({ ok: true, id: 'd1' });
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(saveDraftSpy).toHaveBeenCalledTimes(2);
      expect(saveDraftSpy.mock.calls[1]?.[0]).toMatchObject({ subject: 'Edit 2' });
    });
  });

  describe('Envoyer', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('flush AVANT sendMessage (ordre) : saveDraft attendu puis sendMessage — jamais avant', async () => {
      const save = deferred<{ ok: true; id: string }>();
      saveDraftSpy.mockImplementation(() => save.promise);
      const sendMessage = vi.fn();
      await renderReady({ actions: actionsOf({ sendMessage }) });

      // Édition en attente de debounce (pas encore en vol) — le clic doit
      // déclencher le save immédiatement plutôt qu'attendre 2000ms.
      fireEvent.change(subjectInput(), { target: { value: 'Nouvel objet' } });

      await act(async () => {
        fireEvent.click(screen.getByText('📤 Envoyer'));
        await Promise.resolve();
      });
      expect(saveDraftSpy).toHaveBeenCalledTimes(1);
      expect(sendMessage).not.toHaveBeenCalled();

      await act(async () => {
        save.resolve({ ok: true, id: 'd1' });
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(sendMessage).toHaveBeenCalledWith('Envoie le brouillon actuel (send_draft)');
    });

    it('message exact envoyé au chat, aucun champ du brouillon dedans', async () => {
      const sendMessage = vi.fn();
      await renderReady({ actions: actionsOf({ sendMessage }) });

      await act(async () => {
        fireEvent.click(screen.getByText('📤 Envoyer'));
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(sendMessage).toHaveBeenCalledWith('Envoie le brouillon actuel (send_draft)');
    });

    it('flush échoue (revue I1) → envoi BLOQUÉ : note d’erreur, sendMessage JAMAIS appelé', async () => {
      saveDraftSpy.mockResolvedValue({ ok: false, message: 'Impossible d’enregistrer.' });
      const sendMessage = vi.fn();
      await renderReady({ actions: actionsOf({ sendMessage }) });

      fireEvent.change(subjectInput(), { target: { value: 'Nouvel objet' } });
      await act(async () => {
        fireEvent.click(screen.getByText('📤 Envoyer'));
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(sendMessage).not.toHaveBeenCalled();
      expect(
        screen.getByText('Envoi bloqué : la sauvegarde du brouillon a échoué — réessayez.'),
      ).toBeInTheDocument();
    });

    it('busy:true → boutons désactivés', async () => {
      await renderReady({ actions: actionsOf({ busy: true }) });
      expect(screen.getByText('📤 Envoyer')).toBeDisabled();
      expect(screen.getByText('💾 Garder en brouillon')).toBeDisabled();
    });

    it('save en vol → boutons désactivés, réactivés à la résolution', async () => {
      const save = deferred<{ ok: true; id: string }>();
      saveDraftSpy.mockImplementation(() => save.promise);
      await renderReady({ actions: actionsOf() });
      fireEvent.change(subjectInput(), { target: { value: 'Nouvel objet' } });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });

      expect(screen.getByText('📤 Envoyer')).toBeDisabled();
      expect(screen.getByText('💾 Garder en brouillon')).toBeDisabled();

      await act(async () => {
        save.resolve({ ok: true, id: 'd1' });
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getByText('📤 Envoyer')).not.toBeDisabled();
    });
  });

  describe('Garder en brouillon', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('flush réussi → note « Sauvegardé… », sendMessage jamais appelé', async () => {
      const sendMessage = vi.fn();
      await renderReady({ actions: actionsOf({ sendMessage }) });
      fireEvent.change(subjectInput(), { target: { value: 'Nouvel objet' } });

      await act(async () => {
        fireEvent.click(screen.getByText('💾 Garder en brouillon'));
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(saveDraftSpy).toHaveBeenCalledTimes(1);
      expect(sendMessage).not.toHaveBeenCalled();
      expect(screen.getByText('Sauvegardé — retrouvable dans Communications.')).toBeInTheDocument();
    });

    it('flush échoué (revue I1) → note d’échec, JAMAIS « Sauvegardé… »', async () => {
      saveDraftSpy.mockResolvedValue({ ok: false, message: 'Impossible d’enregistrer.' });
      await renderReady({ actions: actionsOf() });
      fireEvent.change(subjectInput(), { target: { value: 'Nouvel objet' } });

      await act(async () => {
        fireEvent.click(screen.getByText('💾 Garder en brouillon'));
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(
        screen.getByText('Échec de sauvegarde — le brouillon n’a pas été mis à jour.'),
      ).toBeInTheDocument();
      expect(
        screen.queryByText('Sauvegardé — retrouvable dans Communications.'),
      ).not.toBeInTheDocument();
    });

    it('autosave échoué → « Garder » sans réédition RETENTE le save (2e appel pinné) ; succès → « Sauvegardé… »', async () => {
      // L'autosave initial échoue ; le retry (mock par défaut) réussit.
      saveDraftSpy.mockResolvedValueOnce({ ok: false, message: 'Impossible d’enregistrer.' });
      await renderReady({ actions: actionsOf() });

      fireEvent.change(subjectInput(), { target: { value: 'Nouvel objet' } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(saveDraftSpy).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('status').textContent).toBe('échec de sauvegarde');

      // Clic « Garder » SANS réédition : flush doit RETENTER le save au lieu
      // de répondre true sur la foi d'un état DB périmé.
      await act(async () => {
        fireEvent.click(screen.getByText('💾 Garder en brouillon'));
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(saveDraftSpy).toHaveBeenCalledTimes(2);
      expect(saveDraftSpy.mock.calls[1]?.[0]).toMatchObject({ subject: 'Nouvel objet' });
      expect(screen.getByText('Sauvegardé — retrouvable dans Communications.')).toBeInTheDocument();
    });

    it('autosave échoué + retry qui échoue encore → note d’échec (jamais « Sauvegardé »), et « Envoyer » retente puis reste bloqué sans sendMessage', async () => {
      saveDraftSpy.mockResolvedValue({ ok: false, message: 'Impossible d’enregistrer.' });
      const sendMessage = vi.fn();
      await renderReady({ actions: actionsOf({ sendMessage }) });

      fireEvent.change(subjectInput(), { target: { value: 'Nouvel objet' } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(saveDraftSpy).toHaveBeenCalledTimes(1);

      await act(async () => {
        fireEvent.click(screen.getByText('💾 Garder en brouillon'));
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(saveDraftSpy).toHaveBeenCalledTimes(2);
      expect(
        screen.getByText('Échec de sauvegarde — le brouillon n’a pas été mis à jour.'),
      ).toBeInTheDocument();
      expect(
        screen.queryByText('Sauvegardé — retrouvable dans Communications.'),
      ).not.toBeInTheDocument();

      // « Envoyer » sans réédition : retente encore, échoue → bloqué.
      await act(async () => {
        fireEvent.click(screen.getByText('📤 Envoyer'));
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(saveDraftSpy).toHaveBeenCalledTimes(3);
      expect(sendMessage).not.toHaveBeenCalled();
      expect(
        screen.getByText('Envoi bloqué : la sauvegarde du brouillon a échoué — réessayez.'),
      ).toBeInTheDocument();
    });
  });
});
