'use client';
import { useState, useTransition } from 'react';
import { Avatar } from '@nexushub/ui';
import { RACI_VALUES, raciLabelFr, type Raci } from '@nexushub/domain';
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

const RACI_FULL_FR: Record<Raci, string> = {
  responsible: 'Responsable',
  approver: 'Approbateur',
  consulted: 'Consulté',
  informed: 'Informé',
};

const RACI_COLOR: Record<Raci, string> = {
  responsible: 'var(--color-info)',
  approver: 'var(--color-warning)',
  consulted: 'var(--color-success)',
  informed: 'var(--color-text-muted)',
};

export function AssigneesSide({ cardId, assignments: initial, members }: AssigneesSideProps) {
  // Local optimistic copy so role/add/remove feel instant.
  const [list, setList] = useState<readonly CardAssignment[]>(initial);
  const [adding, setAdding] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const assignedIds = new Set(list.map((a) => a.userId));
  const availableMembers = members.filter((m) => !assignedIds.has(m.userId));

  const handleAdd = (member: WorkspaceMemberOption) => {
    setError(null);
    const optimistic: CardAssignment = {
      userId: member.userId,
      displayName: member.displayName,
      initials: member.initials,
      raci: 'responsible',
    };
    setList((prev) => [...prev, optimistic]);
    setAdding(false);
    startTransition(async () => {
      const res = await addCardAssignee({
        cardId,
        userId: member.userId,
        raci: 'responsible',
      });
      if (!res.ok) {
        // Roll back optimistic add and surface the message (e.g. "one
        // Responsible per card" partial-unique).
        setList((prev) => prev.filter((a) => a.userId !== member.userId));
        setError(res.message);
      }
    });
  };

  const handleRaciChange = (userId: string, raci: Raci) => {
    setError(null);
    const previous = list.find((a) => a.userId === userId)?.raci;
    setList((prev) => prev.map((a) => (a.userId === userId ? { ...a, raci } : a)));
    startTransition(async () => {
      const res = await updateCardAssigneeRaci({ cardId, userId, raci });
      if (!res.ok && previous) {
        setList((prev) => prev.map((a) => (a.userId === userId ? { ...a, raci: previous } : a)));
        setError(res.message);
      }
    });
  };

  const handleRemove = (userId: string) => {
    setError(null);
    const removed = list.find((a) => a.userId === userId);
    setList((prev) => prev.filter((a) => a.userId !== userId));
    startTransition(async () => {
      const res = await removeCardAssignee({ cardId, userId });
      if (!res.ok && removed) {
        setList((prev) => [...prev, removed]);
        setError(res.message);
      }
    });
  };

  return (
    <div>
      {list.length === 0 ? (
        <p className="text-xs text-[color:var(--color-text-muted)]">Aucun assigné.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {list.map((a) => (
            <li key={a.userId} className="assignee-row">
              <Avatar initials={a.initials} variant="gradient" size="sm" />
              <span className="assignee-name">{a.displayName}</span>
              <RaciSwitch
                value={a.raci}
                disabled={pending}
                onChange={(next) => handleRaciChange(a.userId, next)}
              />
              <button
                type="button"
                aria-label={`Retirer ${a.displayName}`}
                onClick={() => handleRemove(a.userId)}
                className="assignee-remove"
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
            <ul className="assignee-picker">
              {availableMembers.map((m) => (
                <li key={m.userId}>
                  <button
                    type="button"
                    onClick={() => handleAdd(m)}
                    disabled={pending}
                    className="assignee-picker-row"
                  >
                    <Avatar initials={m.initials} variant="gradient" size="sm" />
                    <span className="flex-1 truncate">{m.displayName}</span>
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
            className="assignee-cancel"
          >
            Annuler
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="assignee-add-link">
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

function RaciSwitch({
  value,
  disabled,
  onChange,
}: {
  value: Raci;
  disabled: boolean;
  onChange: (next: Raci) => void;
}) {
  return (
    <div className="raci-switch" role="radiogroup" aria-label="Rôle RACI">
      {RACI_VALUES.map((r) => {
        const active = r === value;
        return (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(r)}
            title={RACI_FULL_FR[r]}
            className={['raci-pill', active && 'active'].filter(Boolean).join(' ')}
            style={active ? { background: RACI_COLOR[r], color: '#fff' } : undefined}
          >
            {raciLabelFr(r)}
          </button>
        );
      })}
    </div>
  );
}
