import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
// jsdom's global `Blob` doesn't implement `.stream()` — use Node's, which does.
import { Blob as NodeBlob } from 'node:buffer';

/**
 * Fichier dédié (isolé de `assistant-chat.test.tsx`) : ce test mocke le
 * module `./widgets` entier pour espionner les arguments passés à
 * `renderWidget` par `assistant-chat`. Le mocker dans le fichier de tests
 * principal casserait toutes les assertions qui reposent sur le rendu réel
 * des widgets (KpiCards, BoardWidget…) — ce fichier ne teste QUE le canal
 * d'actions (Plan 5c Task 1), pas le rendu des widgets eux-mêmes.
 */
interface CapturedActions {
  readonly sendMessage: (text: string) => void;
  readonly busy: boolean;
}
const renderWidgetMock = vi.fn(
  (_tool: string, _data: unknown, _actions?: CapturedActions): null => null,
);
vi.mock('./widgets', () => ({
  renderWidget: (tool: string, data: unknown, actions?: CapturedActions) =>
    renderWidgetMock(tool, data, actions),
}));
vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// Import après les mocks (hoistés par vi.mock de toute façon, mais garde
// l'ordre de lecture cohérent avec assistant-chat.test.tsx).
import { AssistantChat } from './assistant-chat';

function sseResponse(events: object[]): Response {
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
  return new Response(new NodeBlob([body]).stream() as unknown as ReadableStream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

const overviewData = { blockedCards: 1, dueTodayCards: 0, unreadMails: 0, unreadNotifications: 0 };

describe('AssistantChat — canal d actions widgets (WidgetActions)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    renderWidgetMock.mockClear();
  });

  it('passe {sendMessage, busy} à renderWidget — busy:true pendant le tour, busy:false une fois commité', async () => {
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
      push({ type: 'tool_result', tool: 'get_today_overview', data: overviewData });
    });

    await waitFor(() => {
      const busyCall = renderWidgetMock.mock.calls.find(
        ([tool, , actions]) => tool === 'get_today_overview' && actions?.busy === true,
      );
      expect(busyCall).toBeDefined();
      expect(typeof busyCall?.[2]?.sendMessage).toBe('function');
    });

    act(() => {
      push({ type: 'done', text: 'Voici votre briefing.' });
      close();
    });
    await screen.findByText('Voici votre briefing.');

    await waitFor(() => {
      const idleCall = renderWidgetMock.mock.calls.find(
        ([tool, , actions]) => tool === 'get_today_overview' && actions?.busy === false,
      );
      expect(idleCall).toBeDefined();
    });
  });

  it('sendMessage capturé envoie le texte exact au serveur sans toucher le champ de saisie', async () => {
    let call = 0;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      call += 1;
      if (call === 1) {
        return Promise.resolve(
          sseResponse([
            { type: 'tool_result', tool: 'get_today_overview', data: overviewData },
            { type: 'done', text: 'Un.' },
          ]),
        );
      }
      return Promise.resolve(sseResponse([{ type: 'done', text: 'Deux.' }]));
    });

    render(<AssistantChat csrfToken="tok" firstName="Angelo" />);
    const textbox = screen.getByRole('textbox');
    await userEvent.type(textbox, 'mon briefing');
    await userEvent.click(screen.getByRole('button', { name: /envoyer/i }));
    await screen.findByText('Un.');

    // Le widget est désormais commité (busy: false) — capture son sendMessage.
    const committedCall = renderWidgetMock.mock.calls.find(
      ([tool, , actions]) => tool === 'get_today_overview' && actions?.busy === false,
    );
    expect(committedCall).toBeDefined();
    const actions = committedCall?.[2];
    if (actions === undefined) throw new Error('actions manquantes');

    // L'utilisateur a un brouillon en cours dans l'input — il ne doit pas bouger.
    await userEvent.type(textbox, 'brouillon utilisateur en cours');
    expect(textbox).toHaveValue('brouillon utilisateur en cours');

    act(() => actions.sendMessage('Marque comme lus ces mails : m1,m2'));

    await screen.findByText('Deux.');
    expect(textbox).toHaveValue('brouillon utilisateur en cours');

    const secondCall = fetchMock.mock.calls[1];
    const body = JSON.parse(String(secondCall?.[1]?.body)) as { message: string };
    expect(body.message).toBe('Marque comme lus ces mails : m1,m2');
    // Le message injecté apparaît dans le fil comme un message utilisateur normal.
    expect(screen.getByText('Marque comme lus ces mails : m1,m2')).toBeInTheDocument();
  });

  it('identité de {sendMessage,busy} STABLE pendant la frappe (mandat B) — ne change que sur busy, jamais à chaque caractère tapé', async () => {
    // Sans la ref (mandat B), `send` (donc `widgetActions`) changeait
    // d'identité à chaque frappe — un widget dépendant de `actions` dans un
    // tableau de deps d'effet (ex. autosave debouncé de MailDraftWidget)
    // verrait cet effet se redéclencher inutilement à chaque caractère tapé.
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      sseResponse([
        { type: 'tool_result', tool: 'get_today_overview', data: overviewData },
        { type: 'done', text: 'Un.' },
      ]),
    );

    render(<AssistantChat csrfToken="tok" firstName="Angelo" />);
    await userEvent.type(screen.getByRole('textbox'), 'mon briefing');
    await userEvent.click(screen.getByRole('button', { name: /envoyer/i }));
    await screen.findByText('Un.');
    fetchMock.mockClear();

    const before = renderWidgetMock.mock.calls.at(-1)?.[2];
    if (before === undefined) throw new Error('actions manquantes');
    renderWidgetMock.mockClear();

    // Le tour précédent est terminé (busy:false) — taper dans le champ ne
    // doit PAS produire une nouvelle identité de `actions`.
    await userEvent.type(screen.getByRole('textbox'), 'brouillon en cours');

    const after = renderWidgetMock.mock.calls.at(-1)?.[2];
    if (after === undefined) throw new Error('actions manquantes après frappe');
    expect(after).toBe(before);
  });

  it('sendMessage capturé pendant busy:true est un no-op — même garde que le formulaire, pas de second POST', async () => {
    const encoder = new TextEncoder();
    let push!: (e: object) => void;
    // Flux volontairement jamais fermé : le tour reste `busy` indéfiniment.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        push = (e) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      },
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(stream as unknown as BodyInit, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );

    render(<AssistantChat csrfToken="tok" firstName="Angelo" />);
    await userEvent.type(screen.getByRole('textbox'), 'mon briefing');
    await userEvent.click(screen.getByRole('button', { name: /envoyer/i }));

    act(() => {
      push({ type: 'tool_result', tool: 'get_today_overview', data: overviewData });
    });

    // Capture les actions transmises pendant que le tour est en cours (busy:true).
    const busyCall = await waitFor(() => {
      const found = renderWidgetMock.mock.calls.find(
        ([tool, , actions]) => tool === 'get_today_overview' && actions?.busy === true,
      );
      expect(found).toBeDefined();
      return found;
    });
    const actions = busyCall?.[2];
    if (actions === undefined) throw new Error('actions manquantes');
    expect(actions.busy).toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    // sendMessage appelle send(t) qui retourne tôt tant que `busy` est vrai
    // (même garde que le formulaire) : aucun second POST ne doit partir.
    act(() => actions.sendMessage('Marque comme lus ces mails : m1,m2'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
