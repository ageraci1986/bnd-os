'use server';
import 'server-only';
import { prisma, type Prisma } from '@nexushub/db';
import { NotFoundError } from '@nexushub/domain';
import { markdown } from '@nexushub/integrations';
import { requireUser } from '@/lib/auth';
import { loadUserScope } from '@/lib/auth/scope';
import { assertCsrfFromFormData } from '@/lib/csrf';
import { getEmail } from '@/lib/email';
import { getPublicEnv } from '@/lib/env';
import { SCOPE_ERROR_MESSAGE } from '../lib/scope-error';
import { CreateCommentSchema } from '../lib/comment-schemas';
import { renderCommentNotificationEmail } from '@/features/notifications/email/comment-notification';

export type CreateCommentState =
  | { readonly status: 'idle' }
  | { readonly status: 'success'; readonly commentId: string }
  | { readonly status: 'error'; readonly message: string };

const PREVIEW_MAX = 200;

function displayName(u: {
  firstName: string | null;
  lastName: string | null;
  email: string;
}): string {
  const full = `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim();
  return full.length > 0 ? full : u.email;
}

export async function createComment(
  _prev: CreateCommentState,
  formData: FormData,
): Promise<CreateCommentState> {
  await assertCsrfFromFormData(formData);
  const ctx = await requireUser();

  const parsed = CreateCommentSchema.safeParse({
    cardId: formData.get('cardId'),
    body: formData.get('body'),
  });
  if (!parsed.success) {
    return {
      status: 'error',
      message: parsed.error.issues[0]?.message ?? 'Commentaire invalide.',
    };
  }
  const { cardId, body } = parsed.data;

  const card = await prisma.card.findFirst({
    where: { id: cardId, workspaceId: ctx.workspaceId, deletedAt: null },
    select: {
      id: true,
      projectId: true,
      workspaceId: true,
      shortRef: true,
      title: true,
      createdById: true,
      createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
      project: {
        select: { name: true, clientId: true, client: { select: { name: true } } },
      },
      assignees: {
        select: {
          userId: true,
          user: { select: { firstName: true, lastName: true, email: true } },
        },
      },
    },
  });
  if (!card) throw new NotFoundError('Card');

  const scope = await loadUserScope(ctx);
  if (scope.kind === 'restricted') {
    const allowed =
      scope.projectIds.includes(card.projectId) || scope.clientIds.includes(card.project.clientId);
    if (!allowed) return { status: 'error', message: SCOPE_ERROR_MESSAGE };
  }

  const author = await prisma.user.findUnique({
    where: { id: ctx.userId },
    select: { firstName: true, lastName: true, email: true },
  });

  const created = await prisma.comment.create({
    data: { cardId, authorId: ctx.userId, body },
    select: { id: true },
  });

  // Recipients = (assignees ∪ card creator) − comment author, deduped by
  // userId. The creator is notified even if they're not a RACI assignee
  // (they have a stake in the card). Cards created before the
  // `createdById` column exists have a null creator and contribute nobody.
  const recipientsById = new Map<
    string,
    { firstName: string | null; lastName: string | null; email: string }
  >();
  for (const a of card.assignees) {
    if (a.userId !== ctx.userId) recipientsById.set(a.userId, a.user);
  }
  if (card.createdBy && card.createdBy.id !== ctx.userId) {
    recipientsById.set(card.createdBy.id, {
      firstName: card.createdBy.firstName,
      lastName: card.createdBy.lastName,
      email: card.createdBy.email,
    });
  }
  const recipients = [...recipientsById].map(([userId, user]) => ({ userId, user }));

  if (recipients.length > 0) {
    const env = getPublicEnv();
    const commentUrl = `${env.NEXT_PUBLIC_APP_URL}/projects/${card.projectId}?card=${card.id}`;
    const authorName = author ? displayName(author) : ctx.email;
    const preview = markdown.markdownToPlainText(body, PREVIEW_MAX);

    await Promise.allSettled(
      recipients.map(async (r) => {
        const notif = await prisma.notification.create({
          data: {
            workspaceId: ctx.workspaceId,
            userId: r.userId,
            kind: 'card_commented',
            channel: 'email',
            data: { cardId: card.id, commentId: created.id } as Prisma.InputJsonValue,
          },
          select: { id: true },
        });
        try {
          const tpl = renderCommentNotificationEmail({
            recipientFirstName: r.user.firstName ?? r.user.email.split('@')[0] ?? '',
            authorDisplayName: authorName,
            cardShortRef: card.shortRef,
            cardTitle: card.title,
            projectName: card.project.name,
            clientName: card.project.client.name,
            commentBodyPreview: preview,
            commentUrl,
          });
          await getEmail().send({
            to: r.user.email,
            subject: tpl.subject,
            text: tpl.text,
            htmlSanitized: tpl.htmlSanitized,
            tag: 'notification',
          });
          await prisma.notification.update({
            where: { id: notif.id },
            data: { sentAt: new Date() },
          });
        } catch (err) {
          console.error('[createComment] notification send failed', {
            notificationId: notif.id,
            error: err instanceof Error ? err.message : 'unknown',
          });
        }
      }),
    );
  }

  return { status: 'success', commentId: created.id };
}
