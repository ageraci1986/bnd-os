import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
});
