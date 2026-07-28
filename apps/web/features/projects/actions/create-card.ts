'use server';
import 'server-only';
import { requireUser } from '@/lib/auth';
import { assertCsrfFromFormData } from '@/lib/csrf';
import { createCardCore } from '../lib/card-core';

export type CreateCardState =
  | { readonly status: 'idle' }
  | {
      readonly status: 'success';
      readonly cardId: string;
      readonly shortRef: number;
      readonly title: string;
    }
  | { readonly status: 'error'; readonly message: string };

export async function createCard(
  _prev: CreateCardState,
  formData: FormData,
): Promise<CreateCardState> {
  await assertCsrfFromFormData(formData);
  const ctx = await requireUser();

  const templateIdRaw = formData.get('templateId');
  const proposedIdRaw = formData.get('proposedId');

  const result = await createCardCore(ctx, {
    projectId: formData.get('projectId') as string,
    columnId: formData.get('columnId') as string,
    title: formData.get('title') as string,
    templateId: typeof templateIdRaw === 'string' ? templateIdRaw : null,
    proposedId: typeof proposedIdRaw === 'string' ? proposedIdRaw : null,
  });

  if (!result.ok) {
    return { status: 'error', message: result.message };
  }

  // Intentionally NO revalidatePath here. The board and list both append
  // the new row optimistically from the `nx:card-created` event and patch
  // its shortRef from `nx:card-shortref-resolved`. A server refetch raced
  // against read-after-write visibility on the pooler: it sometimes
  // returned a snapshot WITHOUT the just-committed row and clobbered the
  // optimistic append (card vanished until a manual refresh), and the page
  // re-render churned the open modal. Optimistic state is the source of
  // truth until the next natural navigation/refetch.
  return {
    status: 'success',
    cardId: result.cardId,
    shortRef: result.shortRef,
    title: result.title,
  };
}
