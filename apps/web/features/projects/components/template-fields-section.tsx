'use client';
import { useEffect, useRef, useState } from 'react';
import { CARD_FIELD_GROUPS, type CardFieldDef } from '@nexushub/domain';
import { updateCardField } from '../actions/update-card-field';

export interface TemplateFieldsSectionProps {
  readonly cardId: string;
  readonly fields: readonly CardFieldDef[];
  readonly initialValues: Record<string, string>;
}

export function TemplateFieldsSection({
  cardId,
  fields,
  initialValues,
}: TemplateFieldsSectionProps) {
  if (fields.length === 0) return null;

  // Group fields for visual sectioning, preserving the order within each group.
  const grouped = new Map<string | undefined, CardFieldDef[]>();
  for (const f of fields) {
    const list = grouped.get(f.group);
    if (list) list.push(f);
    else grouped.set(f.group, [f]);
  }
  const groupOrder: (string | undefined)[] = [...CARD_FIELD_GROUPS.map((g) => g.id), undefined];

  return (
    <div className="grid gap-4">
      {groupOrder.map((g) => {
        const list = grouped.get(g);
        if (!list || list.length === 0) return null;
        const groupLabel = CARD_FIELD_GROUPS.find((x) => x.id === g)?.label;
        return (
          <div key={g ?? 'misc'}>
            {groupLabel ? (
              <div className="mb-2 text-[10px] font-extrabold uppercase tracking-[1px] text-[color:var(--color-text-muted)]">
                {groupLabel}
              </div>
            ) : null}
            <div className="grid gap-2">
              {list.map((f) => (
                <FieldInput
                  key={f.id}
                  cardId={cardId}
                  field={f}
                  initial={initialValues[f.id] ?? ''}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FieldInput({
  cardId,
  field,
  initial,
}: {
  cardId: string;
  field: CardFieldDef;
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
