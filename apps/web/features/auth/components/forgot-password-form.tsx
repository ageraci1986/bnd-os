'use client';
import { useActionState } from 'react';
import Link from 'next/link';
import { CSRF_FIELD_NAME } from '@/lib/csrf';
import {
  forgotPassword,
  GENERIC_OK_MESSAGE,
  type ForgotPasswordState,
} from '../actions/forgot-password';

interface ForgotFormProps {
  readonly csrfToken: string;
}

const initialState: ForgotPasswordState = { status: 'idle' };

export function ForgotPasswordForm({ csrfToken }: ForgotFormProps) {
  const [state, formAction, isPending] = useActionState(forgotPassword, initialState);

  return (
    <form action={formAction} className="auth-form" noValidate>
      <p className="auth-kicker">NexusHub</p>
      <h1 className="auth-title">Mot de passe oublié</h1>
      <p className="auth-sub">
        Saisissez votre adresse e-mail. Si un compte existe, vous recevrez un lien de
        réinitialisation.
      </p>

      <input type="hidden" name={CSRF_FIELD_NAME} value={csrfToken} />

      {state.status === 'submitted' ? (
        <div
          role="status"
          className="mb-4 rounded-md border border-[color:var(--color-success)] bg-[color:var(--color-success-bg)] px-3 py-2 text-sm font-medium text-[color:var(--color-success)]"
        >
          {GENERIC_OK_MESSAGE}
        </div>
      ) : null}

      {state.status === 'error' ? (
        <p role="alert" className="mb-4 text-sm font-medium text-[color:var(--color-danger)]">
          {state.message}
        </p>
      ) : null}

      <div className="field">
        <label className="field-label" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="field-input"
          placeholder="vous@exemple.com"
        />
      </div>

      <button
        type="submit"
        className="btn btn-primary btn-lg w-full"
        disabled={isPending}
        aria-busy={isPending || undefined}
      >
        {isPending ? 'Envoi…' : 'Envoyer le lien'}
      </button>

      <p className="auth-foot">
        <Link href="/login" className="auth-link">
          ← Retour à la connexion
        </Link>
      </p>
    </form>
  );
}
