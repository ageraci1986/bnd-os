'use client';
import { useEffect, useRef, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import { TrashIcon } from '@/features/shell/components/icons';
import { deleteProject } from '../actions/delete-project';

export interface DeleteProjectButtonProps {
  readonly projectId: string;
  readonly projectName: string;
  /**
   * `md` (default, 36px) matches `.view-toggle` height for the project header.
   * `sm` (28px) is used on the projects list cards where space is tighter.
   */
  readonly size?: 'sm' | 'md';
}

/**
 * Round red icon button + soft-delete confirmation modal.
 * The modal is portaled to <body> so it escapes any parent stacking
 * context (project cards have hover translates that would otherwise
 * trap the modal underneath the trash button overlays).
 */
export function DeleteProjectButton({
  projectId,
  projectName,
  size = 'md',
}: DeleteProjectButtonProps) {
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
      const res = await deleteProject({ projectId });
      // deleteProject calls redirect() on success → unreachable past that.
      if (res && !res.ok) setError(res.message);
    });
  };

  const isSm = size === 'sm';
  const btnSize = isSm ? 'h-7 w-7' : 'h-9 w-9';
  const iconPx = isSm ? 12 : 16;

  const modal =
    !open || !mounted
      ? null
      : createPortal(
          <>
            <div
              className="fixed inset-0 z-[200] bg-black/40"
              onClick={(e) => {
                e.stopPropagation();
                if (!pending) setOpen(false);
              }}
              aria-hidden="true"
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="delete-project-title"
              onClick={(e) => e.stopPropagation()}
              className="fixed left-1/2 top-1/2 z-[210] w-[420px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-6 shadow-2xl"
            >
              <h2
                id="delete-project-title"
                className="text-lg font-bold text-[color:var(--color-text-main)]"
              >
                Supprimer ce projet&nbsp;?
              </h2>
              <p className="mt-3 text-sm text-[color:var(--color-text-soft)]">
                Le projet «&nbsp;<strong>{projectName}</strong>&nbsp;» sera placé dans la corbeille
                pendant 30 jours. Les cartes restent attachées au projet et seront masquées des
                vues.
              </p>
              {error ? (
                <p className="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {error}
                </p>
              ) : null}
              <div className="mt-6 flex justify-end gap-2">
                <button
                  type="button"
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
        onClick={onTrigger}
        aria-label={`Supprimer le projet ${projectName}`}
        title="Supprimer ce projet"
        className={`inline-flex ${btnSize} items-center justify-center rounded-full border border-[color:var(--color-danger)] bg-[color:var(--color-danger)] text-white shadow-[var(--shadow-card)] transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-danger)]`}
      >
        <TrashIcon
          width={iconPx}
          height={iconPx}
          style={{ width: iconPx, height: iconPx, display: 'block' }}
        />
      </button>
      {modal}
    </>
  );
}
