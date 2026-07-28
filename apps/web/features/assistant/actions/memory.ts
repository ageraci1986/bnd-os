'use server';
import 'server-only';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { assertCsrfFromFormData } from '@/lib/csrf';
import { forgetFact, rememberFact, updateFact } from '@/lib/assistant/memory';

/**
 * Server Actions form-based pour l'onglet Mémoire (Plan 3a Task 4) — CRUD
 * manuel des faits mémorisés par l'agent. Aucune logique métier ici :
 * chaque action ne fait que CSRF → `requireUser` → parser les champs bruts
 * du `FormData` → déléguer au cœur partagé `lib/assistant/memory.ts` (le
 * même que les tools `remember_fact`/`update_fact`/`forget_fact`) → mapper
 * `{ok}` vers l'état `{status}` consommé par `useActionState`.
 *
 * `revalidatePath('/assistant')` sur chaque succès : contrairement au
 * Kanban (état optimiste, cf. `create-card.ts`), le panneau Mémoire n'a pas
 * de store client — la liste vient telle quelle des props RSC, donc un
 * refetch serveur est le seul moyen de la tenir à jour après une mutation.
 */

export type CreateMemoryState =
  | { readonly status: 'idle' }
  | { readonly status: 'success'; readonly name: string; readonly fact: string }
  | { readonly status: 'error'; readonly message: string };

export async function createMemoryAction(
  _prev: CreateMemoryState,
  formData: FormData,
): Promise<CreateMemoryState> {
  await assertCsrfFromFormData(formData);
  const ctx = await requireUser();

  const factRaw = formData.get('fact');
  const result = await rememberFact(ctx, typeof factRaw === 'string' ? factRaw : '');

  if (!result.ok) {
    return { status: 'error', message: result.message };
  }
  revalidatePath('/assistant');
  return { status: 'success', name: result.name, fact: result.fact };
}

export type UpdateMemoryState =
  | { readonly status: 'idle' }
  | { readonly status: 'success'; readonly fact: string }
  | { readonly status: 'error'; readonly message: string };

export async function updateMemoryAction(
  _prev: UpdateMemoryState,
  formData: FormData,
): Promise<UpdateMemoryState> {
  await assertCsrfFromFormData(formData);
  const ctx = await requireUser();

  const nameRaw = formData.get('name');
  const factRaw = formData.get('fact');
  const result = await updateFact(
    ctx,
    typeof nameRaw === 'string' ? nameRaw : '',
    typeof factRaw === 'string' ? factRaw : '',
  );

  if (!result.ok) {
    return { status: 'error', message: result.message };
  }
  revalidatePath('/assistant');
  return { status: 'success', fact: result.fact };
}

export type DeleteMemoryState =
  | { readonly status: 'idle' }
  | { readonly status: 'success' }
  | { readonly status: 'error'; readonly message: string };

export async function deleteMemoryAction(
  _prev: DeleteMemoryState,
  formData: FormData,
): Promise<DeleteMemoryState> {
  await assertCsrfFromFormData(formData);
  const ctx = await requireUser();

  const nameRaw = formData.get('name');
  const result = await forgetFact(ctx, typeof nameRaw === 'string' ? nameRaw : '');

  if (!result.ok) {
    return { status: 'error', message: result.message };
  }
  revalidatePath('/assistant');
  return { status: 'success' };
}
