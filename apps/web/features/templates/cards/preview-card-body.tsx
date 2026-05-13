'use client';
import type { CardTemplateItem, CardTemplateInputItem } from '@nexushub/domain';

export interface PreviewCardBodyProps {
  readonly items: readonly CardTemplateItem[];
}

export function PreviewCardBody({ items }: PreviewCardBodyProps) {
  if (items.length === 0) {
    return (
      <p className="text-xs text-[color:var(--color-text-muted)]">
        Aucun item — ajoute des champs, sections ou la description.
      </p>
    );
  }
  return (
    <div className="grid gap-4">
      {items.map((item) => {
        if (item.type === 'section') {
          return (
            <div className="section-label" key={item.id}>
              {item.label}
            </div>
          );
        }
        if (item.type === 'description') {
          return (
            <section className="modal-section" key={item.id}>
              <div className="section-label">Description</div>
              <p className="text-xs italic text-[color:var(--color-text-muted)]">
                Description de la carte (placeholder).
              </p>
            </section>
          );
        }
        if (item.type === 'checklist') {
          return (
            <section className="modal-section" key={item.id}>
              <div className="section-label">Checklist</div>
              {item.items.length === 0 ? (
                <p className="text-xs italic text-[color:var(--color-text-muted)]">
                  Section présente, pas d&apos;item par défaut.
                </p>
              ) : (
                <ul className="grid gap-1.5">
                  {item.items.map((label, idx) => (
                    <li
                      key={idx}
                      className="flex items-center gap-2 text-xs text-[color:var(--color-text-soft)]"
                    >
                      <span className="inline-block h-3.5 w-3.5 shrink-0 rounded border border-[color:var(--color-border-light)]" />
                      <span className="truncate">{label}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        }
        return <PreviewField key={item.id} field={item} />;
      })}
    </div>
  );
}

function PreviewField({ field }: { field: CardTemplateInputItem }) {
  const ph = previewPlaceholder(field);
  return (
    <label className="grid gap-1">
      <span className="text-[11px] font-bold text-[color:var(--color-text-soft)]">
        {field.label}
      </span>
      {field.type === 'longtext' ? (
        <textarea rows={3} readOnly value={ph} className="field-input opacity-70" />
      ) : field.type === 'select' ? (
        <select className="field-select opacity-70" disabled value={ph}>
          <option value={ph}>{ph}</option>
        </select>
      ) : field.type === 'checkbox' ? (
        <input type="checkbox" disabled />
      ) : (
        <input
          type={
            field.type === 'date'
              ? 'date'
              : field.type === 'number'
                ? 'number'
                : field.type === 'link'
                  ? 'url'
                  : 'text'
          }
          readOnly
          value={ph}
          className="field-input opacity-70"
        />
      )}
    </label>
  );
}

function previewPlaceholder(field: CardTemplateInputItem): string {
  if (field.placeholder) return field.placeholder;
  switch (field.type) {
    case 'text':
    case 'longtext':
      return 'Lorem ipsum dolor sit amet…';
    case 'select':
      return field.options?.[0] ?? '— Non défini —';
    case 'link':
      return 'https://example.com';
    case 'date':
      return new Date().toISOString().slice(0, 10);
    case 'number':
      return '42';
    case 'checkbox':
      return '';
  }
}
