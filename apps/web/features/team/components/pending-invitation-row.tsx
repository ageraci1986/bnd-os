'use client';
import { useActionState } from 'react';
import { CSRF_FIELD_NAME } from '@/lib/csrf';
import { revokeInvitation, type RevokeInvitationState } from '../actions/revoke-invitation';

export interface PendingInvitationRowProps {
  readonly csrfToken: string;
  readonly invitationId: string;
  readonly email: string;
  readonly role: 'admin' | 'member';
  readonly expiresAtIso: string;
  readonly expiresLabel: string;
}

const idle: RevokeInvitationState = { status: 'idle' };

export function PendingInvitationRow(props: PendingInvitationRowProps) {
  const [state, action, pending] = useActionState(revokeInvitation, idle);

  return (
    <li className="flex flex-wrap items-center gap-4 border-b border-[color:var(--color-border-soft)] py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold">{props.email}</p>
        <p className="text-xs text-[color:var(--color-text-muted)]">
          {props.role === 'admin' ? 'Admin' : 'Membre'} · expire{' '}
          <time dateTime={props.expiresAtIso}>{props.expiresLabel}</time>
        </p>
      </div>
      <form action={action}>
        <input type="hidden" name={CSRF_FIELD_NAME} value={props.csrfToken} />
        <input type="hidden" name="invitationId" value={props.invitationId} />
        <button
          type="submit"
          className="btn btn-danger btn-sm"
          disabled={pending}
          aria-busy={pending || undefined}
        >
          {pending ? '…' : 'Révoquer'}
        </button>
      </form>
      {state.status === 'error' ? (
        <p role="alert" className="basis-full text-xs font-medium text-[color:var(--color-danger)]">
          {state.message}
        </p>
      ) : null}
    </li>
  );
}
