'use client';
import { useEffect, useRef, useState } from 'react';
import type { KanbanTemplateDTO } from './use-editor-state';

export interface TemplateToolbarProps {
  readonly templates: readonly KanbanTemplateDTO[];
  readonly selectedId: string | null;
  readonly isDirty: boolean;
  readonly isSaving: boolean;
  readonly onSelect: (id: string) => void;
  readonly onCreate: () => void;
  readonly onDuplicate: () => void;
  readonly onDelete: () => void;
  readonly onSave: () => void;
}

export function TemplateToolbar({
  templates,
  selectedId,
  isDirty,
  isSaving,
  onSelect,
  onCreate,
  onDuplicate,
  onDelete,
  onSave,
}: TemplateToolbarProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [open]);

  const selected = templates.find((t) => t.id === selectedId);

  return (
    <div className="mb-5 flex items-center justify-between rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] px-6 py-5 shadow-[var(--shadow-card)]">
      <div className="flex items-center gap-4">
        <span className="text-[11px] font-extrabold uppercase tracking-[0.8px] text-[color:var(--color-text-muted)]">
          ✦ Template en édition
        </span>
        <div ref={rootRef} className="relative">
          <button
            type="button"
            onClick={() => {
              if (isDirty && !window.confirm('Modifications non sauvées. Changer de template ?'))
                return;
              setOpen((o) => !o);
            }}
            className="flex min-w-[260px] items-center gap-3 rounded-full border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-muted)] px-4 py-2.5 text-[15px] font-extrabold tracking-[-0.3px]"
          >
            <span className="flex-1 truncate text-left">
              {selected?.name ?? '— Aucun template —'}
            </span>
            <span className="text-xs text-[color:var(--color-text-muted)]">▾</span>
          </button>
          {open ? (
            <div className="absolute left-0 right-0 z-20 mt-1 max-h-72 overflow-auto rounded-xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-1.5 shadow-lg">
              {templates.length === 0 ? (
                <p className="px-3 py-2 text-xs text-[color:var(--color-text-muted)]">
                  Aucun template — utilise « + Nouveau template ».
                </p>
              ) : (
                templates.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      if (t.id === selectedId) return;
                      onSelect(t.id);
                    }}
                    className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm ${
                      t.id === selectedId
                        ? 'bg-[rgba(139,43,226,0.12)] font-semibold'
                        : 'hover:bg-[color:var(--color-bg-muted)]'
                    }`}
                  >
                    <span className="truncate">{t.name}</span>
                    <span className="shrink-0 text-[10px] text-[color:var(--color-text-muted)]">
                      {t.columns.length} col.
                    </span>
                  </button>
                ))
              )}
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onCreate}
          className="btn btn-ghost btn-sm"
          disabled={isSaving}
        >
          + Nouveau
        </button>
        <button
          type="button"
          onClick={onDuplicate}
          disabled={!selectedId || isSaving}
          className="btn btn-ghost btn-sm"
        >
          Dupliquer
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={!selectedId || isSaving || selected?.isBuiltin}
          className="btn btn-danger btn-sm"
        >
          Supprimer
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={!isDirty || isSaving}
          className="btn btn-primary btn-sm"
        >
          {isSaving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </div>
  );
}
