import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import { SortableContext } from '@dnd-kit/sortable';

vi.mock('./card-advance-checkbox', () => ({ CardAdvanceCheckbox: () => null }));
vi.mock('./card-completed-badge', () => ({ CardCompletedBadge: () => null }));
vi.mock('./delete-kanban-card-button', () => ({ DeleteKanbanCardButton: () => null }));
// The controller pulls in the modal + its server actions; only the event
// name is needed here.
vi.mock('./card-modal-controller', () => ({ OPEN_CARD_EVENT: 'nx:open-card' }));

import { KanbanCard, type KanbanCardData } from './kanban-card';

function renderCard(card: KanbanCardData) {
  return render(
    <DndContext>
      <SortableContext items={[card.id]}>
        <KanbanCard card={card} />
      </SortableContext>
    </DndContext>,
  );
}

const base: KanbanCardData = {
  id: 'card-1',
  shortRef: 1,
  title: 'Refonte',
  columnId: 'col-1',
  categoryTag: null,
};

describe('<KanbanCard /> — assignees', () => {
  it('renders an avatar per assignee', () => {
    renderCard({
      ...base,
      assignees: [
        { userId: 'u-1', displayName: 'Alice Martin', initials: 'AM' },
        { userId: 'u-2', displayName: 'Bob Durand', initials: 'BD' },
      ],
    });
    expect(screen.getByRole('img', { name: 'Alice Martin' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Bob Durand' })).toBeInTheDocument();
  });

  it('caps the stack at 3 avatars and shows the overflow count', () => {
    renderCard({
      ...base,
      assignees: ['A', 'B', 'C', 'D', 'E'].map((l, i) => ({
        userId: `u-${i}`,
        displayName: `User ${l}`,
        initials: l,
      })),
    });
    expect(screen.getAllByRole('img')).toHaveLength(3);
    expect(screen.getByText('+2')).toBeInTheDocument();
  });

  it('renders no footer when nobody is assigned', () => {
    const { container } = renderCard(base);
    expect(container.querySelector('.kcard-avatars')).toBeNull();
  });
});
