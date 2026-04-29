'use server';
import 'server-only';
import { revalidatePath } from 'next/cache';
import { prisma } from '@nexushub/db';
import { requireUser } from '@/lib/auth';
import { assertCsrfFromFormData } from '@/lib/csrf';
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

  const parsed = DeleteCardSchema.safeParse({ cardId: formData.get('cardId') });
  if (!parsed.success) {
    return { status: 'error', message: 'Identifiant carte invalide.' };
  }

  const card = await prisma.card.findFirst({
    where: { id: parsed.data.cardId, workspaceId: ctx.workspaceId, deletedAt: null },
    select: { id: true, projectId: true },
  });
  if (!card) {
    return { status: 'error', message: 'Carte introuvable.' };
  }

  await prisma.card.update({
    where: { id: card.id },
    data: { deletedAt: new Date() },
  });

  revalidatePath(`/projects/${card.projectId}`);
  return { status: 'idle' };
}
