'use client';
import { useEffect } from 'react';
import type {
  CardTemplateItem,
  CardTemplateInputItem,
  CardTemplateInputType,
} from '@nexushub/domain';

export interface EditItemDrawerProps {
  readonly item: CardTemplateItem | null;
  readonly onClose: () => void;
  readonly onUpdate: (id: string, patch: Record<string, unknown>) => void;
  readonly onConvertType: (id: string, toType: CardTemplateInputType) => void;
  readonly onRemove: (id: string) => void;
}

const CONVERTIBLE_TYPES: { id: CardTemplateInputType; label: string }[] = [
  { id: 'text', label: 'Texte court' },
  { id: 'longtext', label: 'Texte long' },
  { id: 'select', label: 'Liste déroulante' },
  { id: 'link', label: 'Lien URL' },
  { id: 'checkbox', label: 'Case à cocher' },
  { id: 'date', label: 'Date' },
  { id: 'number', label: 'Nombre' },
];

export function EditItemDrawer({
  item,
  onClose,
  onUpdate,
  onConvertType,
  onRemove,
}: EditItemDrawerProps) {
  useEffect(() => {
    if (!item) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [item, onClose]);

  if (!item) return null;

  const itemLabel =
    item.type === 'description'
      ? 'Description'
      : item.label || (item.type === 'section' ? 'Section' : 'Sans label');

  return (
    <div className="absolute inset-0 z-30 flex flex-col gap-3 overflow-hidden rounded-2xl border border-[color:var(--color-accent-primary)] bg-[color:var(--color-bg-card)] p-4 shadow-xl">
      <header className="flex items-start justify-between">
        <div>
          <p className="text-[10px] font-extrabold uppercase tracking-[1px] text-[color:var(--color-text-muted)]">
            Édition d&apos;un item
          </p>
          <h3 className="text-sm font-bold">{itemLabel}</h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-[color:var(--color-border-light)] px-2 py-0.5 text-xs text-[color:var(--color-text-muted)]"
          aria-label="Fermer"
        >
          ×
        </button>
      </header>

      {item.type === 'description' ? (
        <p className="rounded-lg border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-muted)] px-3 py-2 text-xs text-[color:var(--color-text-muted)]">
          Élément système. Sa position dans la carte est contrôlée par drag &amp; drop&nbsp;; aucun
          autre réglage.
        </p>
      ) : item.type === 'section' ? (
        <LabelField value={item.label} onChange={(v) => onUpdate(item.id, { label: v })} />
      ) : (
        <InputItemFields item={item} onUpdate={onUpdate} onConvertType={onConvertType} />
      )}

      <footer className="mt-auto flex items-center justify-between border-t border-[color:var(--color-border-light)] pt-3">
        <button
          type="button"
          onClick={() => {
            if (!window.confirm('Supprimer cet item ?')) return;
            onRemove(item.id);
          }}
          className="text-xs text-[color:var(--color-danger)] hover:underline"
        >
          Supprimer
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md bg-[color:var(--color-accent-primary)] px-3 py-1 text-xs font-medium text-white"
        >
          Fermer
        </button>
      </footer>
    </div>
  );
}

// ---------- Sub-components --------------------------------------------------

function InputItemFields({
  item,
  onUpdate,
  onConvertType,
}: {
  item: CardTemplateInputItem;
  onUpdate: (id: string, patch: Record<string, unknown>) => void;
  onConvertType: (id: string, toType: CardTemplateInputType) => void;
}) {
  const showPlaceholder = item.type !== 'checkbox' && item.type !== 'date';
  return (
    <>
      <TypeSelector currentType={item.type} onChange={(toType) => onConvertType(item.id, toType)} />
      <LabelField value={item.label} onChange={(v) => onUpdate(item.id, { label: v })} />
      {showPlaceholder ? (
        <PlaceholderField
          value={item.placeholder ?? ''}
          onChange={(v) => onUpdate(item.id, { placeholder: v })}
        />
      ) : null}
      {item.type === 'select' ? (
        <OptionsField
          options={item.options ?? []}
          onChange={(opts) => onUpdate(item.id, { options: opts })}
        />
      ) : null}
    </>
  );
}

function LabelField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="grid gap-1">
      <span className="text-[10px] font-extrabold uppercase tracking-[1px] text-[color:var(--color-text-muted)]">
        Label
      </span>
      <input
        type="text"
        value={value}
        maxLength={120}
        onChange={(e) => onChange(e.target.value)}
        className="field-input"
      />
    </label>
  );
}

function PlaceholderField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="grid gap-1">
      <span className="text-[10px] font-extrabold uppercase tracking-[1px] text-[color:var(--color-text-muted)]">
        Placeholder
      </span>
      <input
        type="text"
        value={value}
        maxLength={200}
        onChange={(e) => onChange(e.target.value)}
        className="field-input"
      />
    </label>
  );
}

function TypeSelector({
  currentType,
  onChange,
}: {
  currentType: CardTemplateInputItem['type'];
  onChange: (to: CardTemplateInputType) => void;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-[10px] font-extrabold uppercase tracking-[1px] text-[color:var(--color-text-muted)]">
        Type
      </span>
      <select
        className="field-select"
        value={currentType}
        onChange={(e) => onChange(e.target.value as CardTemplateInputType)}
      >
        {CONVERTIBLE_TYPES.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function OptionsField({
  options,
  onChange,
}: {
  options: readonly string[];
  onChange: (opts: string[]) => void;
}) {
  const update = (idx: number, value: string) => {
    const next = [...options];
    next[idx] = value;
    onChange(next);
  };
  const remove = (idx: number) => onChange(options.filter((_, i) => i !== idx));
  const add = () => onChange([...options, '']);

  return (
    <div className="grid gap-1">
      <span className="text-[10px] font-extrabold uppercase tracking-[1px] text-[color:var(--color-text-muted)]">
        Options
      </span>
      <div className="grid gap-1.5">
        {options.map((opt, idx) => (
          <div key={idx} className="flex items-center gap-1.5">
            <input
              type="text"
              value={opt}
              maxLength={80}
              onChange={(e) => update(idx, e.target.value)}
              className="field-input flex-1"
            />
            <button
              type="button"
              onClick={() => remove(idx)}
              className="rounded border border-[color:var(--color-border-light)] px-2 py-0.5 text-xs text-[color:var(--color-text-muted)] hover:border-[color:var(--color-danger)] hover:text-[color:var(--color-danger)]"
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={add}
          className="self-start rounded border border-dashed border-[color:var(--color-border-light)] px-2 py-1 text-xs text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text-main)]"
        >
          + Ajouter une option
        </button>
      </div>
    </div>
  );
}
