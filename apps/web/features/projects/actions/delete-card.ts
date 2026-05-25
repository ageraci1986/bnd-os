'use server';
import 'server-only';
import { prisma } from '@nexushub/db';
import { Roles } from '@nexushub/domain';
import { requireUser } from '@/lib/auth';
import { loadUserScope } from '@/lib/auth/scope';
import { assertCsrfFromFormData } from '@/lib/csrf';
import { SCOPE_ERROR_MESSAGE, VIEWER_READ_ONLY_MESSAGE } from '../lib/scope-error';
import { DeleteCardSchema } from '../lib/card-schemas';

export type DeleteCardState =
  | { readonly status: 'idle' }
  | { readonly status: 'error'; readonly message: string };

export async function deleteCard(
  _prev: DeleteCardState,
  formData: FormData,
): Promise<DeleteCardState> {
  await assertCsrfFromFormData(formData);
  const ctx = await requireUser();
  if (ctx.role === Roles.Viewer) {
    return { status: 'error', message: VIEWER_READ_ONLY_MESSAGE };
  }

  const parsed = DeleteCardSchema.safeParse({ cardId: formData.get('cardId') });
  if (!parsed.success) {
    return { status: 'error', message: 'Identifiant carte invalide.' };
  }

  const card = await prisma.card.findFirst({
    where: { id: parsed.data.cardId, workspaceId: ctx.workspaceId, deletedAt: null },
    select: { id: true, projectId: true, project: { select: { clientId: true } } },
  });
  if (!card) {
    return { status: 'error', message: 'Carte introuvable.' };
  }

  const scope = await loadUserScope(ctx);
  if (scope.kind === 'restricted') {
    const allowed =
      scope.projectIds.includes(card.projectId) || scope.clientIds.includes(card.project.clientId);
    if (!allowed) {
      return { status: 'error', message: SCOPE_ERROR_MESSAGE };
    }
  }

  await prisma.card.update({
    where: { id: card.id },
    data: { deletedAt: new Date() },
  });

  // Intentionally NO revalidatePath: the board and list remove the row
  // optimistically via the `nx:card-removed` event. A server refetch raced
  // read-after-write on the pooler and sometimes returned a snapshot where
  // the soft-deleted row was still present, re-adding it to the board (the
  // user had to delete several times). Optimistic removal is authoritative
  // until the next natural navigation/refetch.
  return { status: 'idle' };
}
