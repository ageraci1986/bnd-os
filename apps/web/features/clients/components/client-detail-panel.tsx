import type { ClientDetail } from '../lib/queries';
import { ClientMono } from './client-mono';
import { ContactRow } from './contact-row';
import { ContactForm } from './contact-form';
import { ClientForm } from './client-form';
import { DeleteClientButton } from './delete-client-button';

export interface ClientDetailPanelProps {
  readonly csrfToken: string;
  readonly client: ClientDetail;
  /** When true, render the edit form in place of the read view. */
  readonly editing: boolean;
}

export function ClientDetailPanel({ csrfToken, client, editing }: ClientDetailPanelProps) {
  return (
    <div className="rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-6 shadow-[var(--shadow-card)]">
      <header className="mb-5 flex items-center gap-4">
        <ClientMono initials={client.initials} colorToken={client.colorToken} size={64} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-2xl font-extrabold tracking-tight">{client.name}</h2>
          <p className="mt-1 text-xs text-[color:var(--color-text-muted)]">
            {client.activeProjectsCount === 0
              ? 'Aucun projet actif'
              : client.activeProjectsCount === 1
                ? '1 projet actif'
                : `${client.activeProjectsCount} projets actifs`}
            {client.domains.length > 0 ? ` · ${client.domains.join(', ')}` : ''}
          </p>
        </div>
        {!editing ? (
          <a
            href={`/clients?selected=${encodeURIComponent(client.slug)}&edit=1`}
            className="btn btn-ghost btn-sm"
          >
            Modifier
          </a>
        ) : null}
      </header>

      {editing ? (
        <section aria-label="Modifier le client" className="mb-6">
          <ClientForm
            mode="edit"
            csrfToken={csrfToken}
            client={{
              id: client.id,
              name: client.name,
              colorToken: client.colorToken,
              initials: client.initials,
              domains: client.domains,
              notes: client.notes,
            }}
          />
        </section>
      ) : client.notes ? (
        <p className="mb-6 whitespace-pre-line text-sm text-[color:var(--color-text-muted)]">
          {client.notes}
        </p>
      ) : null}

      <section aria-labelledby="contacts-heading" className="mb-6">
        <header className="mb-2 flex items-baseline justify-between">
          <h3
            id="contacts-heading"
            className="text-sm font-extrabold uppercase tracking-[1px] text-[color:var(--color-text-muted)]"
          >
            Contacts ({client.contacts.length})
          </h3>
        </header>
        {client.contacts.length === 0 ? (
          <p className="py-3 text-sm text-[color:var(--color-text-muted)]">
            Aucun contact pour ce client. Utilisez le formulaire ci-dessous pour en ajouter.
          </p>
        ) : (
          <ul className="divide-y divide-[color:var(--color-border-soft)]">
            {client.contacts.map((c) => (
              <ContactRow key={c.id} csrfToken={csrfToken} contact={c} />
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Ajouter un contact" className="mb-6">
        <ContactForm mode="create" csrfToken={csrfToken} clientId={client.id} />
      </section>

      {!editing ? (
        <footer className="border-t border-[color:var(--color-border-soft)] pt-4">
          <DeleteClientButton csrfToken={csrfToken} clientId={client.id} clientName={client.name} />
        </footer>
      ) : null}
    </div>
  );
}
