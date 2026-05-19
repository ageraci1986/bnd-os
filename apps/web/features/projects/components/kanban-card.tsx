'use client';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Tag, type TagVariant } from '@nexushub/ui';
import { BUILTIN_CARD_CATEGORIES } from '@nexushub/domain';
import { OPEN_CARD_EVENT, type OpenCardEventDetail } from './card-modal-controller';
import { CardAdvanceCheckbox } from './card-advance-checkbox';
import { DeleteKanbanCardButton } from './delete-kanban-card-button';
import { customCategoryColor } from '../lib/custom-category-color';

export interface KanbanCardData {
  readonly id: string;
  readonly shortRef: number;
  readonly title: string;
  readonly columnId: string;
  readonly categoryTag: string | null;
  readonly commentCount?: number;
}

export interface KanbanCardProps {
  readonly card: KanbanCardData;
  /** When true, renders a flat blocked variant (column.isBlockedSystem). */
  readonly blocked?: boolean;
  /** When true, the advance checkbox is disabled (last user column or
   *  blocked). The board computes this from the columns ordering. */
  readonly cannotAdvance?: boolean;
  /** CSRF token forwarded to inline actions (delete). Omitted when used
   *  inside the dnd-kit <DragOverlay>, which is a transient render. */
  readonly csrfToken?: string;
  /** When true, drag handle / delete / advance shortcut are hidden or
   *  disabled (Viewer role). Click-to-open the modal stays enabled. */
  readonly isReadOnly?: boolean;
}

/**
 * Sortable card. Wraps the visual `.kcard` block in dnd-kit's useSortable
 * so each card is both a drag handle and a drop target.
 */
export function KanbanCard({
  card,
  blocked,
  cannotAdvance,
  csrfToken,
  isReadOnly = false,
}: KanbanCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    data: { type: 'card', columnId: card.columnId },
    disabled: isReadOnly,
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

  // Built-in categories get a known label + a coloured Tag variant.
  // Custom (workspace-defined) categories get a deterministic colour
  // hashed from the label so the same name always renders the same hue.
  const builtin = card.categoryTag
    ? BUILTIN_CARD_CATEGORIES.find((c) => c.id === card.categoryTag)
    : null;
  const categoryLabel = builtin?.label ?? card.categoryTag ?? null;
  const customColor = card.categoryTag && !builtin ? customCategoryColor(card.categoryTag) : null;

  // Read-only viewers: skip drag listeners entirely so the card is
  // click-to-open only (no DnD, no visual handle behaviour). aria-attrs
  // from dnd-kit are still safe to forward — they describe the disabled
  // state.
  const dragProps = isReadOnly ? {} : { ...attributes, ...listeners };

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={`${className} group relative`}
      onClick={open}
      {...dragProps}
    >
      {csrfToken ? (
        <>
          <div style={{ position: 'absolute', top: 10, left: 12, zIndex: 10 }}>
            <CardAdvanceCheckbox
              cardId={card.id}
              disabled={Boolean(blocked || cannotAdvance || isReadOnly)}
            />
          </div>
          {!isReadOnly ? (
            <div
              style={{ position: 'absolute', top: 8, right: 8, zIndex: 10 }}
              className="pointer-events-none opacity-0 transition-opacity duration-150 focus-within:pointer-events-auto focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100"
            >
              <DeleteKanbanCardButton
                cardId={card.id}
                cardTitle={card.title}
                csrfToken={csrfToken}
              />
            </div>
          ) : null}
        </>
      ) : null}
      {categoryLabel ? (
        <div className="kcard-tags" style={csrfToken ? { paddingLeft: 26 } : undefined}>
          {builtin ? (
            <Tag variant={card.categoryTag as TagVariant} size="sm">
              {categoryLabel}
            </Tag>
          ) : (
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.5px]"
              style={{
                background: customColor?.bg,
                color: customColor?.fg,
              }}
            >
              {categoryLabel}
            </span>
          )}
        </div>
      ) : null}
      <div
        className="kcard-ref"
        style={csrfToken && !categoryLabel ? { paddingLeft: 26 } : undefined}
      >
        #{String(card.shortRef).padStart(3, '0')}
      </div>
      <div className="kcard-title">{card.title}</div>
      {card.commentCount && card.commentCount > 0 ? (
        <div
          className="kcard-comments"
          title={`${card.commentCount} commentaire${card.commentCount > 1 ? 's' : ''}`}
          aria-label={`${card.commentCount} commentaire${card.commentCount > 1 ? 's' : ''}`}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            width="12"
            height="12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M2 4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H6.5L4 14.5V12a2 2 0 0 1-2-2V4z" />
          </svg>
          <span>{card.commentCount}</span>
        </div>
      ) : null}
    </article>
  );
}
