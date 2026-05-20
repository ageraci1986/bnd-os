/**
 * Domain rules for Kanban (PRD §8.2, §8.3).
 * No dependency on Prisma/Next. Used by both server actions and tests.
 */

import { isDueDateOverdue } from '../dates/index';

export const AUTO_ADVANCE_DELAY_MS = 1800 as const;
export const ARCHIVE_DONE_AFTER_DAYS = 30 as const;

export type ColumnId = string;
export type CardId = string;

export interface Column {
  readonly id: ColumnId;
  readonly name: string;
  /** Position is sparse to allow reordering without renumbering everything. */
  readonly position: number;
  readonly isBlockedSystem: boolean;
}

export interface Card {
  readonly id: CardId;
  readonly columnId: ColumnId;
  readonly previousColumnId: ColumnId | null;
  readonly dueDate: Date | null;
  readonly checklistTotal: number;
  readonly checklistDone: number;
  readonly archivedAt: Date | null;
}

/* ---------- Helpers on column ordering ---------- */

export function sortColumns(columns: readonly Column[]): Column[] {
  return [...columns].sort((a, b) => a.position - b.position);
}

export function getNextColumn(current: Column, columns: readonly Column[]): Column | null {
  const ordered = sortColumns(columns).filter((c) => !c.isBlockedSystem);
  const idx = ordered.findIndex((c) => c.id === current.id);
  if (idx < 0 || idx === ordered.length - 1) return null;
  return ordered[idx + 1] ?? null;
}

export function isLastUserColumn(column: Column, columns: readonly Column[]): boolean {
  const ordered = sortColumns(columns).filter((c) => !c.isBlockedSystem);
  return ordered[ordered.length - 1]?.id === column.id;
}

/* ---------- Auto-progress (PRD §8.2) ---------- */

export type AutoAdvanceOutcome =
  | {
      readonly action: 'none';
      readonly reason: 'checklist_incomplete' | 'last_column' | 'in_blocked' | 'no_checklist';
    }
  | { readonly action: 'advance'; readonly nextColumnId: ColumnId };

export function evaluateAutoAdvance(
  card: Card,
  currentColumn: Column,
  columns: readonly Column[],
): AutoAdvanceOutcome {
  if (currentColumn.isBlockedSystem) {
    return { action: 'none', reason: 'in_blocked' };
  }
  if (card.checklistTotal === 0) {
    return { action: 'none', reason: 'no_checklist' };
  }
  if (card.checklistDone < card.checklistTotal) {
    return { action: 'none', reason: 'checklist_incomplete' };
  }
  const next = getNextColumn(currentColumn, columns);
  if (!next) {
    return { action: 'none', reason: 'last_column' };
  }
  return { action: 'advance', nextColumnId: next.id };
}

/* ---------- Blocked column (PRD §8.3) ---------- */

export function shouldMoveToBlocked(card: Card, now: Date, columns: readonly Column[]): boolean {
  if (card.archivedAt !== null) return false;
  if (card.dueDate === null) return false;
  if (!isDueDateOverdue(card.dueDate, now)) return false;

  const current = columns.find((c) => c.id === card.columnId);
  if (!current) return false;
  if (current.isBlockedSystem) return false;
  if (isLastUserColumn(current, columns)) return false;
  return true;
}

export function shouldRestoreFromBlocked(card: Card, now: Date, currentColumn: Column): boolean {
  if (!currentColumn.isBlockedSystem) return false;
  if (card.previousColumnId === null) return false;
  if (card.dueDate === null) return true; // due date cleared → unblock
  return !isDueDateOverdue(card.dueDate, now);
}

/* ---------- Archiving (decision: opt-in per project, ADR 0001) ---------- */

export function isArchiveCandidate(
  card: Card,
  now: Date,
  movedToDoneAt: Date,
  archiveOptIn: boolean,
): boolean {
  if (!archiveOptIn) return false;
  if (card.archivedAt !== null) return false;
  const ageDays = (now.getTime() - movedToDoneAt.getTime()) / (1000 * 60 * 60 * 24);
  return ageDays >= ARCHIVE_DONE_AFTER_DAYS;
}
