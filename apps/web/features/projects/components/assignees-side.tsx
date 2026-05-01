'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Avatar } from '@nexushub/ui';
import { RACI_VALUES, raciLabelFr, raciTagVariant, type Raci } from '@nexushub/domain';
import {
  addCardAssignee,
  removeCardAssignee,
  updateCardAssigneeRaci,
} from '../actions/card-assignees';

export interface WorkspaceMemberOption {
  readonly userId: string;
  readonly displayName: string;
  readonly initials: string;
  readonly email: string;
}

export interface CardAssignment {
  readonly userId: string;
  readonly displayName: string;
  readonly initials: string;
  readonly raci: Raci;
}

export interface AssigneesSideProps {
  readonly cardId: string;
  readonly assignments: readonly CardAssignment[];
  readonly members: readonly WorkspaceMemberOption[];
}

export function AssigneesSide({ cardId, assignments, members }: AssigneesSideProps) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const assignedIds = new Set(assignments.map((a) => a.userId));
  const availableMembers = members.filter((m) => !assignedIds.has(m.userId));

  const handleAdd = (userId: string) => {
    setError(null);
    startTransition(async () => {
      const res = await addCardAssignee({ cardId, userId, raci: 'responsible' });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setAdding(false);
      router.refresh();
    });
  };

  const handleRaciChange = (userId: string, raci: Raci) => {
    setError(null);
    startTransition(async () => {
      const res = await updateCardAssigneeRaci({ cardId, userId, raci });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      router.refresh();
    });
  };

  const handleRemove = (userId: string) => {
    setError(null);
    startTransition(async () => {
      const res = await removeCardAssignee({ cardId, userId });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div>
      {assignments.length === 0 ? (
        <p className="text-xs text-[color:var(--color-text-muted)]">Aucun assigné.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {assignments.map((a) => (
            <li
              key={a.userId}
              className="flex items-center gap-2 rounded-lg border border-[color:var(--color-border-soft)] bg-[color:var(--color-bg-card)] px-2 py-1.5"
            >
              <Avatar initials={a.initials} variant="gradient" size="sm" />
              <span className="flex-1 truncate text-xs font-bold">{a.displayName}</span>
              <RaciSelect
                value={a.raci}
                disabled={pending}
                onChange={(next) => handleRaciChange(a.userId, next)}
              />
              <button
                type="button"
                aria-label="Retirer"
                onClick={() => handleRemove(a.userId)}
                className="text-xs text-[color:var(--color-text-muted)] hover:text-[color:var(--color-danger)]"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <div className="mt-2">
          {availableMembers.length === 0 ? (
            <p className="text-xs text-[color:var(--color-text-muted)]">
              Tous les membres sont déjà assignés.
            </p>
          ) : (
            <ul className="flex flex-col gap-1 rounded-lg border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-1">
              {availableMembers.map((m) => (
                <li key={m.userId}>
                  <button
                    type="button"
                    onClick={() => handleAdd(m.userId)}
                    disabled={pending}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-[color:var(--color-bg-hover)]"
                  >
                    <Avatar initials={m.initials} variant="gradient" size="sm" />
                    <span className="flex-1 truncate font-bold">{m.displayName}</span>
                    <span className="text-[10px] text-[color:var(--color-text-muted)]">
                      {m.email}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={() => {
              setAdding(false);
              setError(null);
            }}
            className="mt-1 text-xs text-[color:var(--color-text-muted)] underline"
          >
            Annuler
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="next-col mt-2"
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
            textDecoration: 'underline',
          }}
        >
          + Assigner un membre
        </button>
      )}

      {error ? (
        <p role="alert" className="mt-2 text-xs text-[color:var(--color-danger)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function RaciSelect({
  value,
  disabled,
  onChange,
}: {
  value: Raci;
  disabled: boolean;
  onChange: (next: Raci) => void;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as Raci)}
      title="Rôle RACI"
      className="rounded-full border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.5px]"
      style={{ outline: 'none' }}
    >
      {RACI_VALUES.map((r) => (
        <option key={r} value={r}>
          {raciLabelFr(r)} · {raciFullLabelFr(r)}
        </option>
      ))}
    </select>
  );
}

function raciFullLabelFr(r: Raci): string {
  switch (r) {
    case 'responsible':
      return 'Responsable';
    case 'approver':
      return 'Approbateur';
    case 'consulted':
      return 'Consulté';
    case 'informed':
      return 'Informé';
  }
}

/** Compact badge used inside the kanban card preview. */
export function AssigneeBadgeRow({ assignments }: { assignments: readonly CardAssignment[] }) {
  if (assignments.length === 0) return null;
  return (
    <div className="kcard-assignees flex items-center gap-1">
      {assignments.slice(0, 3).map((a) => (
        <span
          key={a.userId}
          title={`${a.displayName} · ${raciFullLabelFr(a.raci)}`}
          className="relative"
        >
          <Avatar initials={a.initials} variant="gradient" size="sm" />
          <span
            aria-hidden="true"
            className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[8px] font-bold uppercase"
            style={{
              background:
                raciTagVariant(a.raci) === 'info'
                  ? 'var(--color-info)'
                  : raciTagVariant(a.raci) === 'warning'
                    ? 'var(--color-warning)'
                    : raciTagVariant(a.raci) === 'success'
                      ? 'var(--color-success)'
                      : 'var(--color-text-muted)',
              color: '#fff',
            }}
          >
            {raciLabelFr(a.raci)}
          </span>
        </span>
      ))}
      {assignments.length > 3 ? (
        <span className="text-[10px] font-bold text-[color:var(--color-text-muted)]">
          +{assignments.length - 3}
        </span>
      ) : null}
    </div>
  );
}
