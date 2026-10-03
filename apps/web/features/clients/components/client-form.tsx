'use client';
import { useActionState, useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  CLIENT_COLOR_LABELS_FR,
  CLIENT_COLOR_TOKENS,
  clientColorCss,
  clientColorForeground,
  isValidColorToken,
} from '@nexushub/domain';
import { CSRF_FIELD_NAME } from '@/lib/csrf/field';
import { createClient, type CreateClientState } from '../actions/create-client';
import { updateClient, type UpdateClientState } from '../actions/update-client';

const CREATE_INITIAL: CreateClientState = { status: 'idle' };
const UPDATE_INITIAL: UpdateClientState = { status: 'idle' };

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

  useEffect(() => {
    if (state.status === 'success') {
      router.replace(`/clients?selected=${encodeURIComponent(state.slug)}`);
      router.refresh();
    }
  }, [state, router]);

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

  useEffect(() => {
    if (state.status === 'success') {
      router.replace(`/clients?selected=${encodeURIComponent(state.slug)}`);
      router.refresh();
    }
  }, [state, router]);

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
  const colorLabelId = useId();
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
        <span className="field-label" id={colorLabelId}>
          Couleur
        </span>
        <input type="hidden" name="colorToken" value={color} />
        <div role="group" aria-labelledby={colorLabelId} className="mt-1 flex flex-wrap gap-2">
          {CLIENT_COLOR_TOKENS.map((token) => (
            <ColorSwatch
              key={token}
              value={token}
              label={CLIENT_COLOR_LABELS_FR[token]}
              selected={color === token}
              onSelect={() => setColor(token)}
            />
          ))}
          <CustomColorButton value={color} onChange={setColor} />
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

function ColorSwatch({
  value,
  label,
  selected,
  onSelect,
}: {
  value: string;
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={label}
      aria-pressed={selected}
      title={label}
      className="grid h-9 w-9 place-items-center rounded-full transition"
      style={{
        background: clientColorCss(value),
        boxShadow: selected
          ? '0 0 0 2px var(--color-bg-card), 0 0 0 4px var(--color-text-main)'
          : 'none',
      }}
    >
      {selected ? (
        <span aria-hidden="true" style={{ color: clientColorForeground(value) }}>
          ✓
        </span>
      ) : null}
    </button>
  );
}

/** « + » : ouvre le sélecteur natif ; une couleur libre devient la sélection. */
function CustomColorButton({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const isCustom = !isValidColorToken(value);
  const open = () => {
    const el = inputRef.current;
    if (!el) return;
    if (typeof el.showPicker === 'function') {
      try {
        el.showPicker();
      } catch {
        el.click();
      }
    } else {
      el.click();
    }
  };
  return (
    <>
      <button
        type="button"
        onClick={open}
        aria-label={isCustom ? `Couleur personnalisée (${value})` : 'Couleur personnalisée'}
        aria-pressed={isCustom}
        title="Couleur personnalisée"
        className="grid h-9 w-9 place-items-center rounded-full border border-dashed border-[color:var(--color-border-light)] text-[color:var(--color-text-soft)] transition"
        style={
          isCustom
            ? {
                background: clientColorCss(value),
                color: clientColorForeground(value),
                borderStyle: 'solid',
                boxShadow: '0 0 0 2px var(--color-bg-card), 0 0 0 4px var(--color-text-main)',
              }
            : undefined
        }
      >
        <span aria-hidden="true">{isCustom ? '✓' : '+'}</span>
      </button>
      <input
        ref={inputRef}
        type="color"
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
        value={isCustom ? value : '#888888'} // theme-exempt: valeur native input[type=color], pas de var() CSS possible ici
        onChange={(e) => onChange(e.target.value.toLowerCase())}
      />
    </>
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
