'use client';
import { useActionState, useState } from 'react';
import { Tag } from '@nexushub/ui';
import { type Raci, raciLabelFr, raciTagVariant } from '@nexushub/domain';
import { CSRF_FIELD_NAME } from '@/lib/csrf/field';
import { deleteContact, type DeleteContactState } from '../actions/delete-contact';
import { ContactForm } from './contact-form';

const DELETE_INITIAL: DeleteContactState = { status: 'idle' };

export interface ContactRowProps {
  readonly csrfToken: string;
  readonly contact: {
    readonly id: string;
    readonly firstName: string;
    readonly lastName: string;
    readonly jobTitle: string | null;
    readonly email: string | null;
    readonly phone: string | null;
    readonly raci: Raci | null;
    readonly notes: string | null;
  };
}

export function ContactRow({ csrfToken, contact }: ContactRowProps) {
  const [editing, setEditing] = useState(false);
  const [delState, delAction, delPending] = useActionState(deleteContact, DELETE_INITIAL);

  if (editing) {
    return (
      <li className="py-3">
        <ContactForm
          mode="edit"
          csrfToken={csrfToken}
          contact={contact}
          onClose={() => setEditing(false)}
        />
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="mt-2 text-xs text-[color:var(--color-text-muted)] underline"
        >
          Annuler
        </button>
      </li>
    );
  }

  return (
    <li className="grid grid-cols-[1fr_auto_auto] items-center gap-3 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-bold">
          {contact.firstName} {contact.lastName}
          {contact.jobTitle ? (
            <span className="ml-2 text-xs font-medium text-[color:var(--color-text-muted)]">
              · {contact.jobTitle}
            </span>
          ) : null}
        </p>
        <p className="truncate text-xs text-[color:var(--color-text-muted)]">
          {contact.email ?? '—'}
          {contact.phone ? ` · ${contact.phone}` : ''}
        </p>
      </div>

      <div>
        {contact.raci ? (
          <Tag variant={raciTagVariant(contact.raci)} size="sm">
            {raciLabelFr(contact.raci)}
          </Tag>
        ) : (
          <span className="text-xs text-[color:var(--color-text-muted)]">—</span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-xs text-[color:var(--color-accent-primary)] underline"
        >
          Modifier
        </button>
        <form action={delAction}>
          <input type="hidden" name={CSRF_FIELD_NAME} value={csrfToken} />
          <input type="hidden" name="contactId" value={contact.id} />
          <button
            type="submit"
            disabled={delPending}
            className="text-xs text-[color:var(--color-danger)] underline disabled:opacity-50"
            aria-label={`Supprimer ${contact.firstName} ${contact.lastName}`}
          >
            {delPending ? '…' : 'Supprimer'}
          </button>
        </form>
      </div>

      {delState.status === 'error' ? (
        <p role="alert" className="col-span-3 text-xs text-[color:var(--color-danger)]">
          {delState.message}
        </p>
      ) : null}
    </li>
  );
}
