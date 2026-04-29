'use client';
import { useActionState, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CSRF_FIELD_NAME } from '@/lib/csrf/field';
import { RACI_VALUES, raciLabelFr, type Raci } from '@nexushub/domain';
import { createContact, type CreateContactState } from '../actions/create-contact';
import { updateContact, type UpdateContactState } from '../actions/update-contact';

const CREATE_INITIAL: CreateContactState = { status: 'idle' };
const UPDATE_INITIAL: UpdateContactState = { status: 'idle' };

interface CreateProps {
  readonly mode: 'create';
  readonly csrfToken: string;
  readonly clientId: string;
}

interface EditProps {
  readonly mode: 'edit';
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
  readonly onClose: () => void;
}

type Props = CreateProps | EditProps;

export function ContactForm(props: Props) {
  const router = useRouter();

  if (props.mode === 'create') {
    return (
      <CreateContactForm
        csrfToken={props.csrfToken}
        clientId={props.clientId}
        onAfterCreate={() => router.refresh()}
      />
    );
  }
  return (
    <EditContactForm
      csrfToken={props.csrfToken}
      contact={props.contact}
      onAfterSave={() => {
        router.refresh();
        props.onClose();
      }}
    />
  );
}

function CreateContactForm({
  csrfToken,
  clientId,
  onAfterCreate,
}: {
  csrfToken: string;
  clientId: string;
  onAfterCreate: () => void;
}) {
  const [state, action, pending] = useActionState(createContact, CREATE_INITIAL);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === 'success' && formRef.current) {
      formRef.current.reset();
      onAfterCreate();
    }
  }, [state.status, onAfterCreate]);

  return (
    <form
      ref={formRef}
      action={action}
      noValidate
      className="rounded-2xl border border-dashed border-[color:var(--color-border-light)] p-4"
    >
      <input type="hidden" name={CSRF_FIELD_NAME} value={csrfToken} />
      <input type="hidden" name="clientId" value={clientId} />
      <h3 className="mb-3 text-sm font-extrabold tracking-tight">Ajouter un contact</h3>
      {state.status === 'error' ? <ErrorBanner message={state.message} /> : null}
      <ContactFields />
      <button
        type="submit"
        className="btn btn-primary mt-3"
        disabled={pending}
        aria-busy={pending || undefined}
      >
        {pending ? 'Ajout…' : '+ Ajouter le contact'}
      </button>
    </form>
  );
}

function EditContactForm({
  csrfToken,
  contact,
  onAfterSave,
}: {
  csrfToken: string;
  contact: EditProps['contact'];
  onAfterSave: () => void;
}) {
  const [state, action, pending] = useActionState(updateContact, UPDATE_INITIAL);

  useEffect(() => {
    if (state.status === 'success') onAfterSave();
  }, [state.status, onAfterSave]);

  return (
    <form
      action={action}
      noValidate
      className="rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-soft)] p-4"
    >
      <input type="hidden" name={CSRF_FIELD_NAME} value={csrfToken} />
      <input type="hidden" name="contactId" value={contact.id} />
      <h3 className="mb-3 text-sm font-extrabold tracking-tight">Modifier le contact</h3>
      {state.status === 'error' ? <ErrorBanner message={state.message} /> : null}
      <ContactFields defaults={contact} />
      <button
        type="submit"
        className="btn btn-primary mt-3"
        disabled={pending}
        aria-busy={pending || undefined}
      >
        {pending ? 'Enregistrement…' : 'Enregistrer'}
      </button>
    </form>
  );
}

function ContactFields({
  defaults,
}: {
  defaults?: {
    firstName: string;
    lastName: string;
    jobTitle: string | null;
    email: string | null;
    phone: string | null;
    raci: Raci | null;
    notes: string | null;
  };
}) {
  const [raci, setRaci] = useState<string>(defaults?.raci ?? '');

  return (
    <div className="grid gap-2">
      <div className="grid grid-cols-2 gap-2">
        <input
          name="firstName"
          type="text"
          required
          maxLength={80}
          defaultValue={defaults?.firstName ?? ''}
          placeholder="Prénom"
          className="field-input"
        />
        <input
          name="lastName"
          type="text"
          required
          maxLength={80}
          defaultValue={defaults?.lastName ?? ''}
          placeholder="Nom"
          className="field-input"
        />
      </div>
      <input
        name="jobTitle"
        type="text"
        maxLength={120}
        defaultValue={defaults?.jobTitle ?? ''}
        placeholder="Rôle entreprise (optionnel)"
        className="field-input"
      />
      <div className="grid grid-cols-2 gap-2">
        <input
          name="email"
          type="email"
          maxLength={254}
          defaultValue={defaults?.email ?? ''}
          placeholder="email@exemple.com"
          className="field-input"
        />
        <input
          name="phone"
          type="tel"
          maxLength={40}
          defaultValue={defaults?.phone ?? ''}
          placeholder="Téléphone"
          className="field-input"
        />
      </div>
      <div>
        <span className="field-label">RACI</span>
        <input type="hidden" name="raci" value={raci} />
        <div className="mt-1 flex gap-1.5">
          <RaciButton value="" current={raci} setRaci={setRaci} label="—" />
          {RACI_VALUES.map((r) => (
            <RaciButton key={r} value={r} current={raci} setRaci={setRaci} label={raciLabelFr(r)} />
          ))}
        </div>
      </div>
      <textarea
        name="notes"
        rows={2}
        maxLength={2000}
        defaultValue={defaults?.notes ?? ''}
        placeholder="Notes (optionnel)"
        className="field-input"
      />
    </div>
  );
}

function RaciButton({
  value,
  current,
  setRaci,
  label,
}: {
  value: string;
  current: string;
  setRaci: (v: string) => void;
  label: string;
}) {
  const active = value === current;
  return (
    <button
      type="button"
      onClick={() => setRaci(value)}
      aria-pressed={active}
      className={[
        'grid h-9 w-9 place-items-center rounded-full text-xs font-extrabold transition',
        active
          ? 'bg-[color:var(--color-text-main)] text-white'
          : 'bg-[color:var(--color-bg-soft)] text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-bg-hover)]',
      ].join(' ')}
    >
      {label}
    </button>
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
