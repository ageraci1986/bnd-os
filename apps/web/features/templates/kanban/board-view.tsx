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
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import type { KanbanTemplateColumnDef } from '@nexushub/domain';
import { ColumnTile } from './column-tile';

export interface BoardViewProps {
  readonly columns: readonly KanbanTemplateColumnDef[];
  readonly onReorder: (from: number, to: number) => void;
  readonly onRenameColumn: (idx: number, name: string) => void;
  readonly onRemoveColumn: (idx: number) => void;
  readonly onAddColumn: () => void;
  readonly onEditStepChecklist: (idx: number) => void;
}

/**
 * Horizontal sortable list of editable columns + a fixed "Bloqué"
 * system column at the end + a "+ Nouvelle colonne" button.
 */
export function BoardView({
  columns,
  onReorder,
  onRenameColumn,
  onRemoveColumn,
  onAddColumn,
  onEditStepChecklist,
}: BoardViewProps) {
  const idPrefix = useId();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const ids = columns.map((c, i) => c.id ?? `idx-${i}`);
    const from = ids.indexOf(String(e.active.id));
    const to = ids.indexOf(String(e.over.id));
    if (from === -1 || to === -1) return;
    onReorder(from, to);
  };

  return (
    <DndContext
      id={idPrefix}
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
    >
      <div className="flex gap-4 overflow-x-auto rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-muted)] px-6 py-8">
        <SortableContext
          items={columns.map((c, i) => c.id ?? `idx-${i}`)}
          strategy={horizontalListSortingStrategy}
        >
          {columns.map((col, idx) => (
            <ColumnTile
              key={col.id ?? `idx-${idx}`}
              idx={idx}
              column={col}
              nextColumnName={columns[idx + 1]?.name ?? null}
              isLastUserColumn={idx === columns.length - 1}
              onRename={(name) => onRenameColumn(idx, name)}
              onRemove={() => onRemoveColumn(idx)}
              onEditStepChecklist={() => onEditStepChecklist(idx)}
            />
          ))}
        </SortableContext>

        {/* System "Bloqué" column — informational, not part of the data */}
        <div className="flex w-[240px] shrink-0 flex-col rounded-md border border-[color:var(--color-danger)] bg-[color:var(--color-danger-bg)] p-4">
          <header className="mb-3 flex items-center justify-between border-b-2 border-[color:var(--color-danger)] pb-3">
            <span className="text-[15px] font-extrabold tracking-[-0.3px] text-[color:var(--color-danger)]">
              Bloqué
            </span>
            <span className="rounded-full bg-[color:var(--color-danger)] px-2.5 py-1 text-[9px] font-extrabold uppercase tracking-[0.5px] text-white">
              Système
            </span>
          </header>
          <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.5px] text-[color:var(--color-danger)]">
            <span className="font-extrabold">⚙</span> géré automatiquement
          </div>
          <div className="rounded-md border border-dashed border-[color:var(--color-danger)] bg-[color:var(--color-bg-card)] p-3 text-center text-[10px] font-bold uppercase leading-relaxed tracking-[0.5px] text-[color:var(--color-danger)]">
            Colonne système
            <br />
            Non modifiable
            <br />
            Non supprimable
          </div>
        </div>

        {/* Add column */}
        <div className="flex w-[180px] shrink-0 items-center">
          <button
            type="button"
            onClick={onAddColumn}
            className="w-full rounded-md border-2 border-dashed border-[color:var(--color-border-light)] bg-transparent p-6 text-[11px] font-extrabold uppercase tracking-[0.5px] text-[color:var(--color-text-muted)] transition hover:border-[color:var(--color-accent-primary)] hover:text-[color:var(--color-accent-primary)]"
          >
            + Nouvelle colonne
          </button>
        </div>
      </div>
    </DndContext>
  );
}
