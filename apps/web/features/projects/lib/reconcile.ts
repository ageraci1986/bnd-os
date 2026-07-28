/**
 * Reconcile-on-read implementation of PRD §8.3 (auto-Bloqué) and ADR 0001 #2
 * (archivage 30j opt-in).
 *
 * Instead of a periodic cron, the kanban / calendar / overview routes call
 * these reconcile helpers right before they fetch the cards they're about to
 * render. The rules are deterministic and idempotent, so running them inline
 * always converges the DB to the correct state at the moment the user looks.
 *
 * Trade-off: a project nobody opens stays "stale" — the metrics on the
 * sidebar / overview do reconcile on load though, so any user landing on
 * the workspace will see fresh state. Since Plan 3b Task 5, the hourly
 * Inngest cron (`lib/inngest/functions/blocked-cards-scan.ts`) covers the
 * push side (CLAUDE.md §6.3) — both paths coexist, and BOTH create the
 * `agent_card_blocked` notices via the shared `notifyNewlyBlocked` helper
 * (dedup handled by the notice core, so no doubles across paths).
 */
import 'server-only';
import { prisma } from '@nexushub/db';
import { notifyNewlyBlocked } from '@/features/notifications/lib/blocked-card-notices';
import { shouldRunReconcile } from './reconcile-throttle';
import {
  computeCardPosition,
  shouldMoveToBlocked,
  shouldRestoreFromBlocked,
  type Card as DomainCard,
  type Column as DomainColumn,
} from '@nexushub/domain';

const ARCHIVE_DAYS = 30;

/**
 * Apply the auto-Bloqué / auto-restore rules to every card in scope. Scope
 * is the workspace, optionally narrowed to one or more projects.
 *
 * Returns a count summary so callers can log/announce the reconcile.
 */
export interface NewlyBlockedCard {
  readonly cardId: string;
  readonly title: string;
  readonly projectId: string;
}

export async function reconcileOverdueRouting(
  workspaceId: string,
  options: { readonly projectIds?: readonly string[]; readonly now?: Date } = {},
): Promise<{
  readonly blocked: number;
  readonly restored: number;
  readonly newlyBlocked: readonly NewlyBlockedCard[];
}> {
  const now = options.now ?? new Date();

  const baseProjectFilter = {
    deletedAt: null,
    archivedAt: null,
    ...(options.projectIds && options.projectIds.length > 0
      ? { id: { in: [...options.projectIds] } }
      : {}),
  };

  const cards = await prisma.card.findMany({
    where: {
      workspaceId,
      deletedAt: null,
      archivedAt: null,
      project: baseProjectFilter,
    },
    select: {
      id: true,
      columnId: true,
      previousColumnId: true,
      dueDate: true,
      archivedAt: true,
      projectId: true,
      title: true,
    },
  });
  if (cards.length === 0) return { blocked: 0, restored: 0, newlyBlocked: [] };

  const projectIds = Array.from(new Set(cards.map((c) => c.projectId)));
  const columns = await prisma.column.findMany({
    where: { projectId: { in: projectIds } },
    select: { id: true, projectId: true, name: true, position: true, isBlockedSystem: true },
  });

  const colsByProject = new Map<string, DomainColumn[]>();
  for (const col of columns) {
    const list = colsByProject.get(col.projectId);
    const domainCol: DomainColumn = {
      id: col.id,
      name: col.name,
      position: col.position,
      isBlockedSystem: col.isBlockedSystem,
    };
    if (list) list.push(domainCol);
    else colsByProject.set(col.projectId, [domainCol]);
  }

  let blocked = 0;
  let restored = 0;
  const newlyBlocked: NewlyBlockedCard[] = [];

  for (const card of cards) {
    const projectColumns = colsByProject.get(card.projectId) ?? [];
    const currentColumn = projectColumns.find((c) => c.id === card.columnId);
    if (!currentColumn) continue;

    const domainCard: DomainCard = {
      id: card.id,
      columnId: card.columnId,
      previousColumnId: card.previousColumnId,
      dueDate: card.dueDate,
      archivedAt: card.archivedAt,
      checklistTotal: 0,
      checklistDone: 0,
    };

    if (currentColumn.isBlockedSystem) {
      if (
        shouldRestoreFromBlocked(domainCard, now, currentColumn) &&
        card.previousColumnId !== null
      ) {
        await moveCard(card.id, card.previousColumnId, null);
        restored++;
      }
      continue;
    }

    if (shouldMoveToBlocked(domainCard, now, projectColumns)) {
      const blockedCol = projectColumns.find((c) => c.isBlockedSystem);
      if (!blockedCol) continue;
      await moveCard(card.id, blockedCol.id, card.columnId);
      blocked++;
      newlyBlocked.push({ cardId: card.id, title: card.title, projectId: card.projectId });
    }
  }

  return { blocked, restored, newlyBlocked };
}

/**
 * Helper: relocate a card to `targetColumnId`, computing the bottom-of-column
 * position from the current siblings. Optionally stamp / clear the
 * `previousColumnId` so the card knows where to come back to (block) or
 * forgets it (restore).
 */
async function moveCard(
  cardId: string,
  targetColumnId: string,
  previousColumnId: string | null,
): Promise<void> {
  const siblings = await prisma.card.findMany({
    where: { columnId: targetColumnId, deletedAt: null, NOT: { id: cardId } },
    orderBy: { position: 'asc' },
    select: { position: true },
  });
  const position = computeCardPosition({
    orderedSiblingPositions: siblings.map((s) => s.position),
    targetIndex: siblings.length,
  });
  await prisma.card.update({
    where: { id: cardId },
    data: {
      columnId: targetColumnId,
      position,
      previousColumnId: previousColumnId,
    },
  });
}

/**
 * ADR 0001 #2: opt-in archiving 30 days after a card lands in the LAST user
 * column. We only act on projects that turned `archiveAutoDone` on, and we
 * use the trigger-maintained `movedToLastAt` timestamp as the reference.
 *
 * Idempotent — already-archived rows are filtered out by `archivedAt: null`.
 */
export async function applyAutoArchive(
  workspaceId: string,
  options: { readonly projectIds?: readonly string[]; readonly now?: Date } = {},
): Promise<{ readonly archived: number }> {
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - ARCHIVE_DAYS * 24 * 60 * 60 * 1000);

  const candidates = await prisma.card.findMany({
    where: {
      workspaceId,
      deletedAt: null,
      archivedAt: null,
      movedToLastAt: { not: null, lt: cutoff },
      project: {
        archiveAutoDone: true,
        deletedAt: null,
        archivedAt: null,
        ...(options.projectIds && options.projectIds.length > 0
          ? { id: { in: [...options.projectIds] } }
          : {}),
      },
      column: { isBlockedSystem: false },
    },
    select: { id: true, columnId: true, projectId: true },
  });
  if (candidates.length === 0) return { archived: 0 };

  // Defence in depth: reconfirm each card is actually in the LAST user column
  // (it could have been bumped back since the trigger stamped it).
  const projectIds = Array.from(new Set(candidates.map((c) => c.projectId)));
  const columns = await prisma.column.findMany({
    where: { projectId: { in: projectIds }, isBlockedSystem: false },
    select: { id: true, projectId: true, position: true },
  });
  const lastColByProject = new Map<string, string>();
  for (const col of columns) {
    const existing = lastColByProject.get(col.projectId);
    if (existing === undefined) {
      lastColByProject.set(col.projectId, col.id);
      continue;
    }
    const existingPos = columns.find((c) => c.id === existing)?.position ?? -1;
    if (col.position > existingPos) lastColByProject.set(col.projectId, col.id);
  }

  const toArchive = candidates.filter((c) => lastColByProject.get(c.projectId) === c.columnId);
  if (toArchive.length === 0) return { archived: 0 };

  await prisma.card.updateMany({
    where: { id: { in: toArchive.map((c) => c.id) } },
    data: { archivedAt: now },
  });
  return { archived: toArchive.length };
}

/**
 * Convenience: run both reconcile passes in one go for a route entry point.
 *
 * ALSO the read-path trigger for the `agent_card_blocked` notices (grouped
 * review Tasks 4-6, fix 1): in an ACTIVE workspace the read path (throttled
 * 60 s) blocks overdue cards long BEFORE the hourly cron ticks — without
 * notifying here, the cron's `newlyBlocked` would almost always be empty and
 * no notice would ever be created. Best-effort by design: a notice failure
 * must NEVER break a page load, hence the try/catch with a label-only
 * `console.warn` (no error object — CLAUDE.md §4.7, no PII / query params in
 * logs). Cross-path dedup is the notice core's job (unread notice per
 * (userId, kind, ref=cardId)).
 */
export async function reconcileBeforeRead(
  workspaceId: string,
  options: { readonly projectIds?: readonly string[]; readonly now?: Date } = {},
): Promise<{
  readonly blocked: number;
  readonly restored: number;
  readonly archived: number;
}> {
  if (!shouldRunReconcile(workspaceId)) {
    return { blocked: 0, restored: 0, archived: 0 };
  }
  const [routing, archive] = await Promise.all([
    reconcileOverdueRouting(workspaceId, options),
    applyAutoArchive(workspaceId, options),
  ]);
  if (routing.newlyBlocked.length > 0) {
    try {
      await notifyNewlyBlocked(workspaceId, routing.newlyBlocked);
    } catch {
      console.warn('[reconcile] notifyNewlyBlocked failed');
    }
  }
  return { ...routing, ...archive };
}
