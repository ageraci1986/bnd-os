'use server';
import 'server-only';
import { revalidatePath } from 'next/cache';
import { prisma } from '@nexushub/db';
import {
  NotFoundError,
  computeCardPosition,
  shouldMoveToBlocked,
  shouldRestoreFromBlocked,
  type Card as DomainCard,
  type Column as DomainColumn,
} from '@nexushub/domain';
import { requireUser } from '@/lib/auth';
import { UpdateCardDueDateSchema } from '../lib/checklist-schemas';

export interface UpdateDueDateResult {
  readonly ok: true;
  readonly autoBlocked: boolean;
  readonly autoUnblocked: boolean;
  readonly newColumnId: string;
  readonly newDueDate: string | null;
}

/**
 * Set or clear the due date on a card and apply the auto-routing rules
 * from PRD §8.3:
 *  - if the new date is already past AND the card is not in the last
 *    user column AND not already blocked → move to the system Bloqué
 *    column, stamping `previousColumnId` for return-trip later;
 *  - if the card is currently in Bloqué AND the date got pushed into
 *    the future (or cleared) → restore to `previousColumnId` and clear
 *    the stamp.
 */
export async function updateCardDueDate(input: {
  cardId: string;
  dueDate: string | null;
}): Promise<UpdateDueDateResult> {
  const ctx = await requireUser();

  const parsed = UpdateCardDueDateSchema.safeParse({
    cardId: input.cardId,
    dueDate: input.dueDate ?? '',
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'Données invalides.');
  }

  const card = await prisma.card.findFirst({
    where: { id: parsed.data.cardId, workspaceId: ctx.workspaceId, deletedAt: null },
    select: {
      id: true,
      projectId: true,
      columnId: true,
      previousColumnId: true,
      dueDate: true,
      archivedAt: true,
    },
  });
  if (!card) throw new NotFoundError('Card');

  const newDueDate = parsed.data.dueDate;

  // Persist the date first so the rule engine sees the new state.
  await prisma.card.update({
    where: { id: card.id },
    data: { dueDate: newDueDate },
  });

  const columns = await prisma.column.findMany({
    where: { projectId: card.projectId },
    orderBy: { position: 'asc' },
    select: { id: true, name: true, position: true, isBlockedSystem: true },
  });
  const blockedColumn = columns.find((c) => c.isBlockedSystem);
  const currentColumn = columns.find((c) => c.id === card.columnId);
  if (!blockedColumn || !currentColumn) {
    revalidatePath(`/projects/${card.projectId}`);
    return {
      ok: true,
      autoBlocked: false,
      autoUnblocked: false,
      newColumnId: card.columnId,
      newDueDate: newDueDate ? newDueDate.toISOString() : null,
    };
  }

  const domainCard: DomainCard = {
    id: card.id,
    columnId: card.columnId,
    previousColumnId: card.previousColumnId,
    dueDate: newDueDate,
    archivedAt: card.archivedAt,
    checklistTotal: 0,
    checklistDone: 0,
  };
  const domainColumns: DomainColumn[] = columns.map((c) => ({
    id: c.id,
    name: c.name,
    position: c.position,
    isBlockedSystem: c.isBlockedSystem,
  }));
  const now = new Date();

  let newColumnId = card.columnId;
  let autoBlocked = false;
  let autoUnblocked = false;

  if (currentColumn.isBlockedSystem) {
    if (shouldRestoreFromBlocked(domainCard, now, currentColumn) && card.previousColumnId) {
      const target = columns.find((c) => c.id === card.previousColumnId);
      if (target) {
        const siblings = await prisma.card.findMany({
          where: { columnId: target.id, deletedAt: null, NOT: { id: card.id } },
          orderBy: { position: 'asc' },
          select: { position: true },
        });
        const position = computeCardPosition({
          orderedSiblingPositions: siblings.map((s) => s.position),
          targetIndex: siblings.length,
        });
        await prisma.card.update({
          where: { id: card.id },
          data: { columnId: target.id, position, previousColumnId: null },
        });
        newColumnId = target.id;
        autoUnblocked = true;
      }
    }
  } else if (shouldMoveToBlocked(domainCard, now, domainColumns)) {
    const siblings = await prisma.card.findMany({
      where: { columnId: blockedColumn.id, deletedAt: null, NOT: { id: card.id } },
      orderBy: { position: 'asc' },
      select: { position: true },
    });
    const position = computeCardPosition({
      orderedSiblingPositions: siblings.map((s) => s.position),
      targetIndex: siblings.length,
    });
    await prisma.card.update({
      where: { id: card.id },
      data: {
        columnId: blockedColumn.id,
        position,
        previousColumnId: card.columnId,
      },
    });
    newColumnId = blockedColumn.id;
    autoBlocked = true;
  }

  revalidatePath(`/projects/${card.projectId}`);
  return {
    ok: true,
    autoBlocked,
    autoUnblocked,
    newColumnId,
    newDueDate: newDueDate ? newDueDate.toISOString() : null,
  };
}
