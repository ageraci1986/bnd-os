'use server';
import 'server-only';
import { prisma } from '@nexushub/db';
import { requireUser } from '@/lib/auth';
import { assertCsrfFromFormData } from '@/lib/csrf';
import { UpdateCommentSchema } from '../lib/comment-schemas';

export type UpdateCommentState =
  | { readonly status: 'idle' }
  | { readonly status: 'success'; readonly commentId: string }
  | { readonly status: 'error'; readonly message: string };

export async function updateComment(
  _prev: UpdateCommentState,
  formData: FormData,
): Promise<UpdateCommentState> {
  await assertCsrfFromFormData(formData);
  const ctx = await requireUser();

  const parsed = UpdateCommentSchema.safeParse({
    commentId: formData.get('commentId'),
    body: formData.get('body'),
  });
  if (!parsed.success) {
    return {
      status: 'error',
      message: parsed.error.issues[0]?.message ?? 'Commentaire invalide.',
    };
  }
  const { commentId, body } = parsed.data;

  const comment = await prisma.comment.findFirst({
    where: { id: commentId },
    select: {
      id: true,
      authorId: true,
      cardId: true,
      deletedAt: true,
      card: { select: { projectId: true, workspaceId: true } },
    },
  });
  if (!comment) {
    return { status: 'error', message: 'Commentaire introuvable.' };
  }
  if (comment.card.workspaceId !== ctx.workspaceId) {
    return { status: 'error', message: 'Commentaire introuvable.' };
  }
  if (comment.deletedAt !== null) {
    return { status: 'error', message: 'Ce commentaire a été supprimé.' };
  }
  if (comment.authorId !== ctx.userId) {
    return { status: 'error', message: "Seul l'auteur peut modifier ce commentaire." };
  }

  await prisma.comment.update({
    where: { id: commentId },
    data: { body },
  });

  return { status: 'success', commentId };
}
