'use client';
import { useActionState, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CSRF_FIELD_NAME } from '@/lib/csrf/field';
import { createClient, type CreateClientState } from '../actions/create-client';
import { updateClient, type UpdateClientState } from '../actions/update-client';

const CREATE_INITIAL: CreateClientState = { status: 'idle' };
const UPDATE_INITIAL: UpdateClientState = { status: 'idle' };

const COLOR_TOKENS = [
  { token: 'c-acme', label: 'Rose' },
  { token: 'c-tech', label: 'Bleu' },
  { token: 'c-nova', label: 'Vert' },
  { token: 'c-lumen', label: 'Ambre' },
  { token: 'c-orbit', label: 'Violet' },
] as const;

interface CreateProps {
  readonly mode: 'create';
  readonly csrfToken: string;
}
interface EditProps {
  readonly mode: 'edit';
  readonly csrfToken: string;
  readonly client: {
    readonly id: string;
    readonly name: string;
    readonly colorToken: string;
    readonly initials: string;
    readonly domains: readonly string[];
    readonly notes: string | null;
  };
}
type Props = CreateProps | EditProps;

export function ClientForm(props: Props) {
  const router = useRouter();

  if (props.mode === 'create') {
    return <CreateForm csrfToken={props.csrfToken} router={router} />;
  }
  return <EditForm csrfToken={props.csrfToken} client={props.client} router={router} />;
}

function CreateForm({
  csrfToken,
  router,
}: {
  csrfToken: string;
  router: ReturnType<typeof useRouter>;
}) {
  const [state, action, pending] = useActionState(createClient, CREATE_INITIAL);
  const [color, setColor] = useState<string>('c-acme');

  if (state.status === 'success') {
    router.replace(`/clients?selected=${encodeURIComponent(state.slug)}`);
    router.refresh();
  }

  return (
    <form
      action={action}
      noValidate
      className="rounded-2xl border border-dashed border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-5"
    >
      <input type="hidden" name={CSRF_FIELD_NAME} value={csrfToken} />
      <h2 className="mb-3 text-lg font-extrabold tracking-tight">Nouveau client</h2>

      {state.status === 'error' ? <ErrorBanner message={state.message} /> : null}

      <Fields color={color} setColor={setColor} />

      <button
        type="submit"
        className="btn btn-primary mt-4 w-full"
        disabled={pending}
        aria-busy={pending || undefined}
      >
        {pending ? 'Création…' : 'Créer le client'}
      </button>
    </form>
  );
}

function EditForm({
  csrfToken,
  client,
  router,
}: {
  csrfToken: string;
  client: EditProps['client'];
  router: ReturnType<typeof useRouter>;
}) {
  const [state, action, pending] = useActionState(updateClient, UPDATE_INITIAL);
  const [color, setColor] = useState<string>(client.colorToken);

  if (state.status === 'success') {
    router.replace(`/clients?selected=${encodeURIComponent(state.slug)}`);
    router.refresh();
  }

  return (
    <form action={action} noValidate>
      <input type="hidden" name={CSRF_FIELD_NAME} value={csrfToken} />
      <input type="hidden" name="clientId" value={client.id} />

      {state.status === 'error' ? <ErrorBanner message={state.message} /> : null}

      <Fields
        color={color}
        setColor={setColor}
        defaults={{
          name: client.name,
          initials: client.initials,
          domains: client.domains.join(', '),
          notes: client.notes ?? '',
        }}
      />

      <div className="mt-4 flex gap-2">
        <button
          type="submit"
          className="btn btn-primary"
          disabled={pending}
          aria-busy={pending || undefined}
        >
          {pending ? 'Enregistrement…' : 'Enregistrer'}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() =>
            router.replace(
              `/clients?selected=${encodeURIComponent(client.name.toLowerCase().replaceAll(/\s+/g, '-'))}`,
            )
          }
        >
          Annuler
        </button>
      </div>
    </form>
  );
}

function Fields({
  color,
  setColor,
  defaults,
}: {
  color: string;
  setColor: (c: string) => void;
  defaults?: { name: string; initials: string; domains: string; notes: string };
}) {
  return (
    <div className="grid gap-3">
      <div>
        <label className="field-label" htmlFor="cli-name">
          Nom du client
        </label>
        <input
          id="cli-name"
          name="name"
          type="text"
          required
          maxLength={120}
          defaultValue={defaults?.name ?? ''}
          placeholder="Acme Brands"
          className="field-input"
        />
      </div>

      <div>
        <span className="field-label">Couleur</span>
        <input type="hidden" name="colorToken" value={color} />
        <div className="mt-1 flex gap-2">
          {COLOR_TOKENS.map((c) => (
            <button
              key={c.token}
              type="button"
              onClick={() => setColor(c.token)}
              aria-label={c.label}
              aria-pressed={color === c.token}
              className="grid h-9 w-9 place-items-center rounded-full transition"
              style={{
                background: `var(--color-${c.token})`,
                outline:
                  color === c.token ? '2px solid var(--color-text-main)' : '2px solid transparent',
                outlineOffset: 2,
              }}
            >
              {color === c.token ? (
                <span aria-hidden="true" className="text-white">
                  ✓
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="field-label" htmlFor="cli-initials">
            Initiales (optionnel)
          </label>
          <input
            id="cli-initials"
            name="initials"
            type="text"
            maxLength={8}
            defaultValue={defaults?.initials ?? ''}
            placeholder="Auto"
            className="field-input"
          />
        </div>
        <div>
          <label className="field-label" htmlFor="cli-domains">
            Domaines email
          </label>
          <input
            id="cli-domains"
            name="domains"
            type="text"
            maxLength={2048}
            defaultValue={defaults?.domains ?? ''}
            placeholder="acme.com, sub.acme.com"
            className="field-input"
          />
        </div>
      </div>

      <div>
        <label className="field-label" htmlFor="cli-notes">
          Notes (optionnel)
        </label>
        <textarea
          id="cli-notes"
          name="notes"
          rows={3}
          maxLength={2000}
          defaultValue={defaults?.notes ?? ''}
          placeholder="Contexte, contraintes, points à retenir…"
          className="field-input"
        />
      </div>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="mb-3 rounded-md border border-[color:var(--color-danger)] bg-[color:var(--color-danger-bg)] px-3 py-2 text-sm font-medium text-[color:var(--color-danger)]"
    >
      {message}
    </p>
  );
}
