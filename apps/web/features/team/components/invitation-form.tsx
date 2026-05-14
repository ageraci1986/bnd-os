'use client';
import { useActionState, useEffect, useRef } from 'react';
import { CSRF_FIELD_NAME } from '@/lib/csrf/field';
import {
  createInvitation,
  type CreateInvitationState,
} from '@/features/invitations/actions/create-invitation';

interface Props {
  readonly csrfToken: string;
}

const initialState: CreateInvitationState = { status: 'idle' };

export function InvitationForm({ csrfToken }: Props) {
  const [state, formAction, isPending] = useActionState(createInvitation, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  // Reset the form on successful invitation so the next one is easy to send.
  useEffect(() => {
    if (state.status === 'success' && formRef.current) {
      formRef.current.reset();
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
          <select id="invite-role" name="role" defaultValue="user" className="field-select">
            <option value="user">User</option>
            <option value="admin">Admin</option>
            <option value="viewer" disabled title="Disponible bientôt (Phase B)">
              Viewer (bientôt)
            </option>
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

      <p className="mt-3 text-xs text-[color:var(--color-text-muted)]">
        L&apos;invitation envoie un lien à usage unique valide 72h. La personne définira son mot de
        passe en arrivant sur NexusHub.
      </p>
    </form>
  );
}
