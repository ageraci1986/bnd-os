'use client';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export interface StepChecklistModalProps {
  readonly open: boolean;
  readonly columnName: string;
  readonly items: readonly string[];
  readonly onClose: () => void;
  readonly onSave: (items: string[]) => void;
}

/**
 * Modal to edit a column's step-checklist items. Lives outside the
 * board so the user has room to type. State is local until Enregistrer
 * — Annuler discards the edits.
 */
export function StepChecklistModal({
  open,
  columnName,
  items,
  onClose,
  onSave,
}: StepChecklistModalProps) {
  const [mounted, setMounted] = useState(false);
  const [draft, setDraft] = useState<string[]>(() => [...items]);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Reset draft when the modal opens for a different column.
  useEffect(() => {
    if (open) setDraft([...items]);
  }, [open, items]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !mounted) return null;

  const update = (idx: number, value: string) => {
    setDraft((prev) => {
      const next = [...prev];
      next[idx] = value;
      return next;
    });
  };
  const remove = (idx: number) => setDraft((prev) => prev.filter((_, i) => i !== idx));
  const add = () => setDraft((prev) => [...prev, '']);

  const save = () => {
    const cleaned = draft.map((s) => s.trim()).filter((s) => s.length > 0);
    onSave(cleaned);
  };

  return createPortal(
    <>
      <div className="fixed inset-0 z-[200] bg-black/40" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="step-checklist-title"
        className="fixed left-1/2 top-1/2 z-[210] w-[480px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-6 shadow-2xl"
      >
        <header className="mb-4">
          <h2
            id="step-checklist-title"
            className="text-lg font-bold text-[color:var(--color-text-main)]"
          >
            Step-checklist · <span className="font-extrabold">{columnName || 'Colonne'}</span>
          </h2>
          <p className="mt-1 text-xs text-[color:var(--color-text-muted)]">
            Items pré-remplis pour les cartes dans cette colonne. Quand l&apos;utilisateur coche
            tout (checklist de la carte + step-checklist), la carte passe automatiquement à la
            colonne suivante.
          </p>
        </header>

        <div className="grid gap-1.5">
          {draft.length === 0 ? (
            <p className="rounded-md border border-dashed border-[color:var(--color-border-light)] px-3 py-3 text-center text-xs text-[color:var(--color-text-muted)]">
              Aucun item — la step-checklist n&apos;apparaîtra pas sur les cartes de cette colonne.
            </p>
          ) : null}
          {draft.map((value, idx) => (
            <div key={idx} className="flex items-center gap-1.5">
              <input
                type="text"
                value={value}
                maxLength={200}
                placeholder="Tâche à cocher…"
                autoFocus={idx === draft.length - 1 && value.length === 0}
                onChange={(e) => update(idx, e.target.value)}
                className="field-input flex-1"
              />
              <button
                type="button"
                onClick={() => remove(idx)}
                aria-label="Supprimer cet item"
                className="rounded border border-[color:var(--color-border-light)] px-2 py-1 text-xs text-[color:var(--color-text-muted)] hover:border-[color:var(--color-danger)] hover:text-[color:var(--color-danger)]"
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={add}
            className="self-start rounded border border-dashed border-[color:var(--color-border-light)] px-2.5 py-1 text-xs text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text-main)]"
          >
            + Ajouter un item
          </button>
        </div>

        <p className="mt-5 rounded-md bg-[color:var(--color-bg-muted)] px-3 py-2 text-[11px] text-[color:var(--color-text-muted)]">
          ⚠ « Appliquer » met à jour le brouillon. Pour conserver durablement, cliquez ensuite sur{' '}
          <strong>Enregistrer</strong> dans la barre du template.
        </p>
        <footer className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-ghost btn-sm">
            Annuler
          </button>
          <button type="button" onClick={save} className="btn btn-primary btn-sm">
            Appliquer
          </button>
        </footer>
      </div>
    </>,
    document.body,
  );
}
