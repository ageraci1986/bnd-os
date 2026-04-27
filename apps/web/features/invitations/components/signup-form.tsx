'use client';
import { useActionState } from 'react';
import { CSRF_FIELD_NAME } from '@/lib/csrf';
import { acceptInvitation, type AcceptInvitationState } from '../actions/accept-invitation';

interface SignupFormProps {
  readonly csrfToken: string;
  readonly token: string;
  readonly email: string;
  readonly workspaceName: string;
  readonly inviterName: string;
}

const initialState: AcceptInvitationState = { status: 'idle' };

export function SignupForm(props: SignupFormProps) {
  const [state, formAction, isPending] = useActionState(acceptInvitation, initialState);
  const error = state.status === 'error' ? state.message : null;

  return (
    <form action={formAction} className="auth-form" noValidate>
      <p className="auth-kicker">Bienvenue chez {props.workspaceName}</p>
      <h1 className="auth-title">Créez votre compte</h1>
      <p className="auth-sub">
        {props.inviterName} vous a invité(e) à rejoindre l&apos;espace{' '}
        <strong>{props.workspaceName}</strong> sur NexusHub.
      </p>

      <input type="hidden" name={CSRF_FIELD_NAME} value={props.csrfToken} />
      <input type="hidden" name="token" value={props.token} />

      <div className="field">
        <label className="field-label" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          value={props.email}
          readOnly
          aria-readonly="true"
          className="field-input cursor-not-allowed opacity-60"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="field">
          <label className="field-label" htmlFor="firstName">
            Prénom
          </label>
          <input
            id="firstName"
            name="firstName"
            type="text"
            autoComplete="given-name"
            required
            maxLength={60}
            className="field-input"
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="lastName">
            Nom
          </label>
          <input
            id="lastName"
            name="lastName"
            type="text"
            autoComplete="family-name"
            required
            maxLength={60}
            className="field-input"
          />
        </div>
      </div>

      <div className="field">
        <label className="field-label" htmlFor="password">
          Mot de passe (minimum 12 caractères)
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          maxLength={256}
          className="field-input"
        />
      </div>

      <div className="field">
        <label className="field-label" htmlFor="passwordConfirm">
          Confirmer le mot de passe
        </label>
        <input
          id="passwordConfirm"
          name="passwordConfirm"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          maxLength={256}
          className="field-input"
        />
      </div>

      <label className="mb-4 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="acceptTerms"
          required
          className="h-4 w-4 rounded border-[color:var(--color-border-light)]"
        />
        <span>J&apos;accepte les conditions d&apos;utilisation.</span>
      </label>

      {error ? (
        <p role="alert" className="mb-4 text-sm font-medium text-[color:var(--color-danger)]">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        className="btn btn-primary btn-lg w-full"
        disabled={isPending}
        aria-busy={isPending || undefined}
      >
        {isPending ? 'Création…' : 'Créer mon compte'}
      </button>
    </form>
  );
}
