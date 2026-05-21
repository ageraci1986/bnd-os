'use server';
import 'server-only';
import { prisma } from '@nexushub/db';
import {
  NotFoundError,
  Roles,
  computeCardPosition,
  evaluateAutoAdvance,
  type Card as DomainCard,
  type Column as DomainColumn,
} from '@nexushub/domain';
import { requireUser } from '@/lib/auth';
import { loadUserScope } from '@/lib/auth/scope';
import { SCOPE_ERROR_MESSAGE, VIEWER_READ_ONLY_MESSAGE } from '../lib/scope-error';
import { AdvanceCardSchema } from '../lib/checklist-schemas';

export type AdvanceCardResult =
  | { readonly ok: true; readonly moved: false; readonly reason: string }
  | { readonly ok: true; readonly moved: true; readonly newColumnId: string }
  | { readonly ok: false; readonly message: string };

/**
 * Called by the modal carte after the 1.8s timer fires (PRD §8.2). Re-runs
 * `evaluateAutoAdvance` server-side as defence-in-depth: a stale or stalled
 * client could call this without all items actually being checked. Rules
 * stay in `@nexushub/domain/kanban`; this is just the persistence wiring.
 */
export async function advanceCard(input: { cardId: string }): Promise<AdvanceCardResult> {
  const ctx = await requireUser();
  if (ctx.role === Roles.Viewer) {
    return { ok: false, message: VIEWER_READ_ONLY_MESSAGE };
  }

  const parsed = AdvanceCardSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: true, moved: false, reason: parsed.error.issues[0]?.message ?? 'invalid' };
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
      _count: { select: { checklistItems: true } },
      project: { select: { clientId: true } },
    },
  });
  if (!card) throw new NotFoundError('Card');

  const scope = await loadUserScope(ctx);
  if (scope.kind === 'restricted') {
    const allowed =
      scope.projectIds.includes(card.projectId) || scope.clientIds.includes(card.project.clientId);
    if (!allowed) {
      return { ok: false, message: SCOPE_ERROR_MESSAGE };
    }
  }

  const [columns, checklistDoneCount] = await Promise.all([
    prisma.column.findMany({
      where: { projectId: card.projectId },
      orderBy: { position: 'asc' },
      select: { id: true, name: true, position: true, isBlockedSystem: true },
    }),
    prisma.checklistItem.count({ where: { cardId: card.id, isChecked: true } }),
  ]);

  const currentColumn = columns.find((c) => c.id === card.columnId);
  if (!currentColumn) throw new NotFoundError('Column');

  const domainCard: DomainCard = {
    id: card.id,
    columnId: card.columnId,
    previousColumnId: card.previousColumnId,
    dueDate: card.dueDate,
    archivedAt: card.archivedAt,
    checklistTotal: card._count.checklistItems,
    checklistDone: checklistDoneCount,
  };
  const domainColumns: DomainColumn[] = columns.map((c) => ({
    id: c.id,
    name: c.name,
    position: c.position,
    isBlockedSystem: c.isBlockedSystem,
  }));

  const outcome = evaluateAutoAdvance(domainCard, currentColumn, domainColumns);
  if (outcome.action === 'none') {
    return { ok: true, moved: false, reason: outcome.reason };
  }

  // Append at the bottom of the target column.
  const siblings = await prisma.card.findMany({
    where: { columnId: outcome.nextColumnId, deletedAt: null, NOT: { id: card.id } },
    orderBy: { position: 'asc' },
    select: { position: true },
  });
  const position = computeCardPosition({
    orderedSiblingPositions: siblings.map((s) => s.position),
    targetIndex: siblings.length,
  });

  // PRD §8.2: when entering the LAST user column, stamp `moved_to_last_at`
  // so the 30-day archive job (D.6) has a reference point.
  const movedToLastUserCol =
    !columns.find((c) => c.id === outcome.nextColumnId)?.isBlockedSystem &&
    isLastUserColumn(outcome.nextColumnId, domainColumns);

  await prisma.card.update({
    where: { id: card.id },
    data: {
      columnId: outcome.nextColumnId,
      position,
      ...(movedToLastUserCol ? { movedToLastAt: new Date() } : {}),
    },
  });

  return { ok: true, moved: true, newColumnId: outcome.nextColumnId };
}

function isLastUserColumn(columnId: string, columns: readonly DomainColumn[]): boolean {
  const ordered = [...columns]
    .filter((c) => !c.isBlockedSystem)
    .sort((a, b) => a.position - b.position);
  return ordered[ordered.length - 1]?.id === columnId;
}
