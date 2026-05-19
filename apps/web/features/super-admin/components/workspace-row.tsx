'use client';
import { useState, useTransition } from 'react';
import { CSRF_FIELD_NAME } from '@/lib/csrf/field';
import { inviteAdminToWorkspace } from '../actions/invite-admin-to-workspace';
import { notify } from '@/features/shell/components/toaster';
import { DeleteWorkspaceModal } from './delete-workspace-modal';

export interface WorkspaceRowProps {
  readonly csrfToken: string;
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly createdAtLabel: string;
  readonly memberCount: number;
  readonly pendingInvitationCount: number;
  readonly admins: readonly { displayName: string; email: string }[];
}

export function WorkspaceRow(props: WorkspaceRowProps) {
  const [inviteOpen, setInviteOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState('');

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await inviteAdminToWorkspace({ status: 'idle' }, fd);
      if (result.status === 'error') {
        notify({ tone: 'error', message: result.message });
      } else if (result.status === 'success') {
        notify({
          tone: 'success',
          message: `Invitation Admin envoyée à ${result.email} (${props.name}).`,
        });
        setEmail('');
        setInviteOpen(false);
      }
    });
  };

  return (
    <li className="border-b border-[color:var(--color-border-soft)] py-4 last:border-b-0">
      <div className="flex flex-wrap items-center gap-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold">
            {props.name}
            <span className="ml-2 rounded-full bg-[color:var(--color-bg-hover)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.5px] text-[color:var(--color-text-muted)]">
              {props.slug}
            </span>
          </p>
          <p className="mt-0.5 text-xs text-[color:var(--color-text-muted)]">
            Créé le {props.createdAtLabel} · {props.memberCount}{' '}
            {props.memberCount <= 1 ? 'membre' : 'membres'}
            {props.pendingInvitationCount > 0
              ? ` · ${props.pendingInvitationCount} invitation${props.pendingInvitationCount > 1 ? 's' : ''} en attente`
              : ''}
          </p>
          {props.admins.length > 0 ? (
            <p className="mt-1 text-[11px] text-[color:var(--color-text-muted)]">
              Admins :{' '}
              {props.admins.map((a, i) => (
                <span key={a.email}>
                  {i > 0 ? ', ' : ''}
                  <span title={a.email}>{a.displayName}</span>
                </span>
              ))}
            </p>
          ) : (
            <p className="mt-1 text-[11px] italic text-[color:var(--color-text-muted)]">
              Aucun Admin actif (invitation pas encore acceptée ?)
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setInviteOpen((v) => !v)}
          >
            {inviteOpen ? 'Annuler' : '+ Inviter un Admin'}
          </button>
          <button
            type="button"
            className="btn btn-danger btn-sm"
            onClick={() => setDeleteOpen(true)}
            title="Supprimer définitivement ce workspace et tout son contenu"
          >
            Supprimer
          </button>
        </div>
      </div>

      {inviteOpen ? (
        <form onSubmit={onSubmit} className="mt-3 flex flex-wrap items-end gap-2">
          <input type="hidden" name={CSRF_FIELD_NAME} value={props.csrfToken} />
          <input type="hidden" name="workspaceId" value={props.id} />
          <div className="min-w-[240px] flex-1">
            <label className="field-label" htmlFor={`invite-${props.id}`}>
              Email du nouvel Admin
            </label>
            <input
              id={`invite-${props.id}`}
              name="email"
              type="email"
              required
              maxLength={254}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin2@example.com"
              className="field-input"
            />
          </div>
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={pending}
            aria-busy={pending || undefined}
          >
            {pending ? 'Envoi…' : 'Envoyer l’invitation'}
          </button>
        </form>
      ) : null}

      {deleteOpen ? (
        <DeleteWorkspaceModal
          csrfToken={props.csrfToken}
          workspaceId={props.id}
          workspaceName={props.name}
          slug={props.slug}
          memberCount={props.memberCount}
          onClose={() => setDeleteOpen(false)}
        />
      ) : null}
    </li>
  );
}
