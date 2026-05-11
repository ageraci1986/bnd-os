'use client';
import { useId } from 'react';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import type { CardTemplateItem } from '@nexushub/domain';
import { ItemRow } from './item-row';

export interface ItemsListProps {
  readonly items: readonly CardTemplateItem[];
  readonly editingItemId: string | null;
  readonly onReorder: (from: number, to: number) => void;
  readonly onEdit: (id: string) => void;
  readonly onRemove: (id: string) => void;
}

export function ItemsList({ items, editingItemId, onReorder, onEdit, onRemove }: ItemsListProps) {
  const idPrefix = useId();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (e: DragEndEvent) => {
    const over = e.over;
    if (!over || e.active.id === over.id) return;
    const from = items.findIndex((i) => i.id === e.active.id);
    const to = items.findIndex((i) => i.id === over.id);
    if (from === -1 || to === -1) return;
    onReorder(from, to);
  };

  if (items.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-[color:var(--color-border-light)] px-3 py-6 text-center text-xs text-[color:var(--color-text-muted)]">
        Aucun item — utilise « + Ajouter un item » ci-dessous.
      </p>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
      id={idPrefix}
    >
      <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <ul className="flex flex-col gap-1.5">
          {items.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              isEditing={editingItemId === item.id}
              onEdit={onEdit}
              onRemove={onRemove}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

export { arrayMove };
