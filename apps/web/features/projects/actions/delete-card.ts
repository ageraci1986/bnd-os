'use server';
import 'server-only';
import { requireUser } from '@/lib/auth';
import { assertCsrfFromFormData } from '@/lib/csrf';
import { deleteCardCore } from '../lib/card-core';

export type DeleteCardState =
  | { readonly status: 'idle' }
  | { readonly status: 'error'; readonly message: string };

export async function deleteCard(
  _prev: DeleteCardState,
  formData: FormData,
): Promise<DeleteCardState> {
  await assertCsrfFromFormData(formData);
  const ctx = await requireUser();

  const result = await deleteCardCore(ctx, {
    cardId: formData.get('cardId') as string,
  });

  if (!result.ok) {
    return { status: 'error', message: result.message };
  }

  // Intentionally NO revalidatePath: the board and list remove the row
  // optimistically via the `nx:card-removed` event. A server refetch raced
  // read-after-write on the pooler and sometimes returned a snapshot where
  // the soft-deleted row was still present, re-adding it to the board (the
  // user had to delete several times). Optimistic removal is authoritative
  // until the next natural navigation/refetch.
  return { status: 'idle' };
}
