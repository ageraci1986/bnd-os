'use client';
import { useActionState, useEffect, useState } from 'react';
import { CSRF_FIELD_NAME } from '@/lib/csrf/field';
import { setUserScope, type SetScopeState } from '../actions/set-user-scope';

interface ClientOption {
  readonly id: string;
  readonly name: string;
}
interface ProjectOption {
  readonly id: string;
  readonly name: string;
  readonly clientName: string;
}

export interface ScopeModalProps {
  readonly csrfToken: string;
  readonly membershipId: string;
  readonly memberName: string;
  readonly initialClientIds: readonly string[];
  readonly initialProjectIds: readonly string[];
  readonly clientOptions: readonly ClientOption[];
  readonly projectOptions: readonly ProjectOption[];
  readonly onClose: () => void;
}

const idle: SetScopeState = { status: 'idle' };

export function ScopeModal({
  csrfToken,
  membershipId,
  memberName,
  initialClientIds,
  initialProjectIds,
  clientOptions,
  projectOptions,
  onClose,
}: ScopeModalProps) {
  const [state, action, pending] = useActionState(setUserScope, idle);
  const [clientIds, setClientIds] = useState<readonly string[]>(initialClientIds);
  const [projectIds, setProjectIds] = useState<readonly string[]>(initialProjectIds);

  useEffect(() => {
    if (state.status === 'success') onClose();
  }, [state.status, onClose]);

  const toggleClient = (id: string) =>
    setClientIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const toggleProject = (id: string) =>
    setProjectIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="scope-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="w-full max-w-2xl rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-6 shadow-2xl">
        <h2 id="scope-modal-title" className="text-xl font-extrabold tracking-tight">
          Scope de {memberName}
        </h2>
        <p className="mt-1 text-sm text-[color:var(--color-text-muted)]">
          Coche les clients ou projets auxquels ce user doit avoir accès. Aucune coche = accès à
          tout le workspace.
        </p>

        <form action={action} className="mt-4">
          <input type="hidden" name={CSRF_FIELD_NAME} value={csrfToken} />
          <input type="hidden" name="membershipId" value={membershipId} />
          <input type="hidden" name="clientIds" value={clientIds.join(',')} />
          <input type="hidden" name="projectIds" value={projectIds.join(',')} />

          <div className="grid grid-cols-2 gap-4">
            <section>
              <h3 className="mb-2 text-[11px] font-extrabold uppercase tracking-[1px] text-[color:var(--color-text-muted)]">
                Clients ({clientIds.length})
              </h3>
              <ul className="max-h-72 overflow-y-auto rounded-xl border border-[color:var(--color-border-light)] p-2">
                {clientOptions.map((c) => (
                  <li key={c.id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-[color:var(--color-bg-muted)]">
                      <input
                        type="checkbox"
                        checked={clientIds.includes(c.id)}
                        onChange={() => toggleClient(c.id)}
                        className="accent-[color:var(--color-accent-primary)]"
                      />
                      {c.name}
                    </label>
                  </li>
                ))}
              </ul>
            </section>

            <section>
              <h3 className="mb-2 text-[11px] font-extrabold uppercase tracking-[1px] text-[color:var(--color-text-muted)]">
                Projets spécifiques ({projectIds.length})
              </h3>
              <ul className="max-h-72 overflow-y-auto rounded-xl border border-[color:var(--color-border-light)] p-2">
                {projectOptions.map((p) => (
                  <li key={p.id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-[color:var(--color-bg-muted)]">
                      <input
                        type="checkbox"
                        checked={projectIds.includes(p.id)}
                        onChange={() => toggleProject(p.id)}
                        className="accent-[color:var(--color-accent-primary)]"
                      />
                      <span className="flex flex-col">
                        <span>{p.name}</span>
                        <span className="text-[10px] text-[color:var(--color-text-muted)]">
                          {p.clientName}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          {state.status === 'error' ? (
            <p
              role="alert"
              className="mt-3 rounded-md border border-[color:var(--color-danger)] bg-[color:var(--color-danger-bg)] px-3 py-2 text-sm font-medium text-[color:var(--color-danger)]"
            >
              {state.message}
            </p>
          ) : null}

          <div className="mt-5 flex items-center justify-between">
            <button
              type="submit"
              name="clearAll"
              value="1"
              className="btn btn-ghost btn-sm"
              disabled={pending}
            >
              Réinitialiser (tout le workspace)
            </button>
            <div className="flex items-center gap-2">
              <button type="button" onClick={onClose} className="btn btn-ghost btn-sm">
                Annuler
              </button>
              <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>
                {pending ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
