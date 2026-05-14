'use client';
import { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { KanbanTemplateColumnDef } from '@nexushub/domain';

export interface ColumnTileProps {
  readonly idx: number;
  readonly column: KanbanTemplateColumnDef;
  readonly nextColumnName: string | null;
  readonly isLastUserColumn: boolean;
  readonly onRename: (name: string) => void;
  readonly onRemove: () => void;
  readonly onEditStepChecklist: () => void;
}

/**
 * Single editable column in the kanban-template board view. The column
 * is sortable (drag the header), the name is an inline-edit input, and
 * a ⋯ menu exposes "Modifier la step-checklist" + "Supprimer".
 */
export function ColumnTile({
  idx,
  column,
  nextColumnName,
  isLastUserColumn,
  onRename,
  onRemove,
  onEditStepChecklist,
}: ColumnTileProps) {
  const sortableId = column.id ?? `idx-${idx}`;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: sortableId,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.55 : 1,
  };
  const [menuOpen, setMenuOpen] = useState(false);

  const stepCount = column.stepChecklist.length;
  const flowHint = isLastUserColumn
    ? 'colonne finale · archivage 30j'
    : nextColumnName
      ? `→ ${nextColumnName}`
      : '→ Bloqué (si échéance dépassée)';

  return (
    <div ref={setNodeRef} style={style} className="flex w-[240px] shrink-0 flex-col rounded-md">
      <header className="mb-3 flex items-center justify-between border-b-2 border-[color:var(--color-border-light)] pb-3">
        <span
          {...attributes}
          {...listeners}
          aria-label="Déplacer la colonne"
          className="mr-1 cursor-grab select-none text-xs text-[color:var(--color-text-muted)]"
        >
          ⋮⋮
        </span>
        <input
          type="text"
          value={column.name}
          maxLength={60}
          onChange={(e) => onRename(e.target.value)}
          className="flex-1 border-0 bg-transparent text-[15px] font-extrabold tracking-[-0.3px] outline-none focus:rounded-md focus:bg-[color:var(--color-bg-muted)] focus:px-1.5 focus:py-0.5"
        />
        <div className="relative">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((o) => !o);
            }}
            aria-label="Menu de la colonne"
            className="rounded px-1.5 text-base text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-bg-muted)]"
          >
            ⋯
          </button>
          {menuOpen ? (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-7 z-20 w-56 rounded-md border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-1 shadow-lg">
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onEditStepChecklist();
                  }}
                  className="block w-full rounded px-2.5 py-1.5 text-left text-xs hover:bg-[color:var(--color-bg-muted)]"
                >
                  Step-checklist… {stepCount > 0 ? `(${stepCount})` : ''}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    if (!window.confirm(`Supprimer la colonne « ${column.name} » ?`)) return;
                    onRemove();
                  }}
                  className="block w-full rounded px-2.5 py-1.5 text-left text-xs text-[color:var(--color-danger)] hover:bg-[color:var(--color-danger-bg)]"
                >
                  Supprimer la colonne
                </button>
              </div>
            </>
          ) : null}
        </div>
      </header>

      <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.5px] text-[color:var(--color-text-muted)]">
        <span className="font-extrabold text-[color:var(--color-accent-primary)]">›</span>{' '}
        {flowHint}
      </div>

      {stepCount > 0 ? (
        <button
          type="button"
          onClick={onEditStepChecklist}
          className="mb-2 rounded-md border border-dashed border-[color:var(--color-accent-primary)] bg-[rgba(139,43,226,0.06)] px-2.5 py-1.5 text-left text-[11px] text-[color:var(--color-accent-primary)] hover:bg-[rgba(139,43,226,0.1)]"
        >
          ☑ Step-checklist · {stepCount} {stepCount === 1 ? 'item' : 'items'}
        </button>
      ) : null}

      {/* Sample card placeholder (matches the mockup look) */}
      <div className="rounded-md border border-dashed border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-3 opacity-60">
        <div className="mb-2 inline-block rounded-full bg-[image:var(--accent-gradient-soft)] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.5px] text-[color:var(--color-accent-primary)]">
          Exemple
        </div>
        <div className="text-[11px] leading-relaxed text-[color:var(--color-text-muted)]">
          Aperçu d&apos;une carte dans cette colonne.
        </div>
      </div>
    </div>
  );
}
