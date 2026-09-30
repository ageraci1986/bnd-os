import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

// Vitest hoists vi.mock above all imports, so anything it references
// must come from `vi.hoisted()` (not a top-level `const`).
const { updateCardDueDate, addCardAssignee, notify } = vi.hoisted(() => ({
  updateCardDueDate: vi.fn(),
  addCardAssignee: vi.fn(),
  notify: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('../actions/update-card-due-date', () => ({ updateCardDueDate }));
vi.mock('../actions/card-assignees', () => ({
  addCardAssignee,
  removeCardAssignee: vi.fn(),
  updateCardAssigneeRaci: vi.fn(),
}));
vi.mock('../actions/checklist', () => ({
  createChecklistItem: vi.fn(),
  deleteChecklistItem: vi.fn(),
  toggleChecklistItem: vi.fn(),
}));
vi.mock('../actions/advance-card', () => ({ advanceCard: vi.fn() }));
vi.mock('../actions/update-card', () => ({ updateCard: vi.fn() }));
vi.mock('../actions/delete-card', () => ({ deleteCard: vi.fn() }));
vi.mock('../actions/update-card-field', () => ({ updateCardField: vi.fn() }));
vi.mock('../actions/change-card-template', () => ({ changeCardTemplate: vi.fn() }));
vi.mock('@/features/shell/components/toaster', () => ({ notify }));
vi.mock('./card-comments-thread', () => ({ CardCommentsThread: () => null }));

import { CardModal, type CardModalProps } from './card-modal';
import { CARD_UPDATED_EVENT, type CardUpdatedEventDetail } from './card-modal-controller';

const CARD_ID = '11111111-1111-1111-1111-111111111111';

const skeleton: CardModalProps['card'] = {
  id: CARD_ID,
  title: 'Refonte',
  description: null,
  dueDate: null,
  shortRef: 1,
  position: 1,
  columnId: '',
  columnName: '',
  columnIsBlocked: false,
  nextColumnName: null,
  categoryTag: null,
  checklist: [],
  assignees: [],
  templateId: null,
  templateItems: [],
  fieldValues: {},
  comments: [],
};

const loaded: CardModalProps['card'] = {
  ...skeleton,
  dueDate: '2026-10-15T00:00:00.000Z',
  columnId: 'col-1',
  columnName: 'À faire',
  assignees: [{ userId: 'u-1', displayName: 'Alice Martin', initials: 'AM', raci: 'responsible' }],
};

const baseProps: Omit<CardModalProps, 'card' | 'isLoading'> = {
  csrfToken: 'csrf',
  workspaceName: 'WS',
  projectName: 'Projet',
  customCategories: [],
  isNew: false,
  workspaceMembers: [
    { userId: 'u-1', displayName: 'Alice Martin', initials: 'AM', email: 'a@x.io' },
    { userId: 'u-2', displayName: 'Bob Durand', initials: 'BD', email: 'b@x.io' },
  ],
  availableTemplates: [],
  onClose: vi.fn(),
};

beforeEach(() => {
  updateCardDueDate.mockReset();
  addCardAssignee.mockReset();
  notify.mockReset();
});

describe('<CardModal /> — skeleton → loaded detail', () => {
  it('shows the persisted due date once the detail has loaded', () => {
    const { rerender, container } = render(<CardModal {...baseProps} card={skeleton} isLoading />);
    rerender(<CardModal {...baseProps} card={loaded} isLoading={false} />);
    const input = container.querySelector('input[type="date"]') as HTMLInputElement;
    expect(input.value).toBe('2026-10-15');
  });

  it('shows the persisted assignees once the detail has loaded', () => {
    const { rerender } = render(<CardModal {...baseProps} card={skeleton} isLoading />);
    rerender(<CardModal {...baseProps} card={loaded} isLoading={false} />);
    expect(screen.getByText('Alice Martin')).toBeInTheDocument();
    expect(screen.queryByText('Aucun assigné.')).not.toBeInTheDocument();
  });
});

describe('<CardModal /> — board sync events', () => {
  it('emits CARD_UPDATED with the new due date once saved', async () => {
    updateCardDueDate.mockResolvedValue({
      ok: true,
      autoBlocked: false,
      autoUnblocked: false,
      newColumnId: 'col-1',
      newDueDate: '2026-11-02T00:00:00.000Z',
    });
    const events: CardUpdatedEventDetail[] = [];
    const listener = (e: Event) => events.push((e as CustomEvent<CardUpdatedEventDetail>).detail);
    window.addEventListener(CARD_UPDATED_EVENT, listener);

    const { container } = render(<CardModal {...baseProps} card={loaded} isLoading={false} />);
    const input = container.querySelector('input[type="date"]') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: '2026-11-02' } });
    });

    window.removeEventListener(CARD_UPDATED_EVENT, listener);
    expect(updateCardDueDate).toHaveBeenCalledWith({ cardId: CARD_ID, dueDate: '2026-11-02' });
    expect(events).toContainEqual({ id: CARD_ID, dueDate: '2026-11-02T00:00:00.000Z' });
  });

  it('emits CARD_UPDATED with the new assignee list once saved', async () => {
    addCardAssignee.mockResolvedValue({ ok: true });
    const events: CardUpdatedEventDetail[] = [];
    const listener = (e: Event) => events.push((e as CustomEvent<CardUpdatedEventDetail>).detail);
    window.addEventListener(CARD_UPDATED_EVENT, listener);

    render(<CardModal {...baseProps} card={loaded} isLoading={false} />);
    fireEvent.click(screen.getByRole('button', { name: /Assigner un membre/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Bob Durand/ }));
    });

    window.removeEventListener(CARD_UPDATED_EVENT, listener);
    const last = events.at(-1);
    expect(last?.id).toBe(CARD_ID);
    expect(last?.assignees?.map((a) => a.userId)).toEqual(['u-1', 'u-2']);
  });
});

describe('<CardModal /> — Bloqué routing feedback', () => {
  async function changeDueDate(result: { autoBlocked: boolean; autoUnblocked: boolean }) {
    updateCardDueDate.mockResolvedValue({
      ok: true,
      ...result,
      newColumnId: 'col-x',
      newDueDate: '2026-01-01T00:00:00.000Z',
    });
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    const onClose = vi.fn();
    const { container } = render(
      <CardModal {...baseProps} onClose={onClose} card={loaded} isLoading={false} />,
    );
    const input = container.querySelector('input[type="date"]') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: '2026-01-01' } });
    });
    return { alert, onClose };
  }

  it('uses an in-app toast (not a system alert) when the card gets blocked', async () => {
    const { alert, onClose } = await changeDueDate({ autoBlocked: true, autoUnblocked: false });
    expect(alert).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ tone: 'error', message: expect.stringMatching(/Bloqué/) }),
    );
    expect(onClose).toHaveBeenCalled();
    alert.mockRestore();
  });

  it('uses an in-app toast when the card leaves Bloqué', async () => {
    const { alert } = await changeDueDate({ autoBlocked: false, autoUnblocked: true });
    expect(alert).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ tone: 'success', message: expect.stringMatching(/Bloqué/) }),
    );
    alert.mockRestore();
  });
});
