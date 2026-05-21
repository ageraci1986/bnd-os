'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Tag, type TagVariant } from '@nexushub/ui';
import { BUILTIN_CARD_CATEGORIES } from '@nexushub/domain';
import { customCategoryColor } from '../lib/custom-category-color';
import { moveCard } from '../actions/move-card';
import {
  CARD_ADVANCED_EVENT,
  CARD_CREATED_EVENT,
  CARD_REMOVED_EVENT,
  CARD_SHORTREF_RESOLVED_EVENT,
  CARD_UPDATED_EVENT,
  OPEN_CARD_EVENT,
  type CardAdvancedEventDetail,
  type CardCreatedEventDetail,
  type CardRemovedEventDetail,
  type CardShortRefResolvedEventDetail,
  type CardUpdatedEventDetail,
  type OpenCardEventDetail,
} from './card-modal-controller';
import { CardAdvanceCheckbox } from './card-advance-checkbox';
import { CardCompletedBadge } from './card-completed-badge';
import { DeleteKanbanCardButton } from './delete-kanban-card-button';
import { ListAddCardButton } from './list-add-card-button';
import { LIST_VIEW_FIELDS, type ListViewFieldId } from './list-view-fields';
import { useListViewColumns } from './use-list-view-columns';

export interface ListViewAssignee {
  readonly userId: string;
  readonly displayName: string;
  readonly initials: string;
}

export interface ListViewCard {
  readonly id: string;
  readonly shortRef: number;
  readonly title: string;
  readonly columnId: string;
  readonly columnName: string;
  readonly categoryTag: string | null;
  readonly dueDate: string | null;
  /** ISO string when the card is checked "done" via the list-view
   *  todo-list-style checkbox (only available in the last user column). */
  readonly completedAt: string | null;
  readonly assignees: readonly ListViewAssignee[];
  readonly checklistTotal: number;
  readonly checklistChecked: number;
  readonly templateName: string | null;
  readonly commentCount: number;
}

export interface ListViewColumnMeta {
  readonly id: string;
  readonly name: string;
  readonly isBlockedSystem: boolean;
}

export interface ListViewProps {
  readonly projectId: string;
  readonly csrfToken: string;
  readonly cards: readonly ListViewCard[];
  readonly columns: readonly ListViewColumnMeta[];
  /** Viewer mode: hide delete + disable advance shortcut. */
  readonly isReadOnly?: boolean;
}

/**
 * Per-field column width spec used by the grid template. The title cell
 * always sits first and gets a generous share; everything else picks a
 * minmax that keeps the row readable down to roughly 1100px wide.
 */
const COLUMN_TRACKS: Record<ListViewFieldId, string> = {
  column: 'minmax(120px, 0.8fr)',
  shortRef: '70px',
  category: 'minmax(120px, 0.8fr)',
  dueDate: 'minmax(120px, 0.7fr)',
  assignees: 'minmax(130px, 0.9fr)',
  checklist: '90px',
  template: 'minmax(130px, 0.8fr)',
};
const COLUMN_LABELS: Record<ListViewFieldId, string> = {
  column: 'Colonne',
  shortRef: 'Réf.',
  category: 'Catégorie',
  dueDate: 'Échéance',
  assignees: 'Assignés',
  checklist: 'Checklist',
  template: 'Template',
};

export function ListView({
  projectId,
  csrfToken,
  cards,
  columns,
  isReadOnly = false,
}: ListViewProps) {
  const { selected, toggle, reset } = useListViewColumns(projectId);
  const [localCards, setLocalCards] = useState<readonly ListViewCard[]>(cards);
  useEffect(() => setLocalCards(cards), [cards]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  // Pin the DndContext to a React-stable id so dnd-kit's auto-generated
  // `DndDescribedBy-N` aria-describedby matches between SSR and CSR (its
  // default uses a module-level counter that diverges → hydration error).
  const dndId = useId();
  useEffect(() => {
    const onCreated = (e: Event) => {
      const detail = (e as CustomEvent<CardCreatedEventDetail>).detail;
      if (!detail || typeof detail.id !== 'string') return;
      const col = columns.find((c) => c.id === detail.columnId);
      setLocalCards((prev) =>
        prev.some((c) => c.id === detail.id)
          ? prev
          : [
              ...prev,
              {
                id: detail.id,
                shortRef: detail.shortRef,
                title: detail.title,
                columnId: detail.columnId,
                columnName: col?.name ?? '',
                categoryTag: detail.categoryTag,
                dueDate: null,
                completedAt: null,
                assignees: [],
                checklistTotal: 0,
                checklistChecked: 0,
                templateName: null,
                commentCount: 0,
              },
            ],
      );
    };
    const onRemoved = (e: Event) => {
      const detail = (e as CustomEvent<CardRemovedEventDetail>).detail;
      if (!detail || typeof detail.id !== 'string') return;
      setLocalCards((prev) => prev.filter((c) => c.id !== detail.id));
    };
    const onShortRef = (e: Event) => {
      const detail = (e as CustomEvent<CardShortRefResolvedEventDetail>).detail;
      if (!detail || typeof detail.id !== 'string') return;
      setLocalCards((prev) =>
        prev.map((c) => (c.id === detail.id ? { ...c, shortRef: detail.shortRef } : c)),
      );
    };
    const onAdvanced = (e: Event) => {
      const detail = (e as CustomEvent<CardAdvancedEventDetail>).detail;
      if (!detail || typeof detail.id !== 'string') return;
      const next = columns.find((c) => c.id === detail.newColumnId);
      if (!next) return;
      setLocalCards((prev) =>
        prev.map((c) =>
          c.id === detail.id ? { ...c, columnId: detail.newColumnId, columnName: next.name } : c,
        ),
      );
    };
    const onUpdated = (e: Event) => {
      const detail = (e as CustomEvent<CardUpdatedEventDetail>).detail;
      if (!detail || typeof detail.id !== 'string') return;
      setLocalCards((prev) =>
        prev.map((c) =>
          c.id === detail.id
            ? {
                ...c,
                ...(detail.title !== undefined ? { title: detail.title } : {}),
                ...(detail.categoryTag !== undefined ? { categoryTag: detail.categoryTag } : {}),
              }
            : c,
        ),
      );
    };
    window.addEventListener(CARD_CREATED_EVENT, onCreated);
    window.addEventListener(CARD_REMOVED_EVENT, onRemoved);
    window.addEventListener(CARD_SHORTREF_RESOLVED_EVENT, onShortRef);
    window.addEventListener(CARD_ADVANCED_EVENT, onAdvanced);
    window.addEventListener(CARD_UPDATED_EVENT, onUpdated);
    return () => {
      window.removeEventListener(CARD_CREATED_EVENT, onCreated);
      window.removeEventListener(CARD_REMOVED_EVENT, onRemoved);
      window.removeEventListener(CARD_SHORTREF_RESOLVED_EVENT, onShortRef);
      window.removeEventListener(CARD_ADVANCED_EVENT, onAdvanced);
      window.removeEventListener(CARD_UPDATED_EVENT, onUpdated);
    };
  }, [columns]);

  // Flat list, ordered by [Kanban column order, card position within col].
  // The Kanban-column information stays visible per row via the "Colonne"
  // field cell — no need to repeat it as a section header.
  const columnOrder = new Map(columns.map((c, idx) => [c.id, idx]));
  const orderedCards = [...localCards].sort((a, b) => {
    const aColPos = columnOrder.get(a.columnId) ?? Number.MAX_SAFE_INTEGER;
    const bColPos = columnOrder.get(b.columnId) ?? Number.MAX_SAFE_INTEGER;
    if (aColPos !== bColPos) return aColPos - bColPos;
    // Within a column, preserve the server-provided order (already by
    // `position asc`, which is `localCards`'s natural order).
    return 0;
  });

  // Cards in the last user column have no destination to skip to. Cards
  // in the system "Bloqué" column shouldn't be advanced via shortcut —
  // the user should fix the due date instead.
  const userColumns = columns.filter((c) => !c.isBlockedSystem);
  const lastUserColumnId = userColumns[userColumns.length - 1]?.id ?? null;
  const blockedColumnIds = new Set(columns.filter((c) => c.isBlockedSystem).map((c) => c.id));

  // Grid template: 24px lead for the advance checkbox, then title, then
  // each picked optional column, then 40px for the hover delete.
  const gridTemplate = [
    '24px',
    'minmax(220px, 2fr)',
    ...selected.map((id) => COLUMN_TRACKS[id]),
    '40px',
  ].join(' ');

  // The top-level "+ Nouvelle carte" primary CTA drops the new card in
  // the first user column — same default as opening a fresh Kanban from
  // the left-most column. The user can drag/skip from there.
  const firstUserColumn = columns.find((c) => !c.isBlockedSystem) ?? null;

  // Drag handler: mirror the Kanban placement logic on the flat list.
  // The "over" card determines both the target column and the slot.
  // Same-column drag down → land AFTER over (server places between
  // over and the next sibling); same-column UP or cross-column → land
  // BEFORE over. Optimistic reorder of `localCards` keeps the new
  // position rendered the instant the user releases the pointer.
  const handleDragEnd = (e: DragEndEvent) => {
    if (isReadOnly) return;
    const cardId = String(e.active.id);
    if (!e.over || e.over.id === e.active.id) return;
    const overId = String(e.over.id);

    const sourceCard = localCards.find((c) => c.id === cardId);
    const overCard = localCards.find((c) => c.id === overId);
    if (!sourceCard || !overCard) return;

    const targetColumnId = overCard.columnId;

    // Compute targetIndex (within target column, EXCLUDING source) —
    // this is what `moveCard` server action expects.
    const targetColSiblings = localCards.filter(
      (c) => c.columnId === targetColumnId && c.id !== cardId,
    );
    const overIdxInSiblings = targetColSiblings.findIndex((c) => c.id === overId);
    if (overIdxInSiblings < 0) return;

    const sameCol = sourceCard.columnId === targetColumnId;
    const sourceColCards = localCards.filter((c) => c.columnId === sourceCard.columnId);
    const sourceIdxInOwnCol = sourceColCards.findIndex((c) => c.id === cardId);
    const overIdxInTargetColFull = localCards
      .filter((c) => c.columnId === targetColumnId)
      .findIndex((c) => c.id === overId);

    const sameColDown = sameCol && sourceIdxInOwnCol < overIdxInTargetColFull;
    const targetIndex = sameColDown ? overIdxInSiblings + 1 : overIdxInSiblings;
    // No same-col no-op early-return here: dropping on any card OTHER
    // than the source is always a real move (the only "drop on self"
    // case is handled by the `e.over.id === e.active.id` guard above).
    // A faulty check on the over card's siblings-index used to match
    // for every same-col UP drag, killing the persistence.

    // Optimistic reorder in the flat array — same algorithm as the
    // Kanban board. Mirror BEFORE/AFTER over depending on direction.
    setLocalCards((prev) => {
      const srcIdx = prev.findIndex((c) => c.id === cardId);
      if (srcIdx < 0) return prev;
      const src = prev[srcIdx];
      if (!src) return prev;
      const without = prev.filter((c) => c.id !== cardId);
      const targetCol = columns.find((c) => c.id === targetColumnId);
      const updated: ListViewCard = {
        ...src,
        columnId: targetColumnId,
        columnName: targetCol?.name ?? src.columnName,
      };
      const overIdxAfterRemoval = without.findIndex((c) => c.id === overId);
      if (overIdxAfterRemoval < 0) return prev;
      const insertIdx = sameColDown ? overIdxAfterRemoval + 1 : overIdxAfterRemoval;
      return [...without.slice(0, insertIdx), updated, ...without.slice(insertIdx)];
    });

    void (async () => {
      const result = await moveCard({ cardId, targetColumnId, targetIndex });
      if (!result.ok) {
        setLocalCards(cards);
        window.alert(result.message);
      }
      // No router.refresh(): local state is already updated optimistically.
    })();
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-[color:var(--color-text-muted)]">
          {localCards.length} {localCards.length <= 1 ? 'carte' : 'cartes'} · clic sur une carte
          pour l&apos;ouvrir
        </p>
        <div className="flex items-center gap-2">
          <ColumnPicker selected={selected} onToggle={toggle} onReset={reset} />
          {firstUserColumn && !isReadOnly ? (
            <ListAddCardButton
              projectId={projectId}
              columnId={firstUserColumn.id}
              columnName={firstUserColumn.name}
              csrfToken={csrfToken}
              variant="primary"
            />
          ) : null}
        </div>
      </div>

      {orderedCards.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-12 text-center text-sm text-[color:var(--color-text-muted)]">
          Aucune carte. Utilise « + Nouvelle carte » pour démarrer.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {/* Table header row — single row above the flat list. */}
          <div
            className="grid items-center gap-3 px-4 text-[10px] font-extrabold uppercase tracking-[1px] text-[color:var(--color-text-muted)]"
            style={{ gridTemplateColumns: gridTemplate }}
            role="presentation"
          >
            <span aria-hidden="true" />
            <span>Titre</span>
            {selected.map((id) => (
              <span key={id}>{COLUMN_LABELS[id]}</span>
            ))}
            <span aria-hidden="true" />
          </div>

          <DndContext id={dndId} sensors={sensors} onDragEnd={handleDragEnd}>
            <SortableContext
              items={orderedCards.map((c) => c.id)}
              strategy={verticalListSortingStrategy}
            >
              <ul className="flex flex-col gap-2">
                {orderedCards.map((card) => {
                  const isInLastUserColumn = card.columnId === lastUserColumnId;
                  const isBlocked = blockedColumnIds.has(card.columnId);
                  const cannotAdvance = isBlocked || isInLastUserColumn;
                  return (
                    <ListRow
                      key={card.id}
                      card={card}
                      csrfToken={csrfToken}
                      selected={selected}
                      gridTemplate={gridTemplate}
                      cannotAdvance={cannotAdvance}
                      isInLastUserColumn={isInLastUserColumn}
                      isReadOnly={isReadOnly}
                    />
                  );
                })}
              </ul>
            </SortableContext>
          </DndContext>

          {/* Convenience "add" affordance at the bottom of the list so the
              user doesn't have to scroll back to the top CTA. Drops into the
              first user column, same target as the primary button. */}
          {firstUserColumn && !isReadOnly ? (
            <ListAddCardButton
              projectId={projectId}
              columnId={firstUserColumn.id}
              columnName={firstUserColumn.name}
              csrfToken={csrfToken}
              variant="dashed"
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

// ---------- Sub-components -------------------------------------------------

function ListRow({
  card,
  csrfToken,
  selected,
  gridTemplate,
  cannotAdvance,
  isInLastUserColumn,
  isReadOnly,
}: {
  card: ListViewCard;
  csrfToken: string;
  selected: readonly ListViewFieldId[];
  gridTemplate: string;
  cannotAdvance: boolean;
  /** When true, the row is in the last user column — the row renders
   *  as "done" (checked badge + strikethrough title). The DB trigger
   *  `sync_card_completed_at` keeps `completedAt` in sync with this
   *  position, so we render the visual from the column rather than
   *  the (derived) field. */
  isInLastUserColumn: boolean;
  isReadOnly: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    disabled: isReadOnly,
  });

  const onClick = () => {
    if (isDragging) return;
    const detail: OpenCardEventDetail = {
      id: card.id,
      title: card.title,
      shortRef: card.shortRef,
      categoryTag: card.categoryTag,
    };
    window.dispatchEvent(new CustomEvent(OPEN_CARD_EVENT, { detail }));
  };

  const rowStyle: React.CSSProperties = {
    gridTemplateColumns: gridTemplate,
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <li
      ref={setNodeRef}
      onClick={onClick}
      className="group relative grid cursor-pointer items-center gap-3 rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] px-4 py-3 shadow-[var(--shadow-card)] transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-hover)]"
      style={rowStyle}
      {...attributes}
      {...listeners}
    >
      <div onClick={(e) => e.stopPropagation()} className="flex items-center justify-center">
        {isInLastUserColumn ? (
          <CardCompletedBadge cardId={card.id} disabled={isReadOnly} />
        ) : (
          <CardAdvanceCheckbox cardId={card.id} disabled={cannotAdvance || isReadOnly} />
        )}
      </div>

      <div
        className={`min-w-0 truncate text-sm font-bold ${
          isInLastUserColumn
            ? 'text-[color:var(--color-text-muted)] line-through'
            : 'text-[color:var(--color-text-main)]'
        }`}
      >
        <span className="truncate align-middle">{card.title}</span>
        {card.commentCount > 0 ? (
          <span
            className="nx-comment-badge"
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
          </span>
        ) : null}
      </div>

      {selected.map((id) => (
        <FieldCell key={id} field={id} card={card} />
      ))}

      {!isReadOnly ? (
        <div
          onClick={(e) => e.stopPropagation()}
          className="pointer-events-none flex justify-end opacity-0 transition-opacity duration-150 focus-within:pointer-events-auto focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100"
        >
          <DeleteKanbanCardButton cardId={card.id} cardTitle={card.title} csrfToken={csrfToken} />
        </div>
      ) : (
        <div aria-hidden="true" />
      )}
    </li>
  );
}

function FieldCell({ field, card }: { field: ListViewFieldId; card: ListViewCard }) {
  switch (field) {
    case 'column':
      return (
        <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-[color:var(--color-text-muted)]">
          <span
            aria-hidden="true"
            className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--color-text-ghost)]"
          />
          <span className="truncate font-medium text-[color:var(--color-text-soft)]">
            {card.columnName}
          </span>
        </span>
      );
    case 'shortRef':
      return (
        <span className="text-[10px] font-bold uppercase tracking-wider text-[color:var(--color-text-muted)]">
          #{String(card.shortRef).padStart(3, '0')}
        </span>
      );
    case 'category':
      return (
        <span className="min-w-0">
          <CategoryCell tag={card.categoryTag} />
        </span>
      );
    case 'dueDate':
      return (
        <span className="truncate text-[11px] text-[color:var(--color-text-muted)]">
          {card.dueDate ? `📅 ${formatDate(card.dueDate)}` : '—'}
        </span>
      );
    case 'assignees':
      if (card.assignees.length === 0) {
        return <span className="text-[11px] text-[color:var(--color-text-ghost)]">—</span>;
      }
      return (
        <div className="flex min-w-0 -space-x-1.5">
          {card.assignees.slice(0, 3).map((a) => (
            <span
              key={a.userId}
              title={a.displayName}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-[color:var(--color-bg-card)] bg-[image:var(--accent-gradient)] text-[10px] font-bold text-white"
            >
              {a.initials}
            </span>
          ))}
          {card.assignees.length > 3 ? (
            <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-[color:var(--color-bg-card)] bg-[color:var(--color-bg-muted)] text-[10px] font-bold text-[color:var(--color-text-soft)]">
              +{card.assignees.length - 3}
            </span>
          ) : null}
        </div>
      );
    case 'checklist':
      return (
        <span className="text-[11px] text-[color:var(--color-text-muted)]">
          {card.checklistTotal > 0 ? `☑ ${card.checklistChecked}/${card.checklistTotal}` : '—'}
        </span>
      );
    case 'template':
      return (
        <span className="truncate text-[11px] text-[color:var(--color-text-muted)]">
          {card.templateName ? `▤ ${card.templateName}` : '—'}
        </span>
      );
  }
}

function CategoryCell({ tag }: { tag: string | null }) {
  if (!tag) return null;
  const builtin = BUILTIN_CARD_CATEGORIES.find((c) => c.id === tag);
  if (builtin) {
    return (
      <Tag variant={tag as TagVariant} size="sm">
        {builtin.label}
      </Tag>
    );
  }
  const c = customCategoryColor(tag);
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.5px]"
      style={{ background: c.bg, color: c.fg }}
    >
      {tag}
    </span>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return iso.slice(0, 10);
  }
}

// ---------- Column picker --------------------------------------------------

function ColumnPicker({
  selected,
  onToggle,
  onReset,
}: {
  selected: readonly ListViewFieldId[];
  onToggle: (id: ListViewFieldId) => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] px-3 py-1.5 text-xs font-bold text-[color:var(--color-text-soft)] shadow-[var(--shadow-card)] hover:text-[color:var(--color-text-main)]"
      >
        <span aria-hidden="true">⚙</span>
        Colonnes ({selected.length})
        <span className="text-[10px] text-[color:var(--color-text-muted)]">▾</span>
      </button>
      {open ? (
        <div className="absolute right-0 z-20 mt-1 w-64 rounded-xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-2 shadow-lg">
          <div className="mb-1 px-2 pt-1 text-[10px] font-extrabold uppercase tracking-[1px] text-[color:var(--color-text-muted)]">
            Afficher dans la liste
          </div>
          <div className="px-2 py-1 text-[11px] text-[color:var(--color-text-muted)]">
            Titre <span className="ml-1 text-[9px] uppercase">(toujours)</span>
          </div>
          {LIST_VIEW_FIELDS.map((f) => {
            const on = selected.includes(f.id);
            return (
              <label
                key={f.id}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-[color:var(--color-bg-muted)]"
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => onToggle(f.id)}
                  className="accent-[color:var(--color-accent-primary)]"
                />
                <span>{f.label}</span>
              </label>
            );
          })}
          <div className="mt-1 flex justify-end border-t border-[color:var(--color-border-light)] pt-1">
            <button
              type="button"
              onClick={onReset}
              className="rounded px-2 py-1 text-[11px] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text-main)]"
            >
              Réinitialiser
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
