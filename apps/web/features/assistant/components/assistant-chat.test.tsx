import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
// jsdom's global `Blob` doesn't implement `.stream()` — use Node's, which does.
import { Blob as NodeBlob } from 'node:buffer';
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
    act(() => push({ type: 'tool_start', name: 'list_projects' }));
    await waitFor(() => {
      expect(screen.getByText('consulte les projets…')).toBeInTheDocument();
    });
    act(() => {
      push({ type: 'tool_end', name: 'list_projects', isError: false });
      push({ type: 'done', text: 'Deux projets.' });
      close();
    });
    await waitFor(() => {
      expect(screen.getByText('Deux projets.')).toBeInTheDocument();
    });
    expect(screen.queryByText('consulte les projets…')).not.toBeInTheDocument();
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
});
