'use client';
import { StarGradientIcon } from '@/features/shell/components/icons';
import type { TemplateDTO } from './use-editor-state';

export interface TemplatesListProps {
  readonly templates: readonly TemplateDTO[];
  readonly selectedId: string | null;
  readonly isDirty: boolean;
  readonly onSelect: (id: string) => void;
  readonly onCreate: () => void;
  readonly onDelete: (id: string, name: string) => void;
}

export function TemplatesList({
  templates,
  selectedId,
  isDirty,
  onSelect,
  onCreate,
  onDelete,
}: TemplatesListProps) {
  return (
    <aside className="flex h-full flex-col gap-2 rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-3">
      <header className="flex items-center justify-between px-1">
        <p className="text-[10px] font-extrabold uppercase tracking-[1px] text-[color:var(--color-text-muted)]">
          Templates
        </p>
        <button
          type="button"
          onClick={() => {
            if (
              isDirty &&
              !window.confirm('Modifications non sauvées. Créer un nouveau template quand même ?')
            )
              return;
            onCreate();
          }}
          className="rounded-md border border-dashed border-[color:var(--color-border-light)] px-2 py-0.5 text-xs text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text-main)]"
        >
          + Nouveau
        </button>
      </header>
      <ul className="flex flex-col gap-1">
        {templates.length === 0 ? (
          <li className="px-2 py-3 text-xs text-[color:var(--color-text-muted)]">
            Aucun template — crée le premier ↑
          </li>
        ) : (
          templates.map((t) => (
            <li key={t.id} className="group flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  if (selectedId === t.id) return;
                  if (
                    isDirty &&
                    !window.confirm('Modifications non sauvées. Changer de template ?')
                  )
                    return;
                  onSelect(t.id);
                }}
                className={`flex flex-1 items-center gap-2 truncate rounded-md px-2 py-1.5 text-left text-sm ${
                  selectedId === t.id
                    ? 'bg-[rgba(139,43,226,0.12)] font-medium text-[color:var(--color-text-main)]'
                    : 'text-[color:var(--color-text-soft)] hover:bg-[color:var(--color-bg-muted)]'
                }`}
              >
                {t.isDefault ? (
                  <span
                    aria-label="Template par défaut"
                    title="Template par défaut"
                    className="inline-flex shrink-0"
                  >
                    <StarGradientIcon width={13} height={13} style={{ width: 13, height: 13 }} />
                  </span>
                ) : null}
                <span className="flex-1 truncate">{t.name || 'Sans titre'}</span>
              </button>
              <button
                type="button"
                aria-label={`Supprimer ${t.name}`}
                onClick={() => onDelete(t.id, t.name)}
                className="rounded-md px-1 text-sm text-[color:var(--color-text-muted)] opacity-0 hover:text-[color:var(--color-danger)] group-hover:opacity-100"
              >
                ×
              </button>
            </li>
          ))
        )}
      </ul>
    </aside>
  );
}
