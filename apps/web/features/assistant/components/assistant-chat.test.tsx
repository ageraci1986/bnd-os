import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
// jsdom's global `Blob` doesn't implement `.stream()` — use Node's, which does.
import { Blob as NodeBlob } from 'node:buffer';
import { AssistantChat } from './assistant-chat';

function sseResponse(events: object[]): Response {
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
  return new Response(new NodeBlob([body]).stream() as unknown as ReadableStream, {
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
});
