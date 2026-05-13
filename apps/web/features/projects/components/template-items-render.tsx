'use client';
import { useEffect, useRef, useState } from 'react';
import type { CardTemplateItem, CardTemplateInputItem } from '@nexushub/domain';
import { updateCardField } from '../actions/update-card-field';
import { CardDescriptionInput } from './card-description-input';

export interface TemplateItemsRenderProps {
  readonly cardId: string;
  readonly items: readonly CardTemplateItem[];
  readonly fieldValues: Record<string, string>;
  readonly description: string;
}

export function TemplateItemsRender({
  cardId,
  items,
  fieldValues,
  description,
}: TemplateItemsRenderProps) {
  if (items.length === 0) return null;
  return (
    <>
      {items.map((item) => {
        if (item.type === 'section') {
          return (
            <section className="modal-section" key={item.id}>
              <div className="section-label">{item.label}</div>
            </section>
          );
        }
        if (item.type === 'description') {
          return (
            <section className="modal-section" key={item.id}>
              <div className="section-label">Description</div>
              <CardDescriptionInput cardId={cardId} initial={description} />
            </section>
          );
        }
        // Checklist is rendered separately by CardModal (it owns the
        // interactive checklist state); skip it here so we don't render
        // twice. The presence of this item in the template still drives
        // the visibility of CardModal's checklist section.
        if (item.type === 'checklist') return null;
        return (
          <section className="modal-section" key={item.id}>
            <FieldInput cardId={cardId} field={item} initial={fieldValues[item.id] ?? ''} />
          </section>
        );
      })}
    </>
  );
}

function FieldInput({
  cardId,
  field,
  initial,
}: {
  cardId: string;
  field: CardTemplateInputItem;
  initial: string;
}) {
  const [value, setValue] = useState(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setValue(initial);
  }, [initial]);

  const flush = (next: string) => {
    void updateCardField({ cardId, fieldId: field.id, value: next }).catch(() => {
      // best-effort save; the next debounced flush will retry
    });
  };

  const onChangeDebounced = (next: string) => {
    setValue(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => flush(next), 600);
  };

  if (field.type === 'select') {
    return (
      <label className="grid gap-1">
        <span className="text-[11px] font-bold text-[color:var(--color-text-soft)]">
          {field.label}
        </span>
        <select
          className="field-select"
          value={value}
          onChange={(e) => {
            const next = e.target.value;
            setValue(next);
            // Selects don't need debounce — fire immediately.
            flush(next);
          }}
        >
          <option value="">— Non défini —</option>
          {field.options?.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (field.type === 'longtext') {
    return (
      <label className="grid gap-1">
        <span className="text-[11px] font-bold text-[color:var(--color-text-soft)]">
          {field.label}
        </span>
        <textarea
          rows={3}
          maxLength={8000}
          placeholder={field.placeholder ?? ''}
          value={value}
          onChange={(e) => onChangeDebounced(e.target.value)}
          className="field-input"
        />
      </label>
    );
  }

  if (field.type === 'checkbox') {
    const checked = value === 'true';
    return (
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => {
            const next = e.target.checked ? 'true' : 'false';
            setValue(next);
            flush(next);
          }}
        />
        <span className="font-bold">{field.label}</span>
      </label>
    );
  }

  if (field.type === 'date') {
    return (
      <label className="grid gap-1">
        <span className="text-[11px] font-bold text-[color:var(--color-text-soft)]">
          {field.label}
        </span>
        <input
          type="date"
          value={value}
          onChange={(e) => {
            // Date pickers are discrete — fire immediately.
            const next = e.target.value;
            setValue(next);
            flush(next);
          }}
          className="field-input"
          style={{ maxWidth: 200 }}
        />
      </label>
    );
  }

  if (field.type === 'number') {
    return (
      <label className="grid gap-1">
        <span className="text-[11px] font-bold text-[color:var(--color-text-soft)]">
          {field.label}
        </span>
        <input
          type="number"
          inputMode="decimal"
          placeholder={field.placeholder ?? ''}
          value={value}
          onChange={(e) => onChangeDebounced(e.target.value)}
          className="field-input"
          style={{ maxWidth: 200 }}
        />
      </label>
    );
  }

  // text + link share the same single-line input.
  return (
    <label className="grid gap-1">
      <span className="text-[11px] font-bold text-[color:var(--color-text-soft)]">
        {field.label}
      </span>
      <input
        type={field.type === 'link' ? 'url' : 'text'}
        maxLength={2000}
        placeholder={field.placeholder ?? ''}
        value={value}
        onChange={(e) => onChangeDebounced(e.target.value)}
        className="field-input"
      />
    </label>
  );
}
