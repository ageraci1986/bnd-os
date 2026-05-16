'use client';
import { useActionState, useEffect, useRef, useState } from 'react';
import { CSRF_FIELD_NAME } from '@/lib/csrf/field';
import {
  createInvitation,
  type CreateInvitationState,
} from '@/features/invitations/actions/create-invitation';

interface Props {
  readonly csrfToken: string;
  readonly clientOptions: readonly { id: string; name: string }[];
  readonly projectOptions: readonly {
    id: string;
    name: string;
    clientId: string;
    clientName: string;
  }[];
}

const initialState: CreateInvitationState = { status: 'idle' };

export function InvitationForm({ csrfToken, clientOptions, projectOptions }: Props) {
  const [state, formAction, isPending] = useActionState(createInvitation, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  const [role, setRole] = useState<'admin' | 'user' | 'viewer'>('user');
  const [clientIds, setClientIds] = useState<readonly string[]>([]);
  const [projectIds, setProjectIds] = useState<readonly string[]>([]);

  const clientIdsSet = new Set(clientIds);
  const inheritedProjectIds = new Set(
    projectOptions.filter((p) => clientIdsSet.has(p.clientId)).map((p) => p.id),
  );

  const toggleClient = (id: string) =>
    setClientIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const toggleProject = (id: string) => {
    const proj = projectOptions.find((p) => p.id === id);
    if (!proj) return;
    if (clientIdsSet.has(proj.clientId)) {
      // Drill-down: replace the client grant with explicit sibling rows.
      const siblings = projectOptions
        .filter((p) => p.clientId === proj.clientId && p.id !== id)
        .map((p) => p.id);
      setClientIds((prev) => prev.filter((c) => c !== proj.clientId));
      setProjectIds((prev) => {
        const next = new Set(prev);
        for (const s of siblings) next.add(s);
        next.delete(id);
        return [...next];
      });
      return;
    }
    setProjectIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  // Reset the form on successful invitation so the next one is easy to send.
  useEffect(() => {
    if (state.status === 'success' && formRef.current) {
      formRef.current.reset();
      setRole('user');
      setClientIds([]);
      setProjectIds([]);
    }
  }, [state.status]);

  return (
    <form
      ref={formRef}
      action={formAction}
      noValidate
      className="rounded-2xl border border-dashed border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-6"
    >
      <input type="hidden" name={CSRF_FIELD_NAME} value={csrfToken} />

      <div className="mb-3 flex items-center gap-2">
        <span
          className="grid h-9 w-9 place-items-center rounded-full text-sm font-extrabold text-white"
          style={{ background: 'linear-gradient(135deg,#8B2BE2,#FF2A6D)' }}
          aria-hidden="true"
        >
          +
        </span>
        <h2 className="text-lg font-extrabold tracking-tight">Inviter une personne</h2>
      </div>

      {state.status === 'success' ? (
        <p
          role="status"
          className="mb-4 rounded-md border border-[color:var(--color-success)] bg-[color:var(--color-success-bg)] px-3 py-2 text-sm font-medium text-[color:var(--color-success)]"
        >
          Invitation envoyée à <strong>{state.email}</strong>. Le lien est valable 72 heures.
        </p>
      ) : null}

      {state.status === 'error' ? (
        <p
          role="alert"
          className="mb-4 rounded-md border border-[color:var(--color-danger)] bg-[color:var(--color-danger-bg)] px-3 py-2 text-sm font-medium text-[color:var(--color-danger)]"
        >
          {state.message}
        </p>
      ) : null}

      <div className="grid gap-3 md:grid-cols-[2fr_1fr_auto]">
        <div>
          <label className="field-label" htmlFor="invite-email">
            Adresse e-mail
          </label>
          <input
            id="invite-email"
            name="email"
            type="email"
            required
            maxLength={254}
            placeholder="prenom.nom@exemple.com"
            className="field-input"
          />
        </div>
        <div>
          <label className="field-label" htmlFor="invite-role">
            Rôle
          </label>
          <select
            id="invite-role"
            name="role"
            value={role}
            onChange={(e) => setRole(e.target.value as 'admin' | 'user' | 'viewer')}
            className="field-select"
          >
            <option value="user">User</option>
            <option value="admin">Admin</option>
            <option value="viewer">Viewer</option>
          </select>
        </div>
        <div className="flex items-end">
          <button
            type="submit"
            className="btn btn-primary w-full md:w-auto"
            disabled={isPending}
            aria-busy={isPending || undefined}
          >
            {isPending ? 'Envoi…' : 'Inviter'}
          </button>
        </div>
      </div>

      {role !== 'admin' ? (
        <div className="mt-4 rounded-xl border border-[color:var(--color-border-light)] p-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[11px] font-extrabold uppercase tracking-[1px] text-[color:var(--color-text-muted)]">
              Scope {role === 'viewer' ? '· requis' : '· optionnel'}
            </h3>
            <span className="text-[10px] text-[color:var(--color-text-muted)]">
              Aucune coche = accès à tout le workspace
            </span>
          </div>
          <input type="hidden" name="scopeClientIds" value={clientIds.join(',')} />
          <input type="hidden" name="scopeProjectIds" value={projectIds.join(',')} />
          <div className="grid grid-cols-2 gap-3">
            <section>
              <h4 className="mb-1 text-[10px] font-extrabold uppercase text-[color:var(--color-text-muted)]">
                Clients ({clientIds.length})
              </h4>
              <ul className="max-h-40 overflow-y-auto rounded-md border border-[color:var(--color-border-light)] p-1.5">
                {clientOptions.map((c) => (
                  <li key={c.id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-[color:var(--color-bg-muted)]">
                      <input
                        type="checkbox"
                        checked={clientIds.includes(c.id)}
                        onChange={() => toggleClient(c.id)}
                      />
                      {c.name}
                    </label>
                  </li>
                ))}
              </ul>
            </section>
            <section>
              <h4 className="mb-1 text-[10px] font-extrabold uppercase text-[color:var(--color-text-muted)]">
                Projets ({projectIds.length + inheritedProjectIds.size})
              </h4>
              <ul className="max-h-40 overflow-y-auto rounded-md border border-[color:var(--color-border-light)] p-1.5">
                {projectOptions.map((p) => {
                  const inherited = inheritedProjectIds.has(p.id);
                  const checked = inherited || projectIds.includes(p.id);
                  return (
                    <li key={p.id}>
                      <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-[color:var(--color-bg-muted)]">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleProject(p.id)}
                        />
                        <span className="flex flex-col">
                          <span>{p.name}</span>
                          <span className="text-[9px] text-[color:var(--color-text-muted)]">
                            {p.clientName}
                            {inherited ? ' · inclus via le client' : null}
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </section>
          </div>
        </div>
      ) : null}

      <p className="mt-3 text-xs text-[color:var(--color-text-muted)]">
        L&apos;invitation envoie un lien à usage unique valide 72h. La personne définira son mot de
        passe en arrivant sur NexusHub.
        {role === 'viewer'
          ? ' Le scope choisi sera matérialisé automatiquement à l’acceptation.'
          : role === 'user'
            ? ' Pour modifier son scope après acceptation, ouvre sa fiche dans la liste.'
            : ''}
      </p>
    </form>
  );
}
