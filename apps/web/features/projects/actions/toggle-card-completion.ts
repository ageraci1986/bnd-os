'use server';
import 'server-only';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@nexushub/db';
import { NotFoundError, Roles } from '@nexushub/domain';
import { requireUser } from '@/lib/auth';
import { loadUserScope } from '@/lib/auth/scope';
import { SCOPE_ERROR_MESSAGE, VIEWER_READ_ONLY_MESSAGE } from '../lib/scope-error';

const Schema = z.object({
  cardId: z.string().uuid(),
  /** true = mark done, false = uncheck. */
  completed: z.boolean(),
});

export type ToggleCompletionResult =
  | { readonly ok: true; readonly completedAt: string | null }
  | { readonly ok: false; readonly message: string };

/**
 * "Todo-list" semantic on the last user column. The card is already in
 * Done (last column) — checking the box just stamps `completedAt` so the
 * list view can show a strikethrough. Unchecking clears it. Cards in
 * other columns can't be completed this way; advance them first via
 * `skipCardToNextColumn` / step checklist.
 *
 * Guard order: Viewer → input parse → ownership → scope → in-last-column.
 */
export async function toggleCardCompletion(input: {
  cardId: string;
  completed: boolean;
}): Promise<ToggleCompletionResult> {
  const ctx = await requireUser();
  if (ctx.role === Roles.Viewer) {
    return { ok: false, message: VIEWER_READ_ONLY_MESSAGE };
  }

  const parsed = Schema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Données invalides.' };

  const card = await prisma.card.findFirst({
    where: { id: parsed.data.cardId, workspaceId: ctx.workspaceId, deletedAt: null },
    select: {
      id: true,
      projectId: true,
      columnId: true,
      completedAt: true,
      project: { select: { clientId: true } },
    },
  });
  if (!card) throw new NotFoundError('Card');

  const scope = await loadUserScope(ctx);
  if (scope.kind === 'restricted') {
    const allowed =
      scope.projectIds.includes(card.projectId) || scope.clientIds.includes(card.project.clientId);
    if (!allowed) return { ok: false, message: SCOPE_ERROR_MESSAGE };
  }

  // Verify the card lives in the last user column of its project.
  // System "Bloqué" is excluded; the last *user* column is the one with
  // the highest position among non-blocked columns.
  const userColumns = await prisma.column.findMany({
    where: { projectId: card.projectId, isBlockedSystem: false },
    orderBy: { position: 'asc' },
    select: { id: true },
  });
  const lastUserColumnId = userColumns[userColumns.length - 1]?.id ?? null;
  if (!lastUserColumnId || card.columnId !== lastUserColumnId) {
    return {
      ok: false,
      message: 'Le marquage « terminé » n’est disponible que pour les cartes en dernière colonne.',
    };
  }

  // Idempotent: if state already matches, skip the DB write.
  const alreadyCompleted = card.completedAt !== null;
  if (alreadyCompleted === parsed.data.completed) {
    return {
      ok: true,
      completedAt: card.completedAt ? card.completedAt.toISOString() : null,
    };
  }

  const nextCompletedAt = parsed.data.completed ? new Date() : null;
  await prisma.card.update({
    where: { id: card.id },
    data: { completedAt: nextCompletedAt },
  });

  revalidatePath(`/projects/${card.projectId}`);
  revalidatePath(`/projects/${card.projectId}/list`);
  return {
    ok: true,
    completedAt: nextCompletedAt ? nextCompletedAt.toISOString() : null,
  };
}
