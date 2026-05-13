'use client';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Tag, type TagVariant } from '@nexushub/ui';
import { BUILTIN_CARD_CATEGORIES, isBuiltinCardCategory } from '@nexushub/domain';
import { OPEN_CARD_EVENT, type OpenCardEventDetail } from './card-modal-controller';

export interface KanbanCardData {
  readonly id: string;
  readonly shortRef: number;
  readonly title: string;
  readonly columnId: string;
  readonly categoryTag: string | null;
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

  const className = ['kcard', blocked && 'blocked', isDragging && 'dragging']
    .filter(Boolean)
    .join(' ');

  // Distinguish click-to-open from drag-start: dnd-kit's PointerSensor only
  // activates on 4px move, so a plain click fires onClick without dragging.
  // The modal is opened by dispatching an event the CardModalController
  // listens to — no router round-trip, no RSC refetch.
  const open = (e: React.MouseEvent) => {
    if (isDragging) return;
    e.stopPropagation();
    const detail: OpenCardEventDetail = {
      id: card.id,
      title: card.title,
      shortRef: card.shortRef,
      categoryTag: card.categoryTag,
    };
    window.dispatchEvent(new CustomEvent(OPEN_CARD_EVENT, { detail }));
  };

  const categoryLabel = card.categoryTag
    ? BUILTIN_CARD_CATEGORIES.find((c) => c.id === card.categoryTag)?.label
    : null;

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={className}
      onClick={open}
      {...attributes}
      {...listeners}
    >
      {categoryLabel && isBuiltinCardCategory(card.categoryTag) ? (
        <div className="kcard-tags">
          <Tag variant={card.categoryTag as TagVariant} size="sm">
            {categoryLabel}
          </Tag>
        </div>
      ) : null}
      <div className="kcard-ref">#{String(card.shortRef).padStart(3, '0')}</div>
      <div className="kcard-title">{card.title}</div>
    </article>
  );
}
