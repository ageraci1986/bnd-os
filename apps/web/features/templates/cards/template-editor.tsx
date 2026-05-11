'use client';
import type { CardTemplateItem } from '@nexushub/domain';
import { ItemsList } from './items-list';
import { AddItemPopover } from './add-item-popover';

export interface TemplateEditorProps {
  readonly name: string;
  readonly items: readonly CardTemplateItem[];
  readonly isDirty: boolean;
  readonly isSaving: boolean;
  readonly editingItemId: string | null;
  readonly onRename: (name: string) => void;
  readonly onAddItem: (type: CardTemplateItem['type']) => void;
  readonly onReorder: (from: number, to: number) => void;
  readonly onEditItem: (id: string) => void;
  readonly onRemoveItem: (id: string) => void;
  readonly onSave: () => void;
  readonly onDeleteTemplate: () => void;
}

export function TemplateEditor({
  name,
  items,
  isDirty,
  isSaving,
  editingItemId,
  onRename,
  onAddItem,
  onReorder,
  onEditItem,
  onRemoveItem,
  onSave,
  onDeleteTemplate,
}: TemplateEditorProps) {
  const hasDescription = items.some((i) => i.type === 'description');

  return (
    <section className="flex h-full flex-col gap-4 rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-4">
      <header className="flex items-center gap-3 border-b border-[color:var(--color-border-light)] pb-3">
        <input
          type="text"
          value={name}
          maxLength={80}
          onChange={(e) => onRename(e.target.value)}
          placeholder="Nom du template"
          className="flex-1 rounded-md border border-transparent px-2 py-1 text-xl font-bold focus:border-[color:var(--color-border-light)]"
        />
        {isDirty ? (
          <span className="text-[10px] uppercase tracking-wide text-[color:var(--color-text-muted)]">
            non sauvé
          </span>
        ) : null}
        <button
          type="button"
          onClick={onSave}
          disabled={!isDirty || isSaving}
          className="rounded-md bg-[color:var(--color-accent-primary)] px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {isSaving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </header>

      <ItemsList
        items={items}
        editingItemId={editingItemId}
        onReorder={onReorder}
        onEdit={onEditItem}
        onRemove={onRemoveItem}
      />

      <AddItemPopover hasDescription={hasDescription} onAdd={onAddItem} />

      <footer className="mt-4 flex justify-end border-t border-[color:var(--color-border-light)] pt-3">
        <button
          type="button"
          onClick={onDeleteTemplate}
          className="rounded-md border border-[color:var(--color-danger)] px-3 py-1 text-xs text-[color:var(--color-danger)] hover:bg-[color:var(--color-danger)] hover:text-white"
        >
          Supprimer ce template
        </button>
      </footer>
    </section>
  );
}
