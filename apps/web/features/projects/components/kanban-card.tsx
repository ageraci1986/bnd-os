'use client';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useRouter } from 'next/navigation';

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
  const router = useRouter();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    data: { type: 'card', columnId: card.columnId },
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const className = ['kcard', blocked && 'blocked', isDragging && 'dragging']
    .filter(Boolean)
    .join(' ');

  // Distinguish click-to-open from drag-start: dnd-kit's PointerSensor only
  // activates on 4px move, so a plain click fires onClick without dragging.
  const open = (e: React.MouseEvent) => {
    if (isDragging) return;
    e.stopPropagation();
    const url = new URL(window.location.href);
    url.searchParams.set('card', card.id);
    router.replace(url.pathname + url.search, { scroll: false });
  };

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={className}
      onClick={open}
      {...attributes}
      {...listeners}
    >
      <div className="kcard-ref">#{String(card.shortRef).padStart(3, '0')}</div>
      <div className="kcard-title">{card.title}</div>
    </article>
  );
}
