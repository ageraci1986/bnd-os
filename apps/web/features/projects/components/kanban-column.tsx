'use client';
import { useTransition } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSRF_FIELD_NAME } from '@/lib/csrf/field';
import { createCard } from '../actions/create-card';
import { KanbanCard, type KanbanCardData } from './kanban-card';
import {
  CARD_CREATED_EVENT,
  CARD_REMOVED_EVENT,
  CARD_SHORTREF_RESOLVED_EVENT,
  CLOSE_CARD_EVENT,
  OPEN_CARD_EVENT,
  type CardCreatedEventDetail,
  type OpenCardEventDetail,
} from './card-modal-controller';

const PLACEHOLDER_TITLE = 'Nouvelle carte';

export interface KanbanColumnData {
  readonly id: string;
  readonly name: string;
  readonly isBlockedSystem: boolean;
}

export interface KanbanColumnProps {
  readonly csrfToken: string;
  readonly projectId: string;
  readonly column: KanbanColumnData;
  readonly cards: readonly KanbanCardData[];
}

export function KanbanColumn({ csrfToken, projectId, column, cards }: KanbanColumnProps) {
  const [pending, startTransition] = useTransition();

  const { setNodeRef, isOver } = useDroppable({
    id: `col:${column.id}`,
    data: { type: 'column', columnId: column.id },
    disabled: column.isBlockedSystem,
  });

  const colCls = ['column', column.isBlockedSystem && 'blocked'].filter(Boolean).join(' ');
  const cardsCls = ['col-cards', isOver && 'is-over'].filter(Boolean).join(' ');

  const handleAdd = () => {
    // Optimistic UUID — same id used client-side and server-side so the
    // modal can open BEFORE the round-trip finishes. shortRef stays 0
    // until the server returns; the controller patches it in then.
    const optimisticId = crypto.randomUUID();

    const created: CardCreatedEventDetail = {
      id: optimisticId,
      columnId: column.id,
      shortRef: 0,
      title: PLACEHOLDER_TITLE,
      categoryTag: null,
    };
    window.dispatchEvent(new CustomEvent(CARD_CREATED_EVENT, { detail: created }));

    const open: OpenCardEventDetail = {
      id: optimisticId,
      title: PLACEHOLDER_TITLE,
      shortRef: 0,
      categoryTag: null,
      isNew: true,
    };
    window.dispatchEvent(new CustomEvent(OPEN_CARD_EVENT, { detail: open }));

    const fd = new FormData();
    fd.set(CSRF_FIELD_NAME, csrfToken);
    fd.set('projectId', projectId);
    fd.set('columnId', column.id);
    fd.set('title', PLACEHOLDER_TITLE);
    fd.set('proposedId', optimisticId);
    startTransition(async () => {
      const res = await createCard({ status: 'idle' }, fd);
      if (res.status === 'error') {
        // Rollback: take the optimistic row off the board + close modal.
        window.dispatchEvent(new CustomEvent(CARD_REMOVED_EVENT, { detail: { id: optimisticId } }));
        window.dispatchEvent(new CustomEvent(CLOSE_CARD_EVENT));
        window.alert(res.message);
      } else if (res.status === 'success' && res.shortRef !== 0) {
        // Patch the optimistic row's shortRef now that the server assigned it.
        window.dispatchEvent(
          new CustomEvent(CARD_SHORTREF_RESOLVED_EVENT, {
            detail: { id: res.cardId, shortRef: res.shortRef },
          }),
        );
      }
    });
  };

  return (
    <section className={colCls}>
      <header className="col-header">
        <div className="col-title">
          <span className="col-dot" />
          {column.name}
        </div>
        <span className="col-count">{cards.length}</span>
      </header>

      <div ref={setNodeRef} className={cardsCls}>
        <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          {cards.map((card) => (
            <KanbanCard key={card.id} card={card} blocked={column.isBlockedSystem} />
          ))}
        </SortableContext>
      </div>

      {!column.isBlockedSystem ? (
        <button
          type="button"
          className="add-card-btn"
          onClick={handleAdd}
          disabled={pending}
          aria-label={`Ajouter une carte dans ${column.name}`}
        >
          {pending ? 'Création…' : '+ Ajouter une carte'}
        </button>
      ) : null}
    </section>
  );
}
