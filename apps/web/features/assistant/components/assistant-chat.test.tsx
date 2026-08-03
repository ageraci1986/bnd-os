import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
// jsdom's global `Blob` doesn't implement `.stream()` — use Node's, which does.
import { Blob as NodeBlob } from 'node:buffer';
import {
  FakeAudioContext,
  FakeMediaRecorder,
  fakeStream,
  installFakeAudioContext,
  installFakeMediaRecorder,
} from '../hooks/fake-media-recorder';
// Vitest hoists vi.mock above all imports — la closure doit passer par
// vi.hoisted() (même convention que ailleurs dans ce fichier de tests).
const { markNotificationReadSpy } = vi.hoisted(() => ({
  markNotificationReadSpy: vi.fn(),
}));
vi.mock('@/features/notifications/actions/mark-read', () => ({
  markNotificationRead: (...a: unknown[]) => markNotificationReadSpy(...a),
}));

import { AssistantChat } from './assistant-chat';

// Les widgets liste/board font `next/link` — stub minimal comme dans widgets/index.test.tsx.
vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

function sseResponse(events: object[]): Response {
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
  return new Response(new NodeBlob([body]).stream() as unknown as ReadableStream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

/**
 * Flux SSE volontairement jamais fermé : le dialog de confirmation n'est retiré
 * qu'à confirm_resolved ou à la fin du flux — les tests qui interagissent avec
 * lui doivent garder le flux ouvert pendant les clics.
 */
function openSseResponse(events: object[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const e of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      }
    },
  });
  return new Response(stream as unknown as BodyInit, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

describe('AssistantChat', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    markNotificationReadSpy.mockReset();
    markNotificationReadSpy.mockResolvedValue({ ok: true, affected: 1 });
  });

  it('affiche le message d accueil', () => {
    render(<AssistantChat csrfToken="tok" firstName="Angelo" />);
    expect(screen.getByText(/Bonjour Angelo/)).toBeInTheDocument();
  });

  it('envoie un message et streame la réponse', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      sseResponse([
        { type: 'chunk', text: 'Trois ' },
        { type: 'chunk', text: 'tâches.' },
        { type: 'done', text: 'Trois tâches.' },
      ]),
    );
    render(<AssistantChat csrfToken="tok" firstName="Angelo" />);
    await userEvent.type(screen.getByRole('textbox'), 'Mes tâches ?');
    await userEvent.click(screen.getByRole('button', { name: /envoyer/i }));
    await waitFor(() => {
      expect(screen.getByText('Trois tâches.')).toBeInTheDocument();
    });
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect((init?.headers as Record<string, string>)['x-csrf-token']).toBe('tok');
  });

  it('affiche l erreur renvoyée par le serveur', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      sseResponse([
        { type: 'error', message: 'Le modèle est très sollicité — réessayez dans un instant.' },
      ]),
    );
    render(<AssistantChat csrfToken="tok" firstName="Angelo" />);
    await userEvent.type(screen.getByRole('textbox'), 'x');
    await userEvent.click(screen.getByRole('button', { name: /envoyer/i }));
    await waitFor(() => {
      expect(screen.getByText(/sollicité/)).toBeInTheDocument();
    });
  });

  it('plafonne l historique envoyé à 38 messages', async () => {
    let call = 0;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      call += 1;
      return Promise.resolve(sseResponse([{ type: 'done', text: `réponse ${call}` }]));
    });
    render(<AssistantChat csrfToken="tok" firstName="Angelo" />);
    // 21 échanges = 42 entrées sans plafond → le cap doit borner à 38.
    for (let i = 1; i <= 21; i += 1) {
      await userEvent.type(screen.getByRole('textbox'), `q${i}`);
      await userEvent.click(screen.getByRole('button', { name: /envoyer/i }));
      await screen.findByText(`réponse ${i}`);
    }
    const bodies = fetchMock.mock.calls.map(
      ([, init]) => JSON.parse(init?.body as string) as { messages: unknown[] },
    );
    for (const body of bodies) {
      expect(body.messages.length).toBeLessThanOrEqual(38);
    }
    // Au 21e envoi, l'historique non plafonné ferait 40 entrées.
    expect(bodies[20]?.messages).toHaveLength(38);
  });

  it('conserve la réponse partielle si le flux se ferme sans done', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      sseResponse([
        { type: 'chunk', text: 'Réponse par' },
        { type: 'chunk', text: 'tielle' },
      ]),
    );
    render(<AssistantChat csrfToken="tok" firstName="Angelo" />);
    await userEvent.type(screen.getByRole('textbox'), 'x');
    await userEvent.click(screen.getByRole('button', { name: /envoyer/i }));
    // Le streaming est terminé (input ré-activé) et le texte partiel est commité.
    await waitFor(() => {
      expect(screen.getByRole('textbox')).not.toBeDisabled();
    });
    expect(screen.getByText('Réponse partielle')).toBeInTheDocument();
  });

  it('affiche le libellé d activité pendant un appel outil puis le retire', async () => {
    const encoder = new TextEncoder();
    let push!: (e: object) => void;
    let close!: () => void;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        push = (e) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
        close = () => controller.close();
      },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(stream as unknown as BodyInit, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );
    render(<AssistantChat csrfToken="tok" firstName="Angelo" />);
    await userEvent.type(screen.getByRole('textbox'), 'projets ?');
    await userEvent.click(screen.getByRole('button', { name: /envoyer/i }));
    // L'orbe passe à `thinking` dès le début du tour — aucun chunk encore reçu.
    await waitFor(() => {
      expect(screen.getByTestId('assistant-orb')).toHaveAttribute('data-activity', 'thinking');
    });
    act(() => push({ type: 'tool_start', name: 'list_projects' }));
    await waitFor(() => {
      expect(screen.getByText('consulte les projets…')).toBeInTheDocument();
    });
    // Toujours `thinking` pendant l'appel outil — pas encore de texte streamé.
    expect(screen.getByTestId('assistant-orb')).toHaveAttribute('data-activity', 'thinking');
    act(() => {
      push({ type: 'tool_end', name: 'list_projects', isError: false });
      push({ type: 'chunk', text: 'Deux ' });
    });
    // Le premier chunk fait passer l'orbe à `responding`.
    await waitFor(() => {
      expect(screen.getByTestId('assistant-orb')).toHaveAttribute('data-activity', 'responding');
    });
    act(() => {
      push({ type: 'done', text: 'Deux projets.' });
      close();
    });
    await waitFor(() => {
      expect(screen.getByText('Deux projets.')).toBeInTheDocument();
    });
    expect(screen.queryByText('consulte les projets…')).not.toBeInTheDocument();
    // Le tour est terminé — retour à `idle`.
    expect(screen.getByTestId('assistant-orb')).toHaveAttribute('data-activity', 'idle');
  });

  it('confirm_request → dialog visible ; Autoriser → POST /confirm puis confirm_resolved le ferme', async () => {
    const confirmId = 'a'.repeat(32);
    // Stream contrôlé : confirm_request, puis (après le clic) confirm_resolved + done.
    let pushSecondHalf: () => void = () => undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        controller.enqueue(
          enc.encode(
            `data: ${JSON.stringify({ type: 'confirm_request', id: confirmId, tool: 'delete_card', description: 'delete_card (cardId="c1")' })}\n\n`,
          ),
        );
        pushSecondHalf = () => {
          controller.enqueue(
            enc.encode(
              `data: ${JSON.stringify({ type: 'confirm_resolved', id: confirmId, allowed: true })}\n\n` +
                `data: ${JSON.stringify({ type: 'done', text: 'Carte supprimée.' })}\n\n`,
            ),
          );
          controller.close();
        };
      },
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).endsWith('/api/assistant/confirm')) {
        return Response.json({ ok: true });
      }
      return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    });

    render(<AssistantChat csrfToken="tok" firstName="Angelo" />);
    await userEvent.type(screen.getByRole('textbox'), 'supprime la carte c1');
    await userEvent.click(screen.getByRole('button', { name: /envoyer/i }));

    // Le dialog apparaît avec la description et les deux boutons
    const allowButton = await screen.findByRole('button', { name: /autoriser/i });
    expect(screen.getByText(/delete_card/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /refuser/i })).toBeInTheDocument();

    await userEvent.click(allowButton);
    await waitFor(() => {
      const confirmCall = fetchMock.mock.calls.find(([u]) =>
        String(u).endsWith('/api/assistant/confirm'),
      );
      expect(confirmCall).toBeDefined();
      const [, init] = confirmCall ?? [];
      expect(JSON.parse(String(init?.body))).toEqual({ id: confirmId, allowed: true });
      expect((init?.headers as Record<string, string>)['x-csrf-token']).toBe('tok');
    });

    pushSecondHalf();
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /autoriser/i })).not.toBeInTheDocument();
      expect(screen.getByText('Carte supprimée.')).toBeInTheDocument();
    });
  });

  it('verrouille les deux boutons au premier clic — un seul POST /confirm', async () => {
    const confirmId = 'e'.repeat(32);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      if (String(url).endsWith('/api/assistant/confirm')) {
        return new Promise<Response>(() => undefined); // réponse jamais résolue : en vol
      }
      return Promise.resolve(
        openSseResponse([
          {
            type: 'confirm_request',
            id: confirmId,
            tool: 'delete_card',
            description: 'delete_card (cardId="c1")',
          },
        ]),
      );
    });

    render(<AssistantChat csrfToken="tok" firstName="Angelo" />);
    await userEvent.type(screen.getByRole('textbox'), 'supprime la carte c1');
    await userEvent.click(screen.getByRole('button', { name: /envoyer/i }));

    const allowButton = await screen.findByRole('button', { name: /autoriser/i });
    const denyButton = screen.getByRole('button', { name: /refuser/i });
    await userEvent.click(allowButton);
    await userEvent.click(denyButton); // désactivé après le premier clic → sans effet

    expect(denyButton).toBeDisabled();
    // Le bouton cliqué affiche « envoi… » pendant la transmission.
    expect(screen.getByRole('button', { name: /envoi…/i })).toBeInTheDocument();
    const confirmCalls = fetchMock.mock.calls.filter(([u]) =>
      String(u).endsWith('/api/assistant/confirm'),
    );
    expect(confirmCalls).toHaveLength(1);
  });

  it('place le focus sur Refuser à l ouverture du dialog', async () => {
    const confirmId = 'd'.repeat(32);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      openSseResponse([
        {
          type: 'confirm_request',
          id: confirmId,
          tool: 'delete_card',
          description: 'delete_card (cardId="c1")',
        },
      ]),
    );

    render(<AssistantChat csrfToken="tok" firstName="Angelo" />);
    await userEvent.type(screen.getByRole('textbox'), 'supprime la carte c1');
    await userEvent.click(screen.getByRole('button', { name: /envoyer/i }));

    const denyButton = await screen.findByRole('button', { name: /refuser/i });
    await waitFor(() => {
      expect(denyButton).toHaveFocus();
    });
  });

  it('ne recolle pas en bas quand l utilisateur a remonté le fil', async () => {
    const scrollSpy = vi.fn();
    const proto = window.HTMLElement.prototype as unknown as { scrollIntoView?: unknown };
    proto.scrollIntoView = scrollSpy;
    try {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        sseResponse([{ type: 'done', text: 'Réponse.' }]),
      );
      const { container } = render(<AssistantChat csrfToken="tok" firstName="Angelo" />);
      const list = container.querySelector('.overflow-y-auto');
      expect(list).not.toBeNull();
      // Simule un utilisateur remonté dans le fil : 800px au-dessus du bas (> seuil 120).
      Object.defineProperty(list, 'scrollHeight', { value: 1000, configurable: true });
      Object.defineProperty(list, 'clientHeight', { value: 200, configurable: true });
      Object.defineProperty(list, 'scrollTop', { value: 0, configurable: true });
      scrollSpy.mockClear();

      await userEvent.type(screen.getByRole('textbox'), 'x');
      await userEvent.click(screen.getByRole('button', { name: /envoyer/i }));
      await screen.findByText('Réponse.');

      expect(scrollSpy).not.toHaveBeenCalled();
    } finally {
      delete proto.scrollIntoView;
    }
  });

  it('retire le dialog si le flux se termine sans confirm_resolved', async () => {
    const confirmId = '0'.repeat(32);
    // Flux qui se ferme juste après confirm_request : plus aucun serveur n'attend
    // la réponse → le dialog périmé doit disparaître à la fin du send().
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      sseResponse([
        {
          type: 'confirm_request',
          id: confirmId,
          tool: 'delete_card',
          description: 'delete_card (cardId="c1")',
        },
      ]),
    );

    render(<AssistantChat csrfToken="tok" firstName="Angelo" />);
    await userEvent.type(screen.getByRole('textbox'), 'supprime la carte c1');
    await userEvent.click(screen.getByRole('button', { name: /envoyer/i }));

    // send() terminé : input ré-activé…
    await waitFor(() => {
      expect(screen.getByRole('textbox')).not.toBeDisabled();
    });
    // …et le dialog n'est plus là.
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('confirm renvoie 404 (clé expirée) → aucune erreur affichée', async () => {
    const confirmId = 'f'.repeat(32);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).endsWith('/api/assistant/confirm')) {
        return Response.json({ ok: false }, { status: 404 });
      }
      return openSseResponse([
        {
          type: 'confirm_request',
          id: confirmId,
          tool: 'delete_card',
          description: 'delete_card (cardId="c1")',
        },
      ]);
    });

    render(<AssistantChat csrfToken="tok" firstName="Angelo" />);
    await userEvent.type(screen.getByRole('textbox'), 'supprime la carte c1');
    await userEvent.click(screen.getByRole('button', { name: /envoyer/i }));

    const allowButton = await screen.findByRole('button', { name: /autoriser/i });
    await userEvent.click(allowButton);

    // Laisse le temps à la promesse fetch de se résoudre.
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('confirm renvoie 409 (déjà répondu) → aucune erreur affichée', async () => {
    const confirmId = 'b'.repeat(32);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).endsWith('/api/assistant/confirm')) {
        return Response.json({ ok: false }, { status: 409 });
      }
      return openSseResponse([
        {
          type: 'confirm_request',
          id: confirmId,
          tool: 'delete_card',
          description: 'delete_card (cardId="c1")',
        },
      ]);
    });

    render(<AssistantChat csrfToken="tok" firstName="Angelo" />);
    await userEvent.type(screen.getByRole('textbox'), 'supprime la carte c1');
    await userEvent.click(screen.getByRole('button', { name: /envoyer/i }));

    const allowButton = await screen.findByRole('button', { name: /autoriser/i });
    await userEvent.click(allowButton);

    // Laisse le temps à la promesse fetch de se résoudre.
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('confirm renvoie 500 → message d erreur affiché', async () => {
    const confirmId = 'c'.repeat(32);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).endsWith('/api/assistant/confirm')) {
        return Response.json({ ok: false }, { status: 500 });
      }
      return openSseResponse([
        {
          type: 'confirm_request',
          id: confirmId,
          tool: 'delete_card',
          description: 'delete_card (cardId="c1")',
        },
      ]);
    });

    render(<AssistantChat csrfToken="tok" firstName="Angelo" />);
    await userEvent.type(screen.getByRole('textbox'), 'supprime la carte c1');
    await userEvent.click(screen.getByRole('button', { name: /envoyer/i }));

    const allowButton = await screen.findByRole('button', { name: /autoriser/i });
    await userEvent.click(allowButton);

    await waitFor(() => {
      expect(
        screen.getByText('Impossible de transmettre la réponse — réessayez.'),
      ).toBeInTheDocument();
    });
  });

  it('annule la requête en cours au démontage', async () => {
    let signal: AbortSignal | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>(() => undefined); // jamais résolue : requête en vol
    });
    const { unmount } = render(<AssistantChat csrfToken="tok" firstName="Angelo" />);
    await userEvent.type(screen.getByRole('textbox'), 'x');
    await userEvent.click(screen.getByRole('button', { name: /envoyer/i }));
    unmount();
    expect(signal?.aborted).toBe(true);
  });

  it('tool_result get_today_overview → widget KPI visible pendant le stream et persisté après done', async () => {
    const encoder = new TextEncoder();
    let push!: (e: object) => void;
    let close!: () => void;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        push = (e) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
        close = () => controller.close();
      },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(stream as unknown as BodyInit, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );
    render(<AssistantChat csrfToken="tok" firstName="Angelo" />);
    await userEvent.type(screen.getByRole('textbox'), 'mon briefing');
    await userEvent.click(screen.getByRole('button', { name: /envoyer/i }));

    act(() => {
      push({
        type: 'tool_result',
        tool: 'get_today_overview',
        data: { blockedCards: 2, dueTodayCards: 1, unreadMails: 3, unreadNotifications: 0 },
      });
    });
    // Rendu sous la bulle en cours de stream, avant `done`.
    await waitFor(() => {
      expect(screen.getByText('Bloquées')).toBeInTheDocument();
    });

    act(() => {
      push({ type: 'done', text: 'Voici votre briefing.' });
      close();
    });

    await waitFor(() => {
      expect(screen.getByText('Voici votre briefing.')).toBeInTheDocument();
    });
    // Toujours là une fois le message commité : le widget a survécu au commit.
    expect(screen.getByText('Bloquées')).toBeInTheDocument();
  });

  it('tool_result pour un tool inconnu ne rend rien et ne fait pas planter', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      sseResponse([
        { type: 'tool_result', tool: 'some_unknown_tool', data: { foo: 'bar' } },
        { type: 'done', text: 'Réponse.' },
      ]),
    );
    render(<AssistantChat csrfToken="tok" firstName="Angelo" />);
    await userEvent.type(screen.getByRole('textbox'), 'x');
    await userEvent.click(screen.getByRole('button', { name: /envoyer/i }));
    await waitFor(() => {
      expect(screen.getByText('Réponse.')).toBeInTheDocument();
    });
    expect(screen.queryByText('bar')).not.toBeInTheDocument();
  });

  it('affiche « Envoi de mail » dans l en-tête du dialog pour le tool send_mail', async () => {
    const confirmId = '9'.repeat(32);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      openSseResponse([
        {
          type: 'confirm_request',
          id: confirmId,
          tool: 'send_mail',
          description: 'Envoyer un mail à a@b.test — objet « Bonjour » : Salut…',
        },
      ]),
    );
    render(<AssistantChat csrfToken="tok" firstName="Angelo" />);
    await userEvent.type(screen.getByRole('textbox'), 'envoie le mail');
    await userEvent.click(screen.getByRole('button', { name: /envoyer/i }));

    await screen.findByRole('button', { name: /autoriser/i });
    expect(screen.getByText(/Envoi de mail/)).toBeInTheDocument();
  });

  it('les widgets commités ne sont dans aucune région aria-live (les bulles texte, si)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      sseResponse([
        {
          type: 'tool_result',
          tool: 'get_today_overview',
          data: { blockedCards: 1, dueTodayCards: 0, unreadMails: 0, unreadNotifications: 0 },
        },
        { type: 'done', text: 'Briefing.' },
      ]),
    );
    render(<AssistantChat csrfToken="tok" firstName="Angelo" />);
    await userEvent.type(screen.getByRole('textbox'), 'mon briefing');
    await userEvent.click(screen.getByRole('button', { name: /envoyer/i }));
    await screen.findByText('Briefing.');

    // La bulle texte commitée reste annoncée par une région live…
    let node: HTMLElement | null = screen.getByText('Briefing.');
    let bubbleInLive = false;
    while (node !== null) {
      if (node.getAttribute('aria-live') !== null) bubbleInLive = true;
      node = node.parentElement;
    }
    expect(bubbleInLive).toBe(true);

    // …mais aucun ancêtre du widget ne porte aria-live (pas de lecture ligne à
    // ligne) ni aria-hidden (ses liens restent dans l'arbre d'accessibilité).
    node = screen.getByText('Bloquées');
    while (node !== null) {
      expect(node.getAttribute('aria-live')).toBeNull();
      expect(node.getAttribute('aria-hidden')).toBeNull();
      node = node.parentElement;
    }
  });

  it('borne le fil affiché à 80 entrées — les plus anciennes sortent', async () => {
    let call = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      call += 1;
      return Promise.resolve(sseResponse([{ type: 'done', text: `réponse ${call}` }]));
    });
    render(<AssistantChat csrfToken="tok" firstName="Angelo" />);
    // 41 échanges = 82 entrées sans borne → DISPLAY_MAX doit tenir 80.
    for (let i = 1; i <= 41; i += 1) {
      await userEvent.type(screen.getByRole('textbox'), `q${i}`);
      await userEvent.click(screen.getByRole('button', { name: /envoyer/i }));
      await screen.findByText(`réponse ${i}`);
    }
    // Les 2 entrées les plus anciennes ont été évincées, le reste est là.
    expect(screen.queryByText('q1')).not.toBeInTheDocument();
    expect(screen.queryByText('réponse 1')).not.toBeInTheDocument();
    expect(screen.getByText('q2')).toBeInTheDocument();
    expect(screen.getByText('réponse 41')).toBeInTheDocument();
    // 41 tours SSE complets : bien au-delà du budget par défaut de 5 s quand
    // la machine est chargée (flake constaté sur le hook pre-push) — timeout
    // dédié plutôt qu'une hausse globale.
  }, 30_000);

  it('trime la donnée board stockée : 5 cartes rendues, total préservé via le compteur', async () => {
    const cards = Array.from({ length: 100 }, (_, i) => ({
      id: `card-${i}`,
      title: `Carte ${i}`,
      due: null,
    }));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      sseResponse([
        {
          type: 'tool_result',
          tool: 'get_project_board',
          data: {
            id: '11111111-1111-1111-1111-111111111111',
            name: 'Refonte',
            columns: [{ id: 'col-1', name: 'Backlog', blocked: false, cards }],
          },
        },
        { type: 'done', text: 'Voici le board.' },
      ]),
    );
    render(<AssistantChat csrfToken="tok" firstName="Angelo" />);
    await userEvent.type(screen.getByRole('textbox'), 'montre le board');
    await userEvent.click(screen.getByRole('button', { name: /envoyer/i }));
    await screen.findByText('Voici le board.');

    // Seules les 5 premières cartes sont conservées et affichées…
    expect(screen.getByText('Carte 4')).toBeInTheDocument();
    expect(screen.queryByText('Carte 5')).not.toBeInTheDocument();
    // …mais compteur et « +N autres » reflètent toujours le total d'origine.
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('+95 autres')).toBeInTheDocument();
  });

  it('deux tool_result board du même projet dans un stream → un seul board, le plus récent', async () => {
    const projectId = '22222222-2222-2222-2222-222222222222';
    const boardEvent = (cardTitle: string) => ({
      type: 'tool_result',
      tool: 'get_project_board',
      data: {
        id: projectId,
        name: 'Refonte',
        columns: [
          {
            id: 'col-1',
            name: 'Backlog',
            blocked: false,
            cards: [{ id: `card-${cardTitle}`, title: cardTitle, due: null }],
          },
        ],
      },
    });
    const encoder = new TextEncoder();
    let push!: (e: object) => void;
    let close!: () => void;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        push = (e) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
        close = () => controller.close();
      },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(stream as unknown as BodyInit, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );
    render(<AssistantChat csrfToken="tok" firstName="Angelo" />);
    await userEvent.type(screen.getByRole('textbox'), 'déplace la carte puis remontre le board');
    await userEvent.click(screen.getByRole('button', { name: /envoyer/i }));

    // Premier board (état avant mutation)…
    act(() => push(boardEvent('Ancienne carte')));
    await screen.findByText('Ancienne carte');

    // …relu après mutation : le board rafraîchi REMPLACE l'ancien pendant le
    // streaming — un seul board affiché, et c'est le second.
    act(() => push(boardEvent('Nouvelle carte')));
    await screen.findByText('Nouvelle carte');
    expect(screen.queryByText('Ancienne carte')).not.toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Refonte' })).toHaveLength(1);

    act(() => {
      push({ type: 'done', text: 'Carte déplacée, voici le board à jour.' });
      close();
    });
    await screen.findByText('Carte déplacée, voici le board à jour.');

    // Même invariant sur le message commité : un seul board, le plus récent.
    expect(screen.getByText('Nouvelle carte')).toBeInTheDocument();
    expect(screen.queryByText('Ancienne carte')).not.toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Refonte' })).toHaveLength(1);
  });

  it('l historique envoyé au serveur reste texte-only : jamais de clé widgets', async () => {
    let call = 0;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      call += 1;
      if (call === 1) {
        return Promise.resolve(
          sseResponse([
            {
              type: 'tool_result',
              tool: 'get_today_overview',
              data: { blockedCards: 0, dueTodayCards: 0, unreadMails: 0, unreadNotifications: 0 },
            },
            { type: 'done', text: 'Un.' },
          ]),
        );
      }
      return Promise.resolve(sseResponse([{ type: 'done', text: 'Deux.' }]));
    });
    render(<AssistantChat csrfToken="tok" firstName="Angelo" />);
    await userEvent.type(screen.getByRole('textbox'), 'mon briefing');
    await userEvent.click(screen.getByRole('button', { name: /envoyer/i }));
    await screen.findByText('Un.');

    await userEvent.type(screen.getByRole('textbox'), 'et ensuite ?');
    await userEvent.click(screen.getByRole('button', { name: /envoyer/i }));
    await screen.findByText('Deux.');

    const secondCall = fetchMock.mock.calls[1];
    const body = JSON.parse(String(secondCall?.[1]?.body)) as { messages: unknown[] };
    expect(body.messages.length).toBeGreaterThan(0);
    for (const m of body.messages) {
      expect(m).not.toHaveProperty('widgets');
    }
  });

  describe('accueil — briefing digéré + KPI (Plan 4 Task 3, données serveur)', () => {
    it('sans prop `overview` : brief statique inchangé', () => {
      render(<AssistantChat csrfToken="tok" firstName="Angelo" />);
      expect(
        screen.getByText('Demandez votre briefing, interrogez vos projets et vos mails.'),
      ).toBeInTheDocument();
      expect(screen.queryByTestId('assistant-brief')).not.toBeInTheDocument();
    });

    it('avec `overview` : remplace le brief statique par la phrase digérée pinnée (pluriel)', () => {
      render(
        <AssistantChat
          csrfToken="tok"
          firstName="Angelo"
          overview={{ blockedCards: 1, dueTodayCards: 3, unreadMails: 5, unreadNotifications: 2 }}
        />,
      );
      expect(
        screen.queryByText('Demandez votre briefing, interrogez vos projets et vos mails.'),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId('assistant-brief')).toHaveTextContent(
        "3 tâches dues aujourd'hui · 1 bloquée · 5 mails non lus",
      );
    });

    it('avec `overview` : accords au singulier et partie « bloquée » masquée quand elle vaut 0', () => {
      render(
        <AssistantChat
          csrfToken="tok"
          firstName="Angelo"
          overview={{ blockedCards: 0, dueTodayCards: 1, unreadMails: 0, unreadNotifications: 0 }}
        />,
      );
      expect(screen.getByTestId('assistant-brief')).toHaveTextContent(
        "1 tâche due aujourd'hui · 0 mail non lu",
      );
    });

    it('colore la partie « bloquée(s) » avec le token danger — même token que KpiCards', () => {
      render(
        <AssistantChat
          csrfToken="tok"
          firstName="Angelo"
          overview={{ blockedCards: 2, dueTodayCards: 0, unreadMails: 0, unreadNotifications: 0 }}
        />,
      );
      expect(screen.getByText('2 bloquées').getAttribute('style')).toContain('--color-danger');
    });

    it('rend les 4 tuiles KpiCards à l’accueil quand `overview` est fourni', () => {
      render(
        <AssistantChat
          csrfToken="tok"
          firstName="Angelo"
          overview={{ blockedCards: 0, dueTodayCards: 2, unreadMails: 5, unreadNotifications: 1 }}
        />,
      );
      expect(screen.getByText('Bloquées')).toBeInTheDocument();
      expect(screen.getByText("Dues aujourd'hui")).toBeInTheDocument();
      expect(screen.getByText('Mails non lus')).toBeInTheDocument();
      expect(screen.getByText('Notifications')).toBeInTheDocument();
    });

    it('place le brief digéré et les KPI hors de toute région aria-live', () => {
      render(
        <AssistantChat
          csrfToken="tok"
          firstName="Angelo"
          overview={{ blockedCards: 0, dueTodayCards: 2, unreadMails: 5, unreadNotifications: 1 }}
        />,
      );
      expect(screen.getByTestId('assistant-brief').closest('[aria-live]')).toBeNull();
      expect(screen.getByText('Bloquées').closest('[aria-live]')).toBeNull();
    });
  });

  describe('pile de notices (Plan 3b Task 7)', () => {
    const notice = {
      id: 'n1',
      kind: 'agent_card_blocked' as const,
      message: '« Maquettes v2 » vient de passer en Bloqué (échéance hier) sur le projet Acme.',
      discuss: 'Parlons de la carte card-9 passée en Bloqué',
    };

    it('sans prop `notices` : aucune notice affichée', () => {
      render(<AssistantChat csrfToken="tok" firstName="Angelo" />);
      expect(screen.queryByText(notice.message)).not.toBeInTheDocument();
    });

    it('avec `notices` : affiche le bandeau et ses boutons', () => {
      render(<AssistantChat csrfToken="tok" firstName="Angelo" notices={[notice]} />);
      expect(screen.getByText(notice.message)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /en discuter/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /ignorer/i })).toBeInTheDocument();
    });

    it('« En discuter » injecte `notice.discuss` dans le chat via le même canal que les widgets', async () => {
      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(sseResponse([{ type: 'done', text: 'Bien sûr.' }]));
      render(<AssistantChat csrfToken="tok" firstName="Angelo" notices={[notice]} />);

      await userEvent.click(screen.getByRole('button', { name: /en discuter/i }));

      await screen.findByText('Bien sûr.');
      // Le message injecté apparaît dans le fil comme un message utilisateur normal.
      expect(screen.getByText(notice.discuss)).toBeInTheDocument();
      const call = fetchMock.mock.calls[0];
      const body = JSON.parse(String(call?.[1]?.body)) as { message: string };
      expect(body.message).toBe(notice.discuss);
      expect(markNotificationReadSpy).toHaveBeenCalledWith({ notificationId: 'n1' });
      // Optimiste : le bandeau disparaît immédiatement.
      expect(screen.queryByText(notice.message)).not.toBeInTheDocument();
    });

    it('la pile de notices reste hors de toute région aria-live', () => {
      render(<AssistantChat csrfToken="tok" firstName="Angelo" notices={[notice]} />);
      expect(screen.getByText(notice.message).closest('[aria-live]')).toBeNull();
    });
  });

  describe('mode voix', () => {
    beforeEach(() => {
      installFakeMediaRecorder();
      installFakeAudioContext();
    });
    afterEach(() => vi.unstubAllGlobals());

    /**
     * Route le fetch mocké par URL : /api/assistant/voice/transcribe renvoie
     * le transcript configurable, /api/assistant/voice/speak un petit buffer
     * audio, /api/assistant/confirm un OK par défaut, /api/assistant/chat le
     * flux SSE fourni par le test (voir sseResponse/openSseResponse en tête
     * de fichier).
     */
    function routeFetch(handlers: {
      /** Reçoit l'init de la requête — nécessaire pour observer `init.signal` (abort). */
      chat?: (init?: RequestInit) => Response;
      transcript?: string;
      confirm?: () => Response;
    }) {
      return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
        const u = String(url);
        if (u.endsWith('/api/assistant/voice/transcribe')) {
          return Response.json({ ok: true, transcript: handlers.transcript ?? '' });
        }
        if (u.endsWith('/api/assistant/voice/speak')) {
          return new Response(new Uint8Array([1, 2]), { status: 200 });
        }
        if (u.endsWith('/api/assistant/confirm')) {
          return handlers.confirm ? handlers.confirm() : Response.json({ ok: true });
        }
        if (u.endsWith('/api/assistant/chat') && handlers.chat) {
          return handlers.chat(init as RequestInit | undefined);
        }
        throw new Error(`URL non routée dans ce test : ${u}`);
      });
    }

    /** Maintien ⌥ Option → relâche, en dehors de tout champ de saisie. */
    async function pressAltAndRelease(): Promise<void> {
      fireEvent.keyDown(window, { key: 'Alt' });
      await waitFor(() => {
        expect(screen.getByTestId('voice-capsule')).toHaveAttribute('data-mode', 'recording');
      });
      fireEvent.keyUp(window, { key: 'Alt' });
    }

    it('PTT clavier bout en bout : ⌥ Option maintenu → transcript → bulle user + POST /chat', async () => {
      const fetchMock = routeFetch({
        transcript: 'quelles cartes sont bloquées ?',
        chat: () => sseResponse([{ type: 'done', text: 'Aucune carte bloquée.' }]),
      });
      render(<AssistantChat csrfToken="tok" firstName="Angelo" />);

      await pressAltAndRelease();

      await waitFor(() => {
        expect(screen.getByText('quelles cartes sont bloquées ?')).toBeInTheDocument();
      });
      expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/api/assistant/chat'))).toBe(
        true,
      );
    });

    it('symétrie : un tour vocal vocalise la réponse, le même tour au clavier reste silencieux', async () => {
      const fetchMock = routeFetch({
        transcript: 'fais le',
        chat: () =>
          sseResponse([
            { type: 'chunk', text: "C'est fait. " },
            { type: 'chunk', text: 'Voilà.' },
            { type: 'done', text: "C'est fait. Voilà." },
          ]),
      });
      render(<AssistantChat csrfToken="tok" firstName="Angelo" />);

      // Tour VOCAL : au moins une phrase part vers /speak.
      await pressAltAndRelease();
      // Attend le texte final ET le champ réactivé (busy=false) — pas juste le
      // texte : celui-ci peut matcher la bulle de STREAM en cours (identique
      // une fois les deux chunks accumulés) UN TICK avant que la boucle de
      // lecture SSE ne détecte la fin de flux et ne relâche `busy` dans le
      // `finally` de send(). Sans ce garde, taper dans le champ juste après
      // peut tomber sur un instant où il est encore `disabled` → no-op
      // silencieux de userEvent.type (repro : `pnpm test -t symétrie` en boucle).
      await waitFor(() => {
        expect(screen.getByText("C'est fait. Voilà.")).toBeInTheDocument();
        expect(screen.getByRole('textbox')).not.toBeDisabled();
      });
      const speakCallsVoiceTurn = fetchMock.mock.calls.filter(([u]) =>
        String(u).endsWith('/api/assistant/voice/speak'),
      ).length;
      expect(speakCallsVoiceTurn).toBeGreaterThan(0);

      // Tour CLAVIER identique : aucune vocalisation.
      fetchMock.mockClear();
      await userEvent.type(screen.getByRole('textbox'), 'fais le');
      await userEvent.click(screen.getByRole('button', { name: /envoyer/i }));
      await waitFor(() => {
        expect(screen.getAllByText("C'est fait. Voilà.")).toHaveLength(2);
      });
      const speakCallsKeyboardTurn = fetchMock.mock.calls.filter(([u]) =>
        String(u).endsWith('/api/assistant/voice/speak'),
      ).length;
      expect(speakCallsKeyboardTurn).toBe(0);
    });

    it('confirmation vocale : transcript « oui » pendant un confirm_request → POST /confirm allowed:true', async () => {
      const confirmId = '7'.repeat(32);
      const fetchMock = routeFetch({
        transcript: 'oui',
        chat: () =>
          openSseResponse([
            {
              type: 'confirm_request',
              id: confirmId,
              tool: 'send_mail',
              description: 'Envoyer un mail à a@b.test',
            },
          ]),
      });
      render(<AssistantChat csrfToken="tok" firstName="Angelo" />);

      // Tour vocal initial : déclenche le confirm_request côté serveur (mocké).
      await pressAltAndRelease();
      await screen.findByRole('alertdialog');

      // Nouveau PTT pendant la confirmation en attente : le transcript "oui"
      // est consommé comme réponse Autoriser — pas de nouveau message.
      await pressAltAndRelease();

      await waitFor(() => {
        const confirmCall = fetchMock.mock.calls.find(([u]) =>
          String(u).endsWith('/api/assistant/confirm'),
        );
        expect(confirmCall).toBeDefined();
        const [, init] = confirmCall ?? [];
        expect(JSON.parse(String(init?.body))).toEqual({ id: confirmId, allowed: true });
      });
    });

    it('confirmation vocale : transcript ambigu → pas de POST /confirm, redemande à voix haute via /speak', async () => {
      const confirmId = '8'.repeat(32);
      const fetchMock = routeFetch({
        transcript: 'euh peut-être',
        chat: () =>
          openSseResponse([
            {
              type: 'confirm_request',
              id: confirmId,
              tool: 'send_mail',
              description: 'Envoyer un mail à a@b.test',
            },
          ]),
      });
      render(<AssistantChat csrfToken="tok" firstName="Angelo" />);

      await pressAltAndRelease();
      await screen.findByRole('alertdialog');

      fetchMock.mockClear();
      await pressAltAndRelease();

      await waitFor(() => {
        const speakCall = fetchMock.mock.calls.find(([u]) =>
          String(u).endsWith('/api/assistant/voice/speak'),
        );
        expect(speakCall).toBeDefined();
        const [, init] = speakCall ?? [];
        expect(JSON.parse(String(init?.body)) as { text: string }).toMatchObject({
          text: expect.stringContaining('Dis clairement') as unknown as string,
        });
      });
      expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/api/assistant/confirm'))).toBe(
        false,
      );
    });

    it('Échap pendant l’écoute → annule sans transcription (aucun POST /transcribe)', async () => {
      const fetchMock = routeFetch({});
      render(<AssistantChat csrfToken="tok" firstName="Angelo" />);

      fireEvent.keyDown(window, { key: 'Alt' });
      await waitFor(() => {
        expect(screen.getByTestId('voice-capsule')).toHaveAttribute('data-mode', 'recording');
      });

      fireEvent.keyDown(window, { key: 'Escape' });
      await waitFor(() => {
        expect(screen.queryByTestId('voice-capsule')).not.toBeInTheDocument();
      });

      expect(
        fetchMock.mock.calls.some(([u]) => String(u).endsWith('/api/assistant/voice/transcribe')),
      ).toBe(false);
    });

    it('interruption vocale : le reliquat du chunker ne repart jamais vers /speak après le PTT', async () => {
      // Tour vocal dont le flux SSE reste OUVERT avec un fragment SANS
      // délimiteur : il dort dans le buffer du chunker. Un nouveau PTT
      // (interruption) aborte le tour → le finally de send() ne doit PAS
      // flusher ce reliquat vers la file TTS fraîchement vidée.
      const encoder = new TextEncoder();
      let push!: (e: object) => void;
      let errorOut!: (err: Error) => void;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          push = (e) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
          errorOut = (err) => controller.error(err);
        },
      });
      const fetchMock = routeFetch({
        transcript: 'déplace la carte',
        // Fidèle au vrai fetch : l'abort du signal fait rejeter reader.read()
        // avec un AbortError — sans ce câblage, le mock resterait pendu.
        chat: (init) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            errorOut(err);
          });
          return new Response(stream as unknown as BodyInit, {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          });
        },
      });
      render(<AssistantChat csrfToken="tok" firstName="Angelo" />);

      await pressAltAndRelease();
      await screen.findByText('déplace la carte'); // bulle user : le tour est parti
      act(() => push({ type: 'chunk', text: 'Je déplace la carte' })); // pas de délimiteur
      await waitFor(() => {
        expect(screen.getByText('Je déplace la carte')).toBeInTheDocument();
      });

      // Nouveau PTT pendant le tour : interruption (abort du stream).
      fireEvent.keyDown(window, { key: 'Alt' });
      await waitFor(() => {
        expect(screen.getByRole('textbox')).not.toBeDisabled(); // tour terminé
      });

      // SANS le fix, flush() enverrait « Je déplace la carte » vers /speak.
      expect(
        fetchMock.mock.calls.some(([u]) => String(u).endsWith('/api/assistant/voice/speak')),
      ).toBe(false);
    });

    it('Stop pendant la lecture : les phrases SSE suivantes ne repartent plus vers /speak', async () => {
      // La lecture ne se termine jamais toute seule → la capsule reste en
      // mode 'speaking' et son bouton Stop est cliquable.
      FakeAudioContext.autoEnd = false;
      const encoder = new TextEncoder();
      let push!: (e: object) => void;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          push = (e) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
        },
      });
      const fetchMock = routeFetch({
        transcript: 'fais le',
        chat: () =>
          new Response(stream as unknown as BodyInit, {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          }),
      });
      render(<AssistantChat csrfToken="tok" firstName="Angelo" />);

      await pressAltAndRelease();
      await screen.findByText('fais le');
      act(() => push({ type: 'chunk', text: 'Première phrase. ' }));

      const stopButton = await screen.findByRole('button', { name: /arrêter la lecture/i });
      const speakCallsBefore = fetchMock.mock.calls.filter(([u]) =>
        String(u).endsWith('/api/assistant/voice/speak'),
      ).length;
      expect(speakCallsBefore).toBeGreaterThan(0);

      await userEvent.click(stopButton);
      act(() => push({ type: 'chunk', text: 'Deuxième phrase. ' }));
      await waitFor(() => {
        expect(screen.getByText(/Deuxième phrase/)).toBeInTheDocument();
      });

      // SANS le fix, le chunker survivant ré-enqueuerait la 2e phrase.
      const speakCallsAfter = fetchMock.mock.calls.filter(([u]) =>
        String(u).endsWith('/api/assistant/voice/speak'),
      ).length;
      expect(speakCallsAfter).toBe(speakCallsBefore);
    });

    it('relâche AVANT la permission micro : aucun enregistrement orphelin, aucun /transcribe', async () => {
      const fetchMock = routeFetch({});
      // getUserMedia suspendu — simule le dialogue de permission (même
      // pattern deferred que use-voice-recorder.test.ts).
      let resolvePermission!: (s: MediaStream) => void;
      (navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockReturnValue(
        new Promise<MediaStream>((res) => {
          resolvePermission = res;
        }),
      );
      render(<AssistantChat csrfToken="tok" firstName="Angelo" />);

      fireEvent.keyDown(window, { key: 'Alt' });
      // Relâche pendant l'attente : le keyup INCONDITIONNEL doit invalider le
      // start() suspendu (sinon : capture ambiante de 60 s auto-envoyée).
      fireEvent.keyUp(window, { key: 'Alt' });

      await act(async () => {
        resolvePermission(fakeStream); // l'utilisateur accorde ENSUITE la permission
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(FakeMediaRecorder.instances).toHaveLength(0);
      expect(screen.queryByTestId('voice-capsule')).not.toBeInTheDocument();
      expect(
        fetchMock.mock.calls.some(([u]) => String(u).endsWith('/api/assistant/voice/transcribe')),
      ).toBe(false);
    });

    it('Option maintenu ≥250 ms avec le champ de saisie focus → arme le PTT et retire le focus du champ', async () => {
      routeFetch({});
      render(<AssistantChat csrfToken="tok" firstName="Angelo" />);
      const input = screen.getByRole('textbox');
      act(() => input.focus());
      expect(input).toHaveFocus();

      fireEvent.keyDown(window, { key: 'Alt' });
      // Avant le délai : rien ne s'arme encore (le champ garde le focus).
      expect(screen.queryByTestId('voice-capsule')).not.toBeInTheDocument();
      expect(input).toHaveFocus();

      await act(async () => {
        await new Promise((r) => setTimeout(r, 260));
      });

      await waitFor(() => {
        expect(screen.getByTestId('voice-capsule')).toHaveAttribute('data-mode', 'recording');
      });
      expect(input).not.toHaveFocus();

      fireEvent.keyUp(window, { key: 'Alt' });
    });

    it('Option puis autre touche avant le délai (composition d’accent, ex. Option+e) → aucun PTT armé', async () => {
      const fetchMock = routeFetch({});
      render(<AssistantChat csrfToken="tok" firstName="Angelo" />);
      const input = screen.getByRole('textbox');
      act(() => input.focus());

      fireEvent.keyDown(window, { key: 'Alt' });
      fireEvent.keyDown(window, { key: 'e' }); // composition — annule le timer PTT
      fireEvent.keyUp(window, { key: 'Alt' });

      await act(async () => {
        await new Promise((r) => setTimeout(r, 260));
      });

      expect(screen.queryByTestId('voice-capsule')).not.toBeInTheDocument();
      expect(input).toHaveFocus();
      expect(
        fetchMock.mock.calls.some(([u]) => String(u).endsWith('/api/assistant/voice/transcribe')),
      ).toBe(false);
    });

    it('tap rapide d’Option (<250 ms) avec le champ de saisie focus → aucun PTT armé', async () => {
      routeFetch({});
      render(<AssistantChat csrfToken="tok" firstName="Angelo" />);
      const input = screen.getByRole('textbox');
      act(() => input.focus());

      fireEvent.keyDown(window, { key: 'Alt' });
      fireEvent.keyUp(window, { key: 'Alt' }); // relâché avant le délai

      await act(async () => {
        await new Promise((r) => setTimeout(r, 260));
      });

      expect(screen.queryByTestId('voice-capsule')).not.toBeInTheDocument();
      expect(input).toHaveFocus();
    });

    it('blur de la fenêtre pendant le délai de maintien (250 ms) → timer annulé, aucun enregistrement non surveillé', async () => {
      const fetchMock = routeFetch({});
      render(<AssistantChat csrfToken="tok" firstName="Angelo" />);
      const input = screen.getByRole('textbox');
      act(() => input.focus());

      fireEvent.keyDown(window, { key: 'Alt' });
      // Fenêtre quittée (Cmd+Tab…) AVANT l'échéance : le keyup Alt n'arrivera
      // jamais — si le timer survivait, il armerait une capture de 60 s sans
      // personne devant l'écran (vie privée).
      fireEvent(window, new Event('blur'));

      await act(async () => {
        await new Promise((r) => setTimeout(r, 300));
      });

      expect(screen.queryByTestId('voice-capsule')).not.toBeInTheDocument();
      expect(
        fetchMock.mock.calls.some(([u]) => String(u).endsWith('/api/assistant/voice/transcribe')),
      ).toBe(false);
    });

    it('auto-repeat d’Alt maintenu (Windows/Linux) pendant le délai → n’annule pas le timer, le PTT s’arme à 250 ms', async () => {
      routeFetch({});
      render(<AssistantChat csrfToken="tok" firstName="Angelo" />);
      const input = screen.getByRole('textbox');
      act(() => input.focus());

      fireEvent.keyDown(window, { key: 'Alt' });
      // Sous Windows/Linux, Alt tenu émet des keydown repeat:true — ils ne
      // doivent PAS passer pour une « autre touche » (composition) qui annule.
      await act(async () => {
        await new Promise((r) => setTimeout(r, 100));
      });
      fireEvent.keyDown(window, { key: 'Alt', repeat: true });

      await act(async () => {
        await new Promise((r) => setTimeout(r, 200));
      });

      await waitFor(() => {
        expect(screen.getByTestId('voice-capsule')).toHaveAttribute('data-mode', 'recording');
      });

      fireEvent.keyUp(window, { key: 'Alt' });
    });

    it('blur de la fenêtre pendant l’écoute → annulation, aucun /transcribe (vie privée)', async () => {
      const fetchMock = routeFetch({});
      render(<AssistantChat csrfToken="tok" firstName="Angelo" />);

      fireEvent.keyDown(window, { key: 'Alt' });
      await waitFor(() => {
        expect(screen.getByTestId('voice-capsule')).toHaveAttribute('data-mode', 'recording');
      });

      // Alt+Tab / changement de fenêtre : le keyup n'arrivera jamais.
      fireEvent(window, new Event('blur'));
      await waitFor(() => {
        expect(screen.queryByTestId('voice-capsule')).not.toBeInTheDocument();
      });

      expect(
        fetchMock.mock.calls.some(([u]) => String(u).endsWith('/api/assistant/voice/transcribe')),
      ).toBe(false);
    });
  });
});
