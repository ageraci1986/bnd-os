'use client';
import type { CardTemplateItem } from '@nexushub/domain';
import { ItemsList } from './items-list';
import { AddItemPopover } from './add-item-popover';
import { StarIcon, StarFilledIcon } from '@/features/shell/components/icons';

export interface TemplateEditorProps {
  readonly name: string;
  readonly items: readonly CardTemplateItem[];
  readonly isDefault: boolean;
  readonly isDirty: boolean;
  readonly isSaving: boolean;
  readonly editingItemId: string | null;
  readonly onRename: (name: string) => void;
  readonly onToggleDefault: (isDefault: boolean) => void;
  readonly onAddItem: (type: CardTemplateItem['type']) => void;
  readonly onReorder: (from: number, to: number) => void;
  readonly onEditItem: (id: string) => void;
  readonly onRemoveItem: (id: string) => void;
  readonly onSave: () => void;
  readonly onCancel: () => void;
  readonly onDeleteTemplate: () => void;
}

export function TemplateEditor({
  name,
  items,
  isDefault,
  isDirty,
  isSaving,
  editingItemId,
  onRename,
  onToggleDefault,
  onAddItem,
  onReorder,
  onEditItem,
  onRemoveItem,
  onSave,
  onCancel,
  onDeleteTemplate,
}: TemplateEditorProps) {
  const hasDescription = items.some((i) => i.type === 'description');

  return (
    <section className="flex h-full flex-col gap-4 rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-4">
      <header className="flex items-center gap-3 border-b border-[color:var(--color-border-light)] pb-3">
        <button
          type="button"
          role="switch"
          aria-checked={isDefault}
          onClick={() => onToggleDefault(!isDefault)}
          title={
            isDefault
              ? 'Template par défaut — cliquer pour retirer'
              : 'Marquer comme template par défaut'
          }
          aria-label={
            isDefault ? 'Retirer comme template par défaut' : 'Marquer comme template par défaut'
          }
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition"
          style={
            isDefault
              ? {
                  background: 'var(--accent-gradient)',
                  borderColor: 'transparent',
                  color: '#fff',
                  boxShadow: '0 4px 15px rgba(138, 43, 226, 0.3)',
                }
              : {
                  background: 'var(--color-bg-card)',
                  borderColor: 'var(--color-border-light)',
                  color: 'var(--color-text-muted)',
                }
          }
        >
          {isDefault ? (
            <StarFilledIcon width={16} height={16} style={{ width: 16, height: 16 }} />
          ) : (
            <StarIcon width={16} height={16} style={{ width: 16, height: 16 }} />
          )}
        </button>
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
      </header>

      <ItemsList
        items={items}
        editingItemId={editingItemId}
        onReorder={onReorder}
        onEdit={onEditItem}
        onRemove={onRemoveItem}
      />

      <AddItemPopover hasDescription={hasDescription} onAdd={onAddItem} />

      <footer className="mt-auto flex items-center gap-2 border-t border-[color:var(--color-border-light)] pt-3">
        {isDirty ? (
          <>
            <button
              type="button"
              onClick={onCancel}
              disabled={isSaving}
              className="btn btn-ghost btn-sm"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={isSaving}
              className="btn btn-primary btn-sm"
            >
              {isSaving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </>
        ) : null}
        <button
          type="button"
          onClick={onDeleteTemplate}
          className="ml-auto rounded-md border border-[color:var(--color-danger)] px-3 py-1 text-xs text-[color:var(--color-danger)] hover:bg-[color:var(--color-danger)] hover:text-white"
        >
          Supprimer ce template
        </button>
      </footer>
    </section>
  );
}
