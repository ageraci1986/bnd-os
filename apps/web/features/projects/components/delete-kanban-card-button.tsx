'use client';
import { useEffect, useRef, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import { TrashIcon } from '@/features/shell/components/icons';
import { CSRF_FIELD_NAME } from '@/lib/csrf/field';
import { deleteCard } from '../actions/delete-card';
import {
  CARD_REMOVED_EVENT,
  CLOSE_CARD_EVENT,
  type CardRemovedEventDetail,
} from './card-modal-controller';

export interface DeleteKanbanCardButtonProps {
  readonly cardId: string;
  readonly cardTitle: string;
  readonly csrfToken: string;
}

/**
 * Round red trash button + confirmation modal for soft-deleting a card
 * directly from the kanban board (hover-only on the kanban-card). On
 * success, dispatches CARD_REMOVED so the board removes the row
 * client-side and CLOSE_CARD in case the card modal was open.
 */
export function DeleteKanbanCardButton({
  cardId,
  cardTitle,
  csrfToken,
}: DeleteKanbanCardButtonProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const dangerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    dangerRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const onTrigger = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setOpen(true);
  };

  const confirm = () => {
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set(CSRF_FIELD_NAME, csrfToken);
      fd.set('cardId', cardId);
      const res = await deleteCard({ status: 'idle' }, fd);
      if (res.status === 'error') {
        setError(res.message);
        return;
      }
      // Optimistic board removal + close any open modal pointing at this card.
      const removed: CardRemovedEventDetail = { id: cardId };
      window.dispatchEvent(new CustomEvent(CARD_REMOVED_EVENT, { detail: removed }));
      window.dispatchEvent(new CustomEvent(CLOSE_CARD_EVENT));
      setOpen(false);
    });
  };

  const modal =
    !open || !mounted
      ? null
      : createPortal(
          <>
            <div
              className="fixed inset-0 z-[200] bg-black/40"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                if (!pending) setOpen(false);
              }}
              aria-hidden="true"
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="delete-card-title"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              className="fixed left-1/2 top-1/2 z-[210] w-[420px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-6 shadow-2xl"
            >
              <h2
                id="delete-card-title"
                className="text-lg font-bold text-[color:var(--color-text-main)]"
              >
                Supprimer cette carte&nbsp;?
              </h2>
              <p className="mt-3 text-sm text-[color:var(--color-text-soft)]">
                La carte «&nbsp;<strong>{cardTitle}</strong>&nbsp;» sera supprimée du board.
              </p>
              {error ? (
                <p className="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {error}
                </p>
              ) : null}
              <div className="mt-6 flex justify-end gap-2">
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpen(false);
                  }}
                  disabled={pending}
                  className="rounded-md border border-[color:var(--color-border-light)] px-3 py-1.5 text-xs font-medium text-[color:var(--color-text-soft)] disabled:opacity-50"
                >
                  Annuler
                </button>
                <button
                  ref={dangerRef}
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    confirm();
                  }}
                  disabled={pending}
                  className="rounded-md bg-[color:var(--color-danger)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                >
                  {pending ? 'Suppression…' : 'Supprimer définitivement'}
                </button>
              </div>
            </div>
          </>,
          document.body,
        );

  return (
    <>
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={onTrigger}
        aria-label={`Supprimer ${cardTitle}`}
        title="Supprimer cette carte"
        className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[color:var(--color-danger)] bg-[color:var(--color-danger)] text-white shadow-[var(--shadow-card)] transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-danger)]"
      >
        <TrashIcon width={12} height={12} style={{ width: 12, height: 12, display: 'block' }} />
      </button>
      {modal}
    </>
  );
}
