'use client';
import { useEffect, useRef, useState } from 'react';
import { Tag, type TagVariant } from '@nexushub/ui';
import { BUILTIN_CARD_CATEGORIES } from '@nexushub/domain';
import { customCategoryColor } from '../lib/custom-category-color';
import {
  CARD_ADVANCED_EVENT,
  CARD_REMOVED_EVENT,
  OPEN_CARD_EVENT,
  type CardAdvancedEventDetail,
  type CardRemovedEventDetail,
  type OpenCardEventDetail,
} from './card-modal-controller';
import { CardAdvanceCheckbox } from './card-advance-checkbox';
import { DeleteKanbanCardButton } from './delete-kanban-card-button';
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
  readonly assignees: readonly ListViewAssignee[];
  readonly checklistTotal: number;
  readonly checklistChecked: number;
  readonly templateName: string | null;
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

export function ListView({ projectId, csrfToken, cards, columns }: ListViewProps) {
  const { selected, toggle, reset } = useListViewColumns(projectId);
  const [localCards, setLocalCards] = useState<readonly ListViewCard[]>(cards);
  useEffect(() => setLocalCards(cards), [cards]);
  useEffect(() => {
    const onRemoved = (e: Event) => {
      const detail = (e as CustomEvent<CardRemovedEventDetail>).detail;
      if (!detail || typeof detail.id !== 'string') return;
      setLocalCards((prev) => prev.filter((c) => c.id !== detail.id));
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
    window.addEventListener(CARD_REMOVED_EVENT, onRemoved);
    window.addEventListener(CARD_ADVANCED_EVENT, onAdvanced);
    return () => {
      window.removeEventListener(CARD_REMOVED_EVENT, onRemoved);
      window.removeEventListener(CARD_ADVANCED_EVENT, onAdvanced);
    };
  }, [columns]);

  // Group cards by Kanban column for visual sections inside the list.
  const byColumn = new Map<string, ListViewCard[]>();
  for (const c of localCards) {
    const list = byColumn.get(c.columnName) ?? [];
    list.push(c);
    byColumn.set(c.columnName, list);
  }
  const orderedColumns = columns.map((c) => c.name).filter((n) => byColumn.has(n));

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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-[color:var(--color-text-muted)]">
          {localCards.length} {localCards.length <= 1 ? 'carte' : 'cartes'} · clic sur une carte
          pour l&apos;ouvrir
        </p>
        <ColumnPicker selected={selected} onToggle={toggle} onReset={reset} />
      </div>

      {localCards.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-12 text-center text-sm text-[color:var(--color-text-muted)]">
          Aucune carte dans ce projet.
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {/* Table header row — sticks above the first section. */}
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

          {orderedColumns.map((colName) => {
            const rows = byColumn.get(colName) ?? [];
            return (
              <section key={colName} className="flex flex-col gap-2">
                <header className="flex items-baseline gap-2 px-1">
                  <h2 className="text-[10px] font-extrabold uppercase tracking-[1px] text-[color:var(--color-text-muted)]">
                    {colName}
                  </h2>
                  <span className="text-[10px] text-[color:var(--color-text-ghost)]">
                    {rows.length}
                  </span>
                </header>
                <ul className="flex flex-col gap-2">
                  {rows.map((card) => {
                    const cannotAdvance =
                      blockedColumnIds.has(card.columnId) || card.columnId === lastUserColumnId;
                    return (
                      <ListRow
                        key={card.id}
                        card={card}
                        csrfToken={csrfToken}
                        selected={selected}
                        gridTemplate={gridTemplate}
                        cannotAdvance={cannotAdvance}
                      />
                    );
                  })}
                </ul>
              </section>
            );
          })}
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
}: {
  card: ListViewCard;
  csrfToken: string;
  selected: readonly ListViewFieldId[];
  gridTemplate: string;
  cannotAdvance: boolean;
}) {
  const onClick = () => {
    const detail: OpenCardEventDetail = {
      id: card.id,
      title: card.title,
      shortRef: card.shortRef,
      categoryTag: card.categoryTag,
    };
    window.dispatchEvent(new CustomEvent(OPEN_CARD_EVENT, { detail }));
  };

  return (
    <li
      onClick={onClick}
      className="group relative grid cursor-pointer items-center gap-3 rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] px-4 py-3 shadow-[var(--shadow-card)] transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-hover)]"
      style={{ gridTemplateColumns: gridTemplate }}
    >
      <div onClick={(e) => e.stopPropagation()} className="flex items-center justify-center">
        <CardAdvanceCheckbox cardId={card.id} disabled={cannotAdvance} />
      </div>

      <div className="min-w-0 truncate text-sm font-bold text-[color:var(--color-text-main)]">
        {card.title}
      </div>

      {selected.map((id) => (
        <FieldCell key={id} field={id} card={card} />
      ))}

      <div
        onClick={(e) => e.stopPropagation()}
        className="pointer-events-none flex justify-end opacity-0 transition-opacity duration-150 focus-within:pointer-events-auto focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100"
      >
        <DeleteKanbanCardButton cardId={card.id} cardTitle={card.title} csrfToken={csrfToken} />
      </div>
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
