'use client';
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSRF_FIELD_NAME } from '@/lib/csrf/field';
import { createCard } from '../actions/create-card';
import { KanbanCard, type KanbanCardData } from './kanban-card';

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
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const { setNodeRef, isOver } = useDroppable({
    id: `col:${column.id}`,
    data: { type: 'column', columnId: column.id },
    disabled: column.isBlockedSystem,
  });

  const colCls = ['column', column.isBlockedSystem && 'blocked'].filter(Boolean).join(' ');
  const cardsCls = ['col-cards', isOver && 'is-over'].filter(Boolean).join(' ');

  const handleAdd = () => {
    const fd = new FormData();
    fd.set(CSRF_FIELD_NAME, csrfToken);
    fd.set('projectId', projectId);
    fd.set('columnId', column.id);
    fd.set('title', PLACEHOLDER_TITLE);
    startTransition(async () => {
      const res = await createCard({ status: 'idle' }, fd);
      if (res.status === 'success') {
        // Open the modal directly with `new=1` so the title input
        // autofocuses and selects the placeholder text.
        const url = new URL(window.location.href);
        url.searchParams.set('card', res.cardId);
        url.searchParams.set('new', '1');
        router.replace(url.pathname + url.search, { scroll: false });
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
