'use client';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { CardTemplateItem } from '@nexushub/domain';

const TYPE_ICON: Record<CardTemplateItem['type'], string> = {
  text: 'Aa',
  longtext: '¶',
  select: '▣',
  link: '🔗',
  checkbox: '☑',
  date: '📅',
  number: '#',
  section: '§',
  description: '¶',
  checklist: '☑',
};

const TYPE_LABEL: Record<CardTemplateItem['type'], string> = {
  text: 'Texte court',
  longtext: 'Texte long',
  select: 'Liste',
  link: 'Lien',
  checkbox: 'Case',
  date: 'Date',
  number: 'Nombre',
  section: 'Section',
  description: 'Description',
  checklist: 'Checklist',
};

export interface ItemRowProps {
  readonly item: CardTemplateItem;
  readonly isEditing: boolean;
  readonly onEdit: (id: string) => void;
  readonly onRemove: (id: string) => void;
}

export function ItemRow({ item, isEditing, onEdit, onRemove }: ItemRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  const isSection = item.type === 'section';
  const isDesc = item.type === 'description';
  const isChecklist = item.type === 'checklist';

  return (
    <li
      ref={setNodeRef}
      style={style}
      onClick={() => onEdit(item.id)}
      className={`group flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
        isEditing
          ? 'border-[color:var(--color-accent-primary)] bg-[rgba(139,43,226,0.06)]'
          : isSection
            ? 'border-dashed border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)]'
            : isDesc || isChecklist
              ? 'border-[color:var(--color-accent-primary)]/30 bg-[rgba(139,43,226,0.06)]/50'
              : 'border-[color:var(--color-border-light)] bg-[color:var(--color-bg-muted)]'
      }`}
    >
      <span
        {...attributes}
        {...listeners}
        onClick={(e) => e.stopPropagation()}
        className="cursor-grab select-none text-xs text-[color:var(--color-text-muted)]"
        aria-label="Réorganiser"
      >
        ⋮⋮
      </span>
      <span className="flex h-6 w-6 items-center justify-center rounded-md border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] text-xs">
        {TYPE_ICON[item.type]}
      </span>
      <span className="flex-1 truncate font-medium">
        {item.type === 'description'
          ? 'Description'
          : item.type === 'checklist'
            ? `Checklist${item.items.length > 0 ? ` · ${item.items.length}` : ''}`
            : item.label}
      </span>
      <span className="rounded-full border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] px-2 py-0.5 text-[10px] text-[color:var(--color-text-muted)]">
        {TYPE_LABEL[item.type]}
      </span>
      <span className="flex gap-1 opacity-60 group-hover:opacity-100">
        <button
          type="button"
          aria-label="Supprimer"
          onClick={(e) => {
            e.stopPropagation();
            if (!window.confirm('Supprimer cet item ?')) return;
            onRemove(item.id);
          }}
          className="rounded border border-[color:var(--color-border-light)] px-1.5 py-0.5 text-xs text-[color:var(--color-text-muted)] hover:border-[color:var(--color-danger)] hover:text-[color:var(--color-danger)]"
        >
          ×
        </button>
      </span>
    </li>
  );
}
