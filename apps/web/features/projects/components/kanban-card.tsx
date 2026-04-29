'use client';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

export interface KanbanCardData {
  readonly id: string;
  readonly shortRef: number;
  readonly title: string;
  readonly columnId: string;
}

export interface KanbanCardProps {
  readonly card: KanbanCardData;
  /** When true, renders a flat blocked variant (column.isBlockedSystem). */
  readonly blocked?: boolean;
}

/**
 * Sortable card. Wraps the visual `.kcard` block in dnd-kit's useSortable
 * so each card is both a drag handle and a drop target.
 */
export function KanbanCard({ card, blocked }: KanbanCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    data: { type: 'card', columnId: card.columnId },
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={`kcard${blocked ? 'blocked' : ''}${isDragging ? 'dragging' : ''}`}
      {...attributes}
      {...listeners}
    >
      <div className="kcard-ref">#{String(card.shortRef).padStart(3, '0')}</div>
      <div className="kcard-title">{card.title}</div>
    </article>
  );
}
