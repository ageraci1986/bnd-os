'use client';
import { useEffect, useState, useTransition } from 'react';
import type { UserScope } from '@nexushub/domain';
import { CSRF_FIELD_NAME } from '@/lib/csrf/field';
import { changeMemberRole } from '../actions/change-member-role';
import { removeMember } from '../actions/remove-member';
import { notify } from '@/features/shell/components/toaster';
import { ScopeChip } from './scope-chip';
import { ScopeModal } from './scope-modal';

export interface MemberRowProps {
  readonly csrfToken: string;
  readonly membershipId: string;
  readonly userId: string;
  readonly currentUserId: string;
  readonly displayName: string;
  readonly email: string;
  readonly role: 'admin' | 'user' | 'viewer';
  readonly isSuperAdmin: boolean;
  /** undefined for Admin (no scope possible). Otherwise the current scope. */
  readonly scope?: UserScope;
  readonly clientOptions: readonly { id: string; name: string }[];
  readonly projectOptions: readonly {
    id: string;
    name: string;
    clientId: string;
    clientName: string;
  }[];
}

export function MemberRow(props: MemberRowProps) {
  const [rolePending, startRoleTransition] = useTransition();
  const [removePending, startRemoveTransition] = useTransition();
  const [scopeModalOpen, setScopeModalOpen] = useState(false);

  // Optimistic role: filled the moment the user clicks OK, dropped once
  // `props.role` from revalidatePath catches up. Display always falls
  // back to the canonical server value when no submission is in flight.
  // We deliberately do NOT use React 19's <form action={...}> protocol
  // because it can race with revalidatePath and reset controlled fields
  // visually before the new prop lands.
  const [optimisticRole, setOptimisticRole] = useState<MemberRowProps['role'] | null>(null);
  const displayRole: MemberRowProps['role'] = optimisticRole ?? props.role;

  useEffect(() => {
    if (optimisticRole !== null && optimisticRole === props.role) {
      setOptimisticRole(null);
    }
  }, [props.role, optimisticRole]);

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

      {props.scope ? (
        <ScopeChip scope={props.scope} onClick={() => setScopeModalOpen(true)} />
      ) : null}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const picked = fd.get('role') as MemberRowProps['role'] | null;
          if (!picked) return;
          setOptimisticRole(picked);
          startRoleTransition(async () => {
            const result = await changeMemberRole({ status: 'idle' }, fd);
            if (result.status === 'error') {
              setOptimisticRole(null);
              notify({ tone: 'error', message: result.message });
            } else if (result.status === 'success') {
              notify({ tone: 'success', message: `Rôle mis à jour : ${picked}.` });
            }
          });
        }}
        className="flex items-center gap-2"
      >
        <input type="hidden" name={CSRF_FIELD_NAME} value={props.csrfToken} />
        <input type="hidden" name="membershipId" value={props.membershipId} />
        <label className="sr-only" htmlFor={`role-${props.membershipId}`}>
          Rôle de {props.displayName}
        </label>
        <select
          id={`role-${props.membershipId}`}
          name="role"
          value={displayRole}
          onChange={(e) => setOptimisticRole(e.target.value as MemberRowProps['role'])}
          disabled={rolePending}
          className="field-select w-32"
        >
          <option value="user">User</option>
          <option value="admin">Admin</option>
          <option value="viewer">Viewer</option>
        </select>
        <button
          type="submit"
          className="btn btn-ghost btn-sm"
          disabled={rolePending || displayRole === props.role}
          aria-busy={rolePending || undefined}
        >
          {rolePending ? '…' : 'OK'}
        </button>
      </form>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          startRemoveTransition(async () => {
            const result = await removeMember({ status: 'idle' }, fd);
            if (result.status === 'error') {
              notify({ tone: 'error', message: result.message });
            } else if (result.status === 'success') {
              notify({ tone: 'success', message: `${props.displayName} retiré du workspace.` });
            }
          });
        }}
      >
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

      {scopeModalOpen ? (
        <ScopeModal
          csrfToken={props.csrfToken}
          membershipId={props.membershipId}
          memberName={props.displayName}
          initialClientIds={props.scope?.kind === 'restricted' ? props.scope.clientIds : []}
          initialProjectIds={props.scope?.kind === 'restricted' ? props.scope.projectIds : []}
          clientOptions={props.clientOptions}
          projectOptions={props.projectOptions}
          onClose={() => setScopeModalOpen(false)}
        />
      ) : null}
    </li>
  );
}
