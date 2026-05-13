'use client';
import { useEffect, useId, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
// useEffect kept for the incomingKey resync below.
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  DragOverlay,
} from '@dnd-kit/core';
import { moveCard } from '../actions/move-card';
import { KanbanCard, type KanbanCardData } from './kanban-card';
import { KanbanColumn, type KanbanColumnData } from './kanban-column';
import {
  CARD_CREATED_EVENT,
  CARD_REMOVED_EVENT,
  CARD_SHORTREF_RESOLVED_EVENT,
  type CardCreatedEventDetail,
  type CardRemovedEventDetail,
  type CardShortRefResolvedEventDetail,
} from './card-modal-controller';

export interface KanbanBoardProps {
  readonly csrfToken: string;
  readonly projectId: string;
  readonly columns: readonly KanbanColumnData[];
  readonly cards: readonly KanbanCardData[];
}

/**
 * Top-level Kanban board with optimistic drag & drop. The server is the
 * source of truth for positions; we maintain a local optimistic copy of
 * the card list so the move feels instant even when the round-trip is
 * a few hundred ms.
 */
export function KanbanBoard({ csrfToken, projectId, columns, cards }: KanbanBoardProps) {
  const router = useRouter();
  const [localCards, setLocalCards] = useState<readonly KanbanCardData[]>(cards);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Re-sync when the server pushes a new ordering (e.g. after revalidate).
  // We watch a stringified key so we only resync on real shape changes.
  const incomingKey = useMemo(
    () => cards.map((c) => `${c.id}:${c.columnId}:${c.title}`).join('|'),
    [cards],
  );
  useEffect(() => {
    setLocalCards(cards);
  }, [incomingKey, cards]);

  // Optimistic append + rollback + shortRef patch for the new-card flow.
  // createCard no longer revalidates the route, so the board is patched
  // entirely client-side.
  useEffect(() => {
    const onCreated = (e: Event) => {
      const detail = (e as CustomEvent<CardCreatedEventDetail>).detail;
      if (!detail || typeof detail.id !== 'string') return;
      setLocalCards((prev) =>
        prev.some((c) => c.id === detail.id)
          ? prev
          : [
              ...prev,
              {
                id: detail.id,
                columnId: detail.columnId,
                shortRef: detail.shortRef,
                title: detail.title,
                categoryTag: detail.categoryTag,
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
    window.addEventListener(CARD_CREATED_EVENT, onCreated);
    window.addEventListener(CARD_REMOVED_EVENT, onRemoved);
    window.addEventListener(CARD_SHORTREF_RESOLVED_EVENT, onShortRef);
    return () => {
      window.removeEventListener(CARD_CREATED_EVENT, onCreated);
      window.removeEventListener(CARD_REMOVED_EVENT, onRemoved);
      window.removeEventListener(CARD_SHORTREF_RESOLVED_EVENT, onShortRef);
    };
  }, []);

  const cardsByColumn = useMemo(() => {
    const map = new Map<string, KanbanCardData[]>();
    for (const c of columns) map.set(c.id, []);
    for (const card of localCards) {
      const list = map.get(card.columnId);
      if (list) list.push(card);
    }
    return map;
  }, [columns, localCards]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const handleDragStart = (e: DragStartEvent) => {
    setActiveId(String(e.active.id));
  };

  const handleDragEnd = async (e: DragEndEvent) => {
    setActiveId(null);
    const cardId = String(e.active.id);
    const activeCard = localCards.find((c) => c.id === cardId);
    if (!activeCard || !e.over) return;

    // Drop target can be either a column (empty slot) or another card.
    const overData = e.over.data.current as
      | { type?: 'column' | 'card'; columnId?: string }
      | undefined;
    if (!overData) return;

    let targetColumnId: string;
    let targetIndex: number;

    if (overData.type === 'column') {
      if (!overData.columnId) return;
      targetColumnId = overData.columnId;
      targetIndex = cardsByColumn.get(targetColumnId)?.length ?? 0;
    } else {
      const overId = String(e.over.id);
      const overCard = localCards.find((c) => c.id === overId);
      if (!overCard) return;
      targetColumnId = overCard.columnId;
      const list = cardsByColumn.get(targetColumnId) ?? [];
      const overIndex = list.findIndex((c) => c.id === overId);
      // If we're moving within the same column, account for the card we're about to remove.
      const sameCol = activeCard.columnId === targetColumnId;
      const activeIndex = list.findIndex((c) => c.id === cardId);
      targetIndex = sameCol && activeIndex < overIndex ? overIndex : overIndex;
    }

    if (targetColumnId === activeCard.columnId) {
      const list = cardsByColumn.get(targetColumnId) ?? [];
      const currentIndex = list.findIndex((c) => c.id === cardId);
      if (currentIndex === targetIndex) return;
    }

    // Optimistic local update
    setLocalCards((prev) =>
      prev.map((c) => (c.id === cardId ? { ...c, columnId: targetColumnId } : c)),
    );

    const result = await moveCard({
      cardId,
      targetColumnId,
      targetIndex,
    });

    if (!result.ok) {
      // Roll back: reset to server-truth and surface the message.
      setLocalCards(cards);
      window.alert(result.message);
      return;
    }

    router.refresh();
  };

  const activeCard = activeId ? (localCards.find((c) => c.id === activeId) ?? null) : null;

  // dnd-kit's auto-generated `DndDescribedBy-N` aria-describedby uses a
  // module-level counter that diverges between SSR and CSR. Pinning the
  // DndContext to a React-stable id makes the generated attributes
  // identical on both renders.
  const dndId = useId();

  return (
    <DndContext
      id={dndId}
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="kanban-board">
        {columns.map((col) => (
          <KanbanColumn
            key={col.id}
            csrfToken={csrfToken}
            projectId={projectId}
            column={col}
            cards={cardsByColumn.get(col.id) ?? []}
          />
        ))}
      </div>
      <DragOverlay>{activeCard ? <KanbanCard card={activeCard} /> : null}</DragOverlay>
    </DndContext>
  );
}
