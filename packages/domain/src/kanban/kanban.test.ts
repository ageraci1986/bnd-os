import { describe, expect, it } from 'vitest';
import {
  AUTO_ADVANCE_DELAY_MS,
  ARCHIVE_DONE_AFTER_DAYS,
  evaluateAutoAdvance,
  getNextColumn,
  isArchiveCandidate,
  isLastUserColumn,
  shouldMoveToBlocked,
  shouldRestoreFromBlocked,
  type Card,
  type Column,
} from './index.js';

const cols: Column[] = [
  { id: 'todo', name: 'À faire', position: 1, isBlockedSystem: false },
  { id: 'doing', name: 'En cours', position: 2, isBlockedSystem: false },
  { id: 'done', name: 'Done', position: 3, isBlockedSystem: false },
  { id: 'blocked', name: 'Bloqué', position: 999, isBlockedSystem: true },
];

const baseCard: Card = {
  id: 'c1',
  columnId: 'doing',
  previousColumnId: null,
  dueDate: null,
  checklistTotal: 0,
  checklistDone: 0,
  archivedAt: null,
};

describe('constants', () => {
  it('keeps the 1.8s auto-advance delay (PRD §8.2)', () => {
    expect(AUTO_ADVANCE_DELAY_MS).toBe(1800);
  });
  it('keeps the 30-day archive horizon (ADR 0001 §2)', () => {
    expect(ARCHIVE_DONE_AFTER_DAYS).toBe(30);
  });
});

describe('getNextColumn', () => {
  it('returns the next user column', () => {
    expect(getNextColumn(cols[0]!, cols)?.id).toBe('doing');
  });
  it('returns null on the last user column (Blocked is excluded)', () => {
    expect(getNextColumn(cols[2]!, cols)).toBeNull();
  });
});

describe('isLastUserColumn', () => {
  it('detects last user column ignoring system Blocked', () => {
    expect(isLastUserColumn(cols[2]!, cols)).toBe(true);
    expect(isLastUserColumn(cols[1]!, cols)).toBe(false);
  });
});

describe('evaluateAutoAdvance', () => {
  it('does nothing when checklist incomplete', () => {
    const card: Card = { ...baseCard, checklistTotal: 3, checklistDone: 2 };
    expect(evaluateAutoAdvance(card, cols[1]!, cols)).toEqual({
      action: 'none',
      reason: 'checklist_incomplete',
    });
  });
  it('does nothing when checklist is empty', () => {
    expect(evaluateAutoAdvance(baseCard, cols[1]!, cols)).toEqual({
      action: 'none',
      reason: 'no_checklist',
    });
  });
  it('advances to next column when checklist complete', () => {
    const card: Card = { ...baseCard, checklistTotal: 3, checklistDone: 3 };
    expect(evaluateAutoAdvance(card, cols[1]!, cols)).toEqual({
      action: 'advance',
      nextColumnId: 'done',
    });
  });
  it('does nothing when in last user column (PRD §8.2 — stays for archiving)', () => {
    const card: Card = { ...baseCard, columnId: 'done', checklistTotal: 1, checklistDone: 1 };
    expect(evaluateAutoAdvance(card, cols[2]!, cols)).toEqual({
      action: 'none',
      reason: 'last_column',
    });
  });
  it('does nothing when card is in the Blocked system column', () => {
    const card: Card = { ...baseCard, columnId: 'blocked', checklistTotal: 1, checklistDone: 1 };
    expect(evaluateAutoAdvance(card, cols[3]!, cols)).toEqual({
      action: 'none',
      reason: 'in_blocked',
    });
  });
});

describe('shouldMoveToBlocked (PRD §8.3)', () => {
  const now = new Date('2026-04-15T12:00:00Z');
  it('moves overdue card from a user column', () => {
    const card: Card = {
      ...baseCard,
      columnId: 'doing',
      dueDate: new Date('2026-04-14T10:00:00Z'),
    };
    expect(shouldMoveToBlocked(card, now, cols)).toBe(true);
  });
  it('does not move card already in last column (Done)', () => {
    const card: Card = {
      ...baseCard,
      columnId: 'done',
      dueDate: new Date('2026-04-14T10:00:00Z'),
    };
    expect(shouldMoveToBlocked(card, now, cols)).toBe(false);
  });
  it('does not move card without due date', () => {
    expect(shouldMoveToBlocked(baseCard, now, cols)).toBe(false);
  });
  it('does not move card with future due date', () => {
    const card: Card = {
      ...baseCard,
      columnId: 'doing',
      dueDate: new Date('2026-05-01T00:00:00Z'),
    };
    expect(shouldMoveToBlocked(card, now, cols)).toBe(false);
  });
  it('does not move archived cards', () => {
    const card: Card = {
      ...baseCard,
      columnId: 'doing',
      dueDate: new Date('2026-04-14T10:00:00Z'),
      archivedAt: new Date('2026-04-15T11:00:00Z'),
    };
    expect(shouldMoveToBlocked(card, now, cols)).toBe(false);
  });
});

describe('shouldRestoreFromBlocked (PRD §8.3 — repousser sortie auto)', () => {
  const now = new Date('2026-04-15T12:00:00Z');
  const blocked = cols[3]!;
  it('restores when due date is pushed into the future', () => {
    const card: Card = {
      ...baseCard,
      columnId: 'blocked',
      previousColumnId: 'doing',
      dueDate: new Date('2026-04-20T00:00:00Z'),
    };
    expect(shouldRestoreFromBlocked(card, now, blocked)).toBe(true);
  });
  it('restores when due date is cleared', () => {
    const card: Card = {
      ...baseCard,
      columnId: 'blocked',
      previousColumnId: 'doing',
      dueDate: null,
    };
    expect(shouldRestoreFromBlocked(card, now, blocked)).toBe(true);
  });
  it('does not restore when no previous column known', () => {
    const card: Card = {
      ...baseCard,
      columnId: 'blocked',
      previousColumnId: null,
      dueDate: new Date('2026-04-20T00:00:00Z'),
    };
    expect(shouldRestoreFromBlocked(card, now, blocked)).toBe(false);
  });
});

describe('isArchiveCandidate (ADR 0001 — opt-in 30j)', () => {
  const now = new Date('2026-04-15T00:00:00Z');
  it('returns false when project did not opt-in', () => {
    expect(isArchiveCandidate(baseCard, now, new Date('2026-01-01'), false)).toBe(false);
  });
  it('returns true at exactly 30 days', () => {
    const movedAt = new Date(now.getTime() - 30 * 86400 * 1000);
    expect(isArchiveCandidate(baseCard, now, movedAt, true)).toBe(true);
  });
  it('returns false at 29 days', () => {
    const movedAt = new Date(now.getTime() - 29 * 86400 * 1000);
    expect(isArchiveCandidate(baseCard, now, movedAt, true)).toBe(false);
  });
  it('returns false if already archived', () => {
    const movedAt = new Date(now.getTime() - 60 * 86400 * 1000);
    const card: Card = { ...baseCard, archivedAt: now };
    expect(isArchiveCandidate(card, now, movedAt, true)).toBe(false);
  });
});
