'use server';
import 'server-only';
import { z } from 'zod';
import { prisma } from '@nexushub/db';
import { NotFoundError, Roles, computeCardPosition } from '@nexushub/domain';
import { requireUser } from '@/lib/auth';
import { loadUserScope } from '@/lib/auth/scope';
import { SCOPE_ERROR_MESSAGE, VIEWER_READ_ONLY_MESSAGE } from '../lib/scope-error';

const Schema = z.object({ cardId: z.string().uuid() });

export type UncompleteCardResult =
  | { readonly ok: true; readonly newColumnId: string }
  | { readonly ok: false; readonly message: string };

/**
 * Inverse of "card auto-completes when it lands in the last user
 * column": clicking the completed badge in list view sends the card
 * back to the second-to-last user column (typically "À faire" → "En
 * cours" → "Done", so an uncheck on Done goes back to En cours).
 *
 * The DB trigger `sync_card_completed_at` clears `completed_at` as a
 * side effect of the column change, so nothing else to update.
 */
export async function uncompleteCard(input: { cardId: string }): Promise<UncompleteCardResult> {
  const ctx = await requireUser();
  if (ctx.role === Roles.Viewer) {
    return { ok: false, message: VIEWER_READ_ONLY_MESSAGE };
  }
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Identifiant invalide.' };

  const card = await prisma.card.findFirst({
    where: { id: parsed.data.cardId, workspaceId: ctx.workspaceId, deletedAt: null },
    select: {
      id: true,
      projectId: true,
      columnId: true,
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

  const userColumns = await prisma.column.findMany({
    where: { projectId: card.projectId, isBlockedSystem: false },
    orderBy: { position: 'asc' },
    select: { id: true },
  });
  if (userColumns.length < 2) {
    return { ok: false, message: 'Pas de colonne précédente disponible.' };
  }

  const lastUserCol = userColumns[userColumns.length - 1];
  const previousUserCol = userColumns[userColumns.length - 2];
  if (!lastUserCol || !previousUserCol) {
    return { ok: false, message: 'Colonnes du projet inattendues.' };
  }
  if (card.columnId !== lastUserCol.id) {
    return { ok: false, message: "La carte n'est pas dans la dernière colonne." };
  }

  // Drop the card at the END of the previous user column. The PG
  // trigger `sync_card_completed_at` clears `completed_at` for free.
  const siblings = await prisma.card.findMany({
    where: { columnId: previousUserCol.id, deletedAt: null, NOT: { id: card.id } },
    orderBy: { position: 'asc' },
    select: { position: true },
  });
  const position = computeCardPosition({
    orderedSiblingPositions: siblings.map((s) => s.position),
    targetIndex: siblings.length,
  });

  await prisma.card.update({
    where: { id: card.id },
    data: { columnId: previousUserCol.id, position },
  });

  return { ok: true, newColumnId: previousUserCol.id };
}
