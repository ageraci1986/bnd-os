'use client';
import { useEffect, useRef, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import { CSRF_FIELD_NAME } from '@/lib/csrf/field';
import { deleteWorkspace } from '../actions/delete-workspace';
import { notify } from '@/features/shell/components/toaster';

export interface DeleteWorkspaceModalProps {
  readonly csrfToken: string;
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly slug: string;
  readonly memberCount: number;
  readonly onClose: () => void;
}

/**
 * Hard-delete confirmation modal for a workspace. Mirrors GitHub's
 * "type the repo name to confirm" pattern — the submit button stays
 * disabled until the typed value matches `workspaceName` exactly
 * (no trim, no case-fold). The server action re-validates the same
 * way so a crafted request can't dodge the safeguard.
 */
export function DeleteWorkspaceModal({
  csrfToken,
  workspaceId,
  workspaceName,
  slug,
  memberCount,
  onClose,
}: DeleteWorkspaceModalProps) {
  const [typed, setTyped] = useState('');
  const [pending, startTransition] = useTransition();
  const dialogRef = useRef<HTMLDivElement>(null);

  // Close on Escape; trap focus inside the modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !pending) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, pending]);

  // Focus the input on mount so the user can type immediately.
  useEffect(() => {
    const input = dialogRef.current?.querySelector<HTMLInputElement>(
      'input[name="confirmationName"]',
    );
    input?.focus();
  }, []);

  const matches = typed === workspaceName;

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!matches || pending) return;
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await deleteWorkspace({ status: 'idle' }, fd);
      if (result.status === 'error') {
        notify({ tone: 'error', message: result.message });
        return;
      }
      if (result.status === 'success') {
        notify({
          tone: 'success',
          message: `Workspace « ${result.deletedName} » supprimé définitivement.`,
        });
        onClose();
      }
    });
  };

  if (typeof window === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-workspace-title"
    >
      <button
        type="button"
        aria-label="Fermer"
        className="absolute inset-0 bg-black/55 backdrop-blur-sm"
        onClick={() => {
          if (!pending) onClose();
        }}
      />
      <div
        ref={dialogRef}
        className="relative z-10 w-[min(560px,calc(100vw-32px))] rounded-2xl border bg-[color:var(--color-bg-card)] p-6 shadow-xl"
        style={{
          borderColor: 'var(--color-danger)',
          borderLeftWidth: 4,
        }}
      >
        <h2
          id="delete-workspace-title"
          className="mb-2 text-lg font-extrabold tracking-tight text-[color:var(--color-danger)]"
        >
          ⚠ Supprimer définitivement « {workspaceName} »
        </h2>

        <div
          className="mb-4 rounded-md border px-3 py-3 text-sm"
          style={{
            borderColor: 'var(--color-danger)',
            background: 'var(--color-danger-bg)',
            color: 'var(--color-danger)',
          }}
        >
          <strong>Cette action est IRRÉVERSIBLE</strong> et supprime <strong>tout</strong> :
          <ul className="mt-2 list-disc space-y-0.5 pl-5">
            <li>
              {memberCount} {memberCount <= 1 ? 'membre' : 'membres'} (perdent leur accès)
            </li>
            <li>Tous les projets + cartes + commentaires + checklists</li>
            <li>Tous les clients + contacts</li>
            <li>Toutes les invitations en attente</li>
            <li>Toutes les intégrations (Slack, Exchange) + tokens chiffrés</li>
            <li>Tous les templates Kanban + cartes + emails</li>
            <li>Tous les audit logs et notifications</li>
          </ul>
        </div>

        <form onSubmit={onSubmit}>
          <input type="hidden" name={CSRF_FIELD_NAME} value={csrfToken} />
          <input type="hidden" name="workspaceId" value={workspaceId} />

          <p className="mb-2 text-sm">
            Pour confirmer, tape le nom exact du workspace :{' '}
            <code className="rounded bg-[color:var(--color-bg-hover)] px-1.5 py-0.5 text-xs font-bold">
              {workspaceName}
            </code>
          </p>
          <input
            type="text"
            name="confirmationName"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={workspaceName}
            autoComplete="off"
            spellCheck={false}
            className="field-input"
            disabled={pending}
            aria-describedby="delete-workspace-hint"
          />
          <p
            id="delete-workspace-hint"
            className="mt-1 text-[11px] text-[color:var(--color-text-muted)]"
          >
            Slug : <code>{slug}</code> · La sensibilité à la casse compte.
          </p>

          <div className="mt-5 flex items-center justify-end gap-2">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={onClose}
              disabled={pending}
            >
              Annuler
            </button>
            <button
              type="submit"
              className="btn btn-danger btn-sm"
              disabled={!matches || pending}
              aria-busy={pending || undefined}
              title={
                matches
                  ? `Supprime ${workspaceName} et tout son contenu`
                  : 'Tape le nom exact pour activer'
              }
            >
              {pending ? 'Suppression…' : 'Supprimer définitivement'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
