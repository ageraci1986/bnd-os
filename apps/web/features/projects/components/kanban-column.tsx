'use client';
import { useState, useTransition } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSRF_FIELD_NAME } from '@/lib/csrf/field';
import { createCard } from '../actions/create-card';
import { KanbanCard, type KanbanCardData } from './kanban-card';

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
  const [showAdder, setShowAdder] = useState(false);

  const { setNodeRef, isOver } = useDroppable({
    id: `col:${column.id}`,
    data: { type: 'column', columnId: column.id },
    disabled: column.isBlockedSystem,
  });

  return (
    <section className={`column${column.isBlockedSystem ? 'blocked' : ''}`}>
      <header className="col-header">
        <div className="col-title">
          <span className="col-dot" />
          {column.name}
        </div>
        <span className="col-count">{cards.length}</span>
      </header>

      <div ref={setNodeRef} className={`col-cards${isOver ? 'is-over' : ''}`}>
        <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          {cards.map((card) => (
            <KanbanCard key={card.id} card={card} blocked={column.isBlockedSystem} />
          ))}
        </SortableContext>
      </div>

      {!column.isBlockedSystem ? (
        showAdder ? (
          <AddCardForm
            csrfToken={csrfToken}
            projectId={projectId}
            columnId={column.id}
            onClose={() => setShowAdder(false)}
          />
        ) : (
          <button
            type="button"
            className="add-card-btn"
            onClick={() => setShowAdder(true)}
            aria-label={`Ajouter une carte dans ${column.name}`}
          >
            + Ajouter une carte
          </button>
        )
      ) : null}
    </section>
  );
}

function AddCardForm({
  csrfToken,
  projectId,
  columnId,
  onClose,
}: {
  csrfToken: string;
  projectId: string;
  columnId: string;
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (title.trim().length === 0) return;
    const fd = new FormData();
    fd.set(CSRF_FIELD_NAME, csrfToken);
    fd.set('projectId', projectId);
    fd.set('columnId', columnId);
    fd.set('title', title);
    startTransition(async () => {
      const res = await createCard({ status: 'idle' }, fd);
      if (res.status === 'error') {
        setError(res.message);
        return;
      }
      setTitle('');
      setError(null);
      onClose();
    });
  };

  return (
    <form
      onSubmit={submit}
      className="rounded-xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-3"
    >
      <textarea
        autoFocus
        rows={2}
        maxLength={160}
        placeholder="Titre de la carte"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="field-input"
      />
      {error ? (
        <p role="alert" className="mt-1 text-xs text-[color:var(--color-danger)]">
          {error}
        </p>
      ) : null}
      <div className="mt-2 flex gap-2">
        <button
          type="submit"
          className="btn btn-primary btn-sm"
          disabled={pending || title.trim().length === 0}
        >
          {pending ? 'Ajout…' : 'Ajouter'}
        </button>
        <button type="button" onClick={onClose} className="btn btn-ghost btn-sm">
          Annuler
        </button>
      </div>
    </form>
  );
}
