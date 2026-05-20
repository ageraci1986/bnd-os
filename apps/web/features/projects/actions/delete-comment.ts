'use server';
import 'server-only';
import { prisma } from '@nexushub/db';
import { Roles } from '@nexushub/domain';
import { requireUser } from '@/lib/auth';
import { assertCsrfFromFormData } from '@/lib/csrf';
import { DeleteCommentSchema } from '../lib/comment-schemas';

export type DeleteCommentState =
  | { readonly status: 'idle' }
  | { readonly status: 'success'; readonly commentId: string }
  | { readonly status: 'error'; readonly message: string };

export async function deleteComment(
  _prev: DeleteCommentState,
  formData: FormData,
): Promise<DeleteCommentState> {
  await assertCsrfFromFormData(formData);
  const ctx = await requireUser();

  const parsed = DeleteCommentSchema.safeParse({
    commentId: formData.get('commentId'),
  });
  if (!parsed.success) {
    return { status: 'error', message: 'Identifiant invalide.' };
  }
  const { commentId } = parsed.data;

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

  // Idempotent: already deleted is a no-op success.
  if (comment.deletedAt !== null) {
    return { status: 'success', commentId };
  }

  const isAuthor = comment.authorId === ctx.userId;
  const isAdmin = ctx.role === Roles.Admin;
  if (!isAuthor && !isAdmin) {
    return {
      status: 'error',
      message: "Seul l'auteur ou un Admin peut supprimer ce commentaire.",
    };
  }

  await prisma.comment.update({
    where: { id: commentId },
    data: { deletedAt: new Date() },
  });

  return { status: 'success', commentId };
}
