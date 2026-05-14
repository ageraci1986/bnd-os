'use client';
import { useActionState } from 'react';
import { CSRF_FIELD_NAME } from '@/lib/csrf/field';
import { changeMemberRole, type ChangeRoleState } from '../actions/change-member-role';
import { removeMember, type RemoveMemberState } from '../actions/remove-member';

export interface MemberRowProps {
  readonly csrfToken: string;
  readonly membershipId: string;
  readonly userId: string;
  readonly currentUserId: string;
  readonly displayName: string;
  readonly email: string;
  readonly role: 'admin' | 'user' | 'viewer';
  readonly isSuperAdmin: boolean;
}

const idleRole: ChangeRoleState = { status: 'idle' };
const idleRemove: RemoveMemberState = { status: 'idle' };

export function MemberRow(props: MemberRowProps) {
  const [roleState, roleAction, rolePending] = useActionState(changeMemberRole, idleRole);
  const [removeState, removeAction, removePending] = useActionState(removeMember, idleRemove);
  const isSelf = props.userId === props.currentUserId;

  const initials =
    props.displayName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase())
      .join('') || props.email.slice(0, 2).toUpperCase();

  return (
    <li className="flex flex-wrap items-center gap-4 border-b border-[color:var(--color-border-soft)] py-4 last:border-b-0">
      <span
        className="grid h-10 w-10 place-items-center rounded-full text-xs font-bold text-white"
        style={{ background: 'linear-gradient(135deg,#8B2BE2,#FF2A6D)' }}
        aria-hidden="true"
      >
        {initials}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold">
          {props.displayName}
          {isSelf ? (
            <span className="ml-2 rounded-full bg-[color:var(--color-bg-hover)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.5px] text-[color:var(--color-text-muted)]">
              Vous
            </span>
          ) : null}
          {props.isSuperAdmin ? (
            <span
              className="ml-2 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.5px] text-white"
              style={{ backgroundImage: 'var(--accent-gradient)' }}
              title="Super-admin de la plateforme"
            >
              Super-admin
            </span>
          ) : null}
        </p>
        <p className="truncate text-xs text-[color:var(--color-text-muted)]">{props.email}</p>
      </div>

      <form action={roleAction} className="flex items-center gap-2">
        <input type="hidden" name={CSRF_FIELD_NAME} value={props.csrfToken} />
        <input type="hidden" name="membershipId" value={props.membershipId} />
        <label className="sr-only" htmlFor={`role-${props.membershipId}`}>
          Rôle de {props.displayName}
        </label>
        <select
          id={`role-${props.membershipId}`}
          name="role"
          defaultValue={props.role}
          disabled={rolePending}
          className="field-select w-32"
        >
          <option value="user">User</option>
          <option value="admin">Admin</option>
          <option value="viewer" disabled title="Disponible bientôt (Phase B)">
            Viewer (bientôt)
          </option>
        </select>
        <button
          type="submit"
          className="btn btn-ghost btn-sm"
          disabled={rolePending}
          aria-busy={rolePending || undefined}
        >
          {rolePending ? '…' : 'OK'}
        </button>
      </form>

      <form action={removeAction}>
        <input type="hidden" name={CSRF_FIELD_NAME} value={props.csrfToken} />
        <input type="hidden" name="membershipId" value={props.membershipId} />
        <button
          type="submit"
          className="btn btn-danger btn-sm"
          disabled={removePending || isSelf}
          aria-disabled={isSelf ? true : undefined}
          title={isSelf ? 'Vous ne pouvez pas vous retirer vous-même' : 'Retirer du workspace'}
        >
          {removePending ? '…' : 'Retirer'}
        </button>
      </form>

      {roleState.status === 'error' || removeState.status === 'error' ? (
        <p role="alert" className="basis-full text-xs font-medium text-[color:var(--color-danger)]">
          {roleState.status === 'error' ? roleState.message : null}
          {removeState.status === 'error' ? removeState.message : null}
        </p>
      ) : null}
    </li>
  );
}
