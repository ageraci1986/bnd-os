import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * Résout `markNotificationRead` sur commande plutôt qu'immédiatement — un
 * mock résolu d'emblée laisserait le rollback s'exécuter pendant les
 * micro-tasks flushées par `userEvent.click`, avant même que le test ait pu
 * observer l'état optimiste (même convention que
 * `assistant-chat.widget-actions.test.tsx` / `mail-list-widget.test.tsx`).
 */
function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const { markNotificationReadSpy } = vi.hoisted(() => ({
  markNotificationReadSpy: vi.fn(),
}));
vi.mock('@/features/notifications/actions/mark-read', () => ({
  markNotificationRead: (...a: unknown[]) => markNotificationReadSpy(...a),
}));

import { NoticeStack } from './notice-stack';

function notice(overrides: Partial<{ id: string; message: string; discuss: string }> = {}) {
  return {
    id: 'n1',
    kind: 'agent_card_blocked' as const,
    message: '« Refonte site » est passée en Bloqué (échéance dépassée)',
    discuss: 'Parlons de la carte card-123 passée en Bloqué',
    ...overrides,
  };
}

beforeEach(() => {
  markNotificationReadSpy.mockReset();
});

describe('<NoticeStack />', () => {
  it('renders nothing for an empty list', () => {
    const { container } = render(<NoticeStack notices={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the notice message and the "Ignorer" button without actions', () => {
    render(<NoticeStack notices={[notice()]} />);
    expect(screen.getByText(notice().message)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ignorer/i })).toBeInTheDocument();
  });

  it('does not render "En discuter" when no actions channel is provided', () => {
    render(<NoticeStack notices={[notice()]} />);
    expect(screen.queryByRole('button', { name: /en discuter/i })).not.toBeInTheDocument();
  });

  it('renders "En discuter" when an actions channel is provided', () => {
    render(<NoticeStack notices={[notice()]} actions={{ sendMessage: vi.fn(), busy: false }} />);
    expect(screen.getByRole('button', { name: /en discuter/i })).toBeInTheDocument();
  });

  it('"En discuter" injects notice.discuss verbatim via sendMessage, marks read, and removes the notice immediately', async () => {
    markNotificationReadSpy.mockResolvedValue({ ok: true, affected: 1 });
    const sendMessage = vi.fn();
    render(
      <NoticeStack notices={[notice({ id: 'n42' })]} actions={{ sendMessage, busy: false }} />,
    );
    await userEvent.click(screen.getByRole('button', { name: /en discuter/i }));

    expect(sendMessage).toHaveBeenCalledWith('Parlons de la carte card-123 passée en Bloqué');
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(markNotificationReadSpy).toHaveBeenCalledWith({ notificationId: 'n42' });
    // Optimistic: gone from the DOM right away, no need to await markRead.
    expect(screen.queryByText(notice().message)).not.toBeInTheDocument();
  });

  it('"En discuter" keeps the notice dismissed even if markRead fails (documented trade-off)', async () => {
    markNotificationReadSpy.mockRejectedValue(new Error('network down'));
    const sendMessage = vi.fn();
    render(<NoticeStack notices={[notice()]} actions={{ sendMessage, busy: false }} />);
    await userEvent.click(screen.getByRole('button', { name: /en discuter/i }));

    expect(screen.queryByText(notice().message)).not.toBeInTheDocument();
    // Give the rejected promise's microtask a chance to run — the notice
    // must NOT reappear (no rollback on this path, by design).
    await waitFor(() => expect(markNotificationReadSpy).toHaveBeenCalled());
    expect(screen.queryByText(notice().message)).not.toBeInTheDocument();
  });

  it('"Ignorer" removes the notice optimistically then confirms via markRead', async () => {
    const { promise, resolve } = deferred<{ ok: true; affected: number }>();
    markNotificationReadSpy.mockReturnValue(promise);
    render(<NoticeStack notices={[notice({ id: 'n7' })]} />);

    await userEvent.click(screen.getByRole('button', { name: /ignorer/i }));
    expect(screen.queryByText(notice().message)).not.toBeInTheDocument();
    expect(markNotificationReadSpy).toHaveBeenCalledWith({ notificationId: 'n7' });

    resolve({ ok: true, affected: 1 });
    await waitFor(() => expect(screen.queryByText(notice().message)).not.toBeInTheDocument());
  });

  it('"Ignorer" rolls back (notice reappears) when markRead resolves {ok:false}', async () => {
    const { promise, resolve } = deferred<{ ok: false; message: string }>();
    markNotificationReadSpy.mockReturnValue(promise);
    render(<NoticeStack notices={[notice()]} />);

    await userEvent.click(screen.getByRole('button', { name: /ignorer/i }));
    expect(screen.queryByText(notice().message)).not.toBeInTheDocument();

    resolve({ ok: false, message: 'boom' });
    await waitFor(() => expect(screen.getByText(notice().message)).toBeInTheDocument());
  });

  it('"Ignorer" rolls back (notice reappears) when markRead throws', async () => {
    const { promise, resolve } = deferred<{ ok: true; affected: number }>();
    markNotificationReadSpy.mockReturnValue(
      promise.then(() => {
        throw new Error('network down');
      }),
    );
    render(<NoticeStack notices={[notice()]} />);

    await userEvent.click(screen.getByRole('button', { name: /ignorer/i }));
    expect(screen.queryByText(notice().message)).not.toBeInTheDocument();

    resolve({ ok: true, affected: 1 });
    await waitFor(() => expect(screen.getByText(notice().message)).toBeInTheDocument());
  });

  it('renders multiple notices, each dismissible independently', async () => {
    markNotificationReadSpy.mockResolvedValue({ ok: true, affected: 1 });
    render(
      <NoticeStack
        notices={[
          notice({ id: 'n1', message: 'Notice une' }),
          notice({ id: 'n2', message: 'Notice deux' }),
        ]}
      />,
    );
    expect(screen.getByText('Notice une')).toBeInTheDocument();
    expect(screen.getByText('Notice deux')).toBeInTheDocument();

    await userEvent.click(screen.getAllByRole('button', { name: /ignorer/i })[0]!);
    expect(screen.queryByText('Notice une')).not.toBeInTheDocument();
    expect(screen.getByText('Notice deux')).toBeInTheDocument();
  });

  it('is not wrapped in an aria-live region', () => {
    render(<NoticeStack notices={[notice()]} />);
    expect(screen.getByText(notice().message).closest('[aria-live]')).toBeNull();
  });
});
