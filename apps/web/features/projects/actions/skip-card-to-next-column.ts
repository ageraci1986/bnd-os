'use server';
import 'server-only';
import { revalidatePath } from 'next/cache';
import { prisma } from '@nexushub/db';
import { NotFoundError, computeCardPosition } from '@nexushub/domain';
import { requireUser } from '@/lib/auth';
import { SkipCardSchema } from '../lib/checklist-schemas';

export type SkipCardResult =
  | { readonly ok: true; readonly moved: false; readonly reason: string }
  | { readonly ok: true; readonly moved: true; readonly newColumnId: string };

/**
 * Click-to-advance shortcut: moves a card to the next user column without
 * requiring its checklist to be complete. Same destination logic as the
 * auto-advance flow — system "Bloqué" is skipped, last user column is a
 * dead end. Step-checklist seeding follows moveCard's "first visit only"
 * rule so bouncing a card around preserves earlier checked state.
 */
export async function skipCardToNextColumn(input: { cardId: string }): Promise<SkipCardResult> {
  const ctx = await requireUser();

  const parsed = SkipCardSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: true, moved: false, reason: parsed.error.issues[0]?.message ?? 'invalid' };
  }

  const card = await prisma.card.findFirst({
    where: { id: parsed.data.cardId, workspaceId: ctx.workspaceId, deletedAt: null },
    select: { id: true, projectId: true, columnId: true },
  });
  if (!card) throw new NotFoundError('Card');

  const columns = await prisma.column.findMany({
    where: { projectId: card.projectId },
    orderBy: { position: 'asc' },
    select: { id: true, position: true, isBlockedSystem: true, stepChecklist: true },
  });

  const userColumns = columns.filter((c) => !c.isBlockedSystem);
  const currentIdx = userColumns.findIndex((c) => c.id === card.columnId);
  if (currentIdx < 0) {
    return { ok: true, moved: false, reason: 'card-in-blocked-column' };
  }
  if (currentIdx === userColumns.length - 1) {
    return { ok: true, moved: false, reason: 'already-last-column' };
  }

  const nextCol = userColumns[currentIdx + 1];
  if (!nextCol) {
    return { ok: true, moved: false, reason: 'no-next-column' };
  }
  const isLastUserCol = currentIdx + 1 === userColumns.length - 1;

  const siblings = await prisma.card.findMany({
    where: { columnId: nextCol.id, deletedAt: null, NOT: { id: card.id } },
    orderBy: { position: 'asc' },
    select: { position: true },
  });
  const position = computeCardPosition({
    orderedSiblingPositions: siblings.map((s) => s.position),
    targetIndex: siblings.length,
  });

  await prisma.$transaction(async (tx) => {
    await tx.card.update({
      where: { id: card.id },
      data: {
        columnId: nextCol.id,
        position,
        ...(isLastUserCol ? { movedToLastAt: new Date() } : {}),
      },
    });

    if (nextCol.stepChecklist.length > 0) {
      const existing = await tx.checklistItem.count({
        where: { cardId: card.id, columnSourceId: nextCol.id },
      });
      if (existing === 0) {
        const lastPos = await tx.checklistItem.findFirst({
          where: { cardId: card.id },
          orderBy: { position: 'desc' },
          select: { position: true },
        });
        const base = (lastPos?.position ?? 0) + 1024;
        await tx.checklistItem.createMany({
          data: nextCol.stepChecklist.map((title, idx) => ({
            cardId: card.id,
            title,
            position: base + (idx + 1) * 1024,
            isChecked: false,
            columnSourceId: nextCol.id,
          })),
        });
      }
    }
  });

  revalidatePath(`/projects/${card.projectId}`);
  revalidatePath(`/projects/${card.projectId}/list`);
  revalidatePath(`/projects/${card.projectId}/calendar`);
  return { ok: true, moved: true, newColumnId: nextCol.id };
}
