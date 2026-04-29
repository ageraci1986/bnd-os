'use server';
import 'server-only';
import { revalidatePath } from 'next/cache';
import { prisma } from '@nexushub/db';
import { NotFoundError, computeCardPosition } from '@nexushub/domain';
import { requireUser } from '@/lib/auth';
import { MoveCardSchema } from '../lib/card-schemas';

/**
 * Move a card within its column or across columns. Position is computed
 * server-side from the resulting siblings so the client only sends the
 * desired insert index.
 *
 * Plain JSON action (no CSRF token field) — the caller is the dnd-kit
 * onDragEnd in the same origin; CSRF protection still applies because
 * Server Actions enforce origin/referer checks.
 */
export async function moveCard(input: {
  cardId: string;
  targetColumnId: string;
  targetIndex: number;
}): Promise<{ ok: true; position: number } | { ok: false; message: string }> {
  const ctx = await requireUser();

  const parsed = MoveCardSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Données invalides.' };
  }
  const { cardId, targetColumnId, targetIndex } = parsed.data;

  const card = await prisma.card.findFirst({
    where: { id: cardId, workspaceId: ctx.workspaceId, deletedAt: null },
    select: { id: true, projectId: true, columnId: true },
  });
  if (!card) throw new NotFoundError('Card');

  const targetColumn = await prisma.column.findFirst({
    where: { id: targetColumnId, projectId: card.projectId },
    select: { id: true, isBlockedSystem: true },
  });
  if (!targetColumn) throw new NotFoundError('Column');

  // PRD §8.3: the system Bloqué column is auto-managed; users can't drag
  // cards into it. Phase 5.D.3 adds the auto-routing rule.
  if (targetColumn.isBlockedSystem) {
    return {
      ok: false,
      message: 'La colonne « Bloqué » est gérée automatiquement par le système.',
    };
  }

  const siblings = await prisma.card.findMany({
    where: { columnId: targetColumnId, deletedAt: null, NOT: { id: cardId } },
    orderBy: { position: 'asc' },
    select: { position: true },
  });
  const position = computeCardPosition({
    orderedSiblingPositions: siblings.map((s) => s.position),
    targetIndex,
  });

  await prisma.card.update({
    where: { id: cardId },
    data: { columnId: targetColumnId, position },
  });

  revalidatePath(`/projects/${card.projectId}`);
  return { ok: true, position };
}
