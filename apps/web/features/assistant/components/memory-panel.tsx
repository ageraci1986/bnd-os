'use client';

import { useEffect, useRef } from 'react';
import { useActionState } from 'react';
import { CSRF_FIELD_NAME } from '@/lib/csrf/field';
import {
  createMemoryAction,
  deleteMemoryAction,
  updateMemoryAction,
  type CreateMemoryState,
  type DeleteMemoryState,
  type UpdateMemoryState,
} from '../actions/memory';

/**
 * Forme minimale consommée par le panneau — volontairement définie ici
 * (plutôt qu'importée depuis `lib/assistant/memory.ts`, un module
 * `server-only`) pour ne rien tirer de server-only dans ce composant
 * client, même en type-only.
 */
export interface MemoryPanelEntry {
  readonly name: string;
  readonly fact: string;
}

export interface MemoryPanelProps {
  readonly entries: readonly MemoryPanelEntry[];
  readonly csrfToken: string;
}

const CREATE_INITIAL: CreateMemoryState = { status: 'idle' };

/**
 * Onglet Mémoire (Plan 3a Task 5) — CRUD manuel des faits retenus par
 * l'agent. Formulaire d'ajout en tête, une ligne éditable par fait (édition
 * inline + suppression), chacune avec son propre `useActionState` — l'échec
 * d'une ligne ne doit pas affecter les autres. La fraîcheur de `entries`
 * après une mutation vient de `revalidatePath('/assistant')` côté action
 * (pas d'état optimiste ici, contrairement au Kanban).
 */
export function MemoryPanel({ entries, csrfToken }: MemoryPanelProps) {
  const [createState, createAction, createPending] = useActionState(
    createMemoryAction,
    CREATE_INITIAL,
  );
  const addFormRef = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    if (createState.status === 'success') {
      addFormRef.current?.reset();
    }
  }, [createState]);

  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col gap-6 overflow-y-auto px-6 py-8">
      <form ref={addFormRef} action={createAction} className="flex flex-col gap-2">
        <label
          htmlFor="memory-new-fact"
          className="text-xs font-bold uppercase tracking-wide text-[color:var(--color-text-ghost)]"
        >
          Retenir un nouveau fait
        </label>
        <div className="flex items-center gap-2 rounded-full border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] px-4 py-2">
          <input type="hidden" name={CSRF_FIELD_NAME} value={csrfToken} />
          <input
            id="memory-new-fact"
            name="fact"
            type="text"
            placeholder="Ex. préfère les réunions le matin"
            className="flex-1 bg-transparent text-sm text-[color:var(--color-text-main)] outline-none"
            disabled={createPending}
          />
          <button
            type="submit"
            disabled={createPending}
            className="shrink-0 rounded-full px-4 py-1.5 text-xs font-bold text-white disabled:opacity-50"
            style={{ background: 'var(--accent-gradient)' }}
          >
            {createPending ? 'Retenu…' : 'Retenir'}
          </button>
        </div>
        {createState.status === 'error' ? (
          <p role="alert" className="text-xs text-[color:var(--color-danger)]">
            {createState.message}
          </p>
        ) : null}
      </form>

      {entries.length === 0 ? (
        <p className="text-sm text-[color:var(--color-text-muted)]">
          L&apos;assistant n&apos;a encore rien retenu — dites-lui « retiens que… » dans la
          conversation.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {entries.map((entry) => (
            <MemoryEntryRow key={entry.name} entry={entry} csrfToken={csrfToken} />
          ))}
        </ul>
      )}
    </div>
  );
}

const UPDATE_INITIAL: UpdateMemoryState = { status: 'idle' };
const DELETE_INITIAL: DeleteMemoryState = { status: 'idle' };

interface MemoryEntryRowProps {
  readonly entry: MemoryPanelEntry;
  readonly csrfToken: string;
}

function MemoryEntryRow({ entry, csrfToken }: MemoryEntryRowProps) {
  const [updateState, updateAction, updatePending] = useActionState(
    updateMemoryAction,
    UPDATE_INITIAL,
  );
  const [deleteState, deleteAction, deletePending] = useActionState(
    deleteMemoryAction,
    DELETE_INITIAL,
  );
  const factInputId = `memory-fact-${entry.name}`;

  return (
    <li className="flex flex-col gap-2 rounded-xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-4">
      <span className="text-[10px] font-bold uppercase tracking-wide text-[color:var(--color-text-ghost)]">
        {entry.name}
      </span>

      <form action={updateAction} className="flex items-center gap-2">
        <input type="hidden" name={CSRF_FIELD_NAME} value={csrfToken} />
        <input type="hidden" name="name" value={entry.name} />
        <label htmlFor={factInputId} className="sr-only">
          Fait mémorisé pour {entry.name}
        </label>
        <input
          id={factInputId}
          name="fact"
          type="text"
          defaultValue={entry.fact}
          className="flex-1 rounded-lg border border-[color:var(--color-border-soft)] bg-transparent px-3 py-1.5 text-sm text-[color:var(--color-text-main)] outline-none focus:border-[color:var(--accent-primary)]"
          disabled={updatePending}
        />
        <button
          type="submit"
          disabled={updatePending}
          className="shrink-0 rounded-full border border-[color:var(--color-border-light)] px-3 py-1.5 text-xs font-bold text-[color:var(--color-text-main)] disabled:opacity-50"
        >
          {updatePending ? 'Enregistre…' : 'Enregistrer'}
        </button>
      </form>

      <form action={deleteAction} className="self-end">
        <input type="hidden" name={CSRF_FIELD_NAME} value={csrfToken} />
        <input type="hidden" name="name" value={entry.name} />
        <button
          type="submit"
          disabled={deletePending}
          className="text-xs font-bold text-[color:var(--color-danger)] underline disabled:opacity-50"
          aria-label={`Supprimer le fait ${entry.name}`}
        >
          {deletePending ? 'Suppression…' : 'Supprimer'}
        </button>
      </form>

      {updateState.status === 'error' ? (
        <p role="alert" className="text-xs text-[color:var(--color-danger)]">
          {updateState.message}
        </p>
      ) : null}
      {deleteState.status === 'error' ? (
        <p role="alert" className="text-xs text-[color:var(--color-danger)]">
          {deleteState.message}
        </p>
      ) : null}
    </li>
  );
}
