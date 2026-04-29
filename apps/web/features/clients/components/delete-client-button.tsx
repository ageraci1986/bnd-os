'use client';
import { useActionState } from 'react';
import { CSRF_FIELD_NAME } from '@/lib/csrf/field';
import { deleteClient, type DeleteClientState } from '../actions/delete-client';

const INITIAL: DeleteClientState = { status: 'idle' };

export interface DeleteClientButtonProps {
  readonly csrfToken: string;
  readonly clientId: string;
  readonly clientName: string;
}

export function DeleteClientButton({ csrfToken, clientId, clientName }: DeleteClientButtonProps) {
  const [state, action, pending] = useActionState(deleteClient, INITIAL);

  return (
    <div>
      <form
        action={action}
        onSubmit={(e) => {
          if (
            !window.confirm(
              `Supprimer définitivement le client « ${clientName} » ? Les contacts seront aussi supprimés.`,
            )
          ) {
            e.preventDefault();
          }
        }}
      >
        <input type="hidden" name={CSRF_FIELD_NAME} value={csrfToken} />
        <input type="hidden" name="clientId" value={clientId} />
        <button
          type="submit"
          disabled={pending}
          className="text-sm font-semibold text-[color:var(--color-danger)] underline disabled:opacity-50"
        >
          {pending ? 'Suppression…' : 'Supprimer ce client'}
        </button>
      </form>
      {state.status === 'error' ? (
        <p role="alert" className="mt-2 text-sm text-[color:var(--color-danger)]">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
