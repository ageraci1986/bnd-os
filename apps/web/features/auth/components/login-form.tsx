'use client';
import { useActionState } from 'react';
import Link from 'next/link';
import { CSRF_FIELD_NAME } from '@/lib/csrf';
import { signIn, type SignInState } from '../actions/sign-in';

interface LoginFormProps {
  readonly csrfToken: string;
  readonly nextUrl?: string;
  readonly resetSuccess?: boolean;
}

const initialState: SignInState = { status: 'idle' };

export function LoginForm({ csrfToken, nextUrl, resetSuccess }: LoginFormProps) {
  const [state, formAction, isPending] = useActionState(signIn, initialState);
  const errorMessage = state.status === 'error' ? state.message : null;

  return (
    <form action={formAction} className="auth-form" noValidate>
      <p className="auth-kicker">NexusHub</p>
      <h1 className="auth-title">Bon retour parmi nous</h1>
      <p className="auth-sub">
        Connectez-vous pour retrouver vos clients, projets et communications.
      </p>

      <input type="hidden" name={CSRF_FIELD_NAME} value={csrfToken} />
      {nextUrl ? <input type="hidden" name="next" value={nextUrl} /> : null}

      {resetSuccess ? (
        <div
          role="status"
          className="mb-4 rounded-md border border-[color:var(--color-success)] bg-[color:var(--color-success-bg)] px-3 py-2 text-sm font-medium text-[color:var(--color-success)]"
        >
          Mot de passe réinitialisé. Connectez-vous avec votre nouveau mot de passe.
        </div>
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
          aria-invalid={errorMessage ? true : undefined}
          aria-describedby={errorMessage ? 'login-error' : undefined}
        />
      </div>

      <div className="field">
        <label className="field-label" htmlFor="password">
          Mot de passe
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="field-input"
          aria-invalid={errorMessage ? true : undefined}
          aria-describedby={errorMessage ? 'login-error' : undefined}
        />
      </div>

      {errorMessage ? (
        <p
          id="login-error"
          role="alert"
          className="-mt-2 mb-4 text-sm font-medium text-[color:var(--color-danger)]"
        >
          {errorMessage}
        </p>
      ) : null}

      <button
        type="submit"
        className="btn btn-primary btn-lg w-full"
        disabled={isPending}
        aria-busy={isPending || undefined}
      >
        {isPending ? 'Connexion…' : 'Se connecter'}
      </button>

      <div className="mt-4 text-center">
        <Link href="/forgot-password" className="auth-link">
          Mot de passe oublié ?
        </Link>
      </div>

      <p className="auth-foot">Pas encore de compte ? NexusHub fonctionne sur invitation.</p>
    </form>
  );
}
