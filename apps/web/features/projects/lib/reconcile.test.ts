import { describe, expect, it, vi, beforeEach } from 'vitest';

const { cardFindMany, cardUpdate, cardUpdateMany, columnFindMany } = vi.hoisted(() => ({
  cardFindMany: vi.fn(),
  cardUpdate: vi.fn(),
  cardUpdateMany: vi.fn(),
  columnFindMany: vi.fn(),
}));

vi.mock('@nexushub/db', () => ({
  prisma: {
    card: { findMany: cardFindMany, update: cardUpdate, updateMany: cardUpdateMany },
    column: { findMany: columnFindMany },
  },
}));

import { applyAutoArchive, reconcileOverdueRouting } from './reconcile';

const TODO = '00000000-0000-4000-8000-000000000001';
const DOING = '00000000-0000-4000-8000-000000000002';
const DONE = '00000000-0000-4000-8000-000000000003';
const BLOCKED = '00000000-0000-4000-8000-000000000099';
const PROJECT = 'p-1';

const COLUMNS = [
  { id: TODO, projectId: PROJECT, name: 'À faire', position: 1024, isBlockedSystem: false },
  { id: DOING, projectId: PROJECT, name: 'En cours', position: 2048, isBlockedSystem: false },
  { id: DONE, projectId: PROJECT, name: 'Done', position: 3072, isBlockedSystem: false },
  { id: BLOCKED, projectId: PROJECT, name: 'Bloqué', position: 9999, isBlockedSystem: true },
];

const NOW = new Date('2026-04-30T12:00:00Z');
const PAST = new Date('2026-04-01T00:00:00Z');
const FUTURE = new Date('2026-05-15T00:00:00Z');

beforeEach(() => {
  cardFindMany.mockReset();
  cardUpdate.mockReset();
  cardUpdateMany.mockReset();
  columnFindMany.mockReset();
});

describe('reconcileOverdueRouting', () => {
  it('moves overdue cards to Bloqué stamping previousColumnId', async () => {
    cardFindMany
      // 1st call: cards-in-scope
      .mockResolvedValueOnce([
        {
          id: 'c1',
          columnId: DOING,
          previousColumnId: null,
          dueDate: PAST,
          archivedAt: null,
          projectId: PROJECT,
        },
      ])
      // 2nd call: siblings of target column
      .mockResolvedValueOnce([{ position: 2000 }]);
    columnFindMany.mockResolvedValueOnce(COLUMNS);

    const result = await reconcileOverdueRouting('ws-1', { now: NOW });

    expect(result.blocked).toBe(1);
    expect(result.restored).toBe(0);
    expect(cardUpdate).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: expect.objectContaining({
        columnId: BLOCKED,
        previousColumnId: DOING,
      }),
    });
  });

  it('does NOT block cards in the last user column', async () => {
    cardFindMany.mockResolvedValueOnce([
      {
        id: 'c1',
        columnId: DONE, // last user column
        previousColumnId: null,
        dueDate: PAST,
        archivedAt: null,
        projectId: PROJECT,
      },
    ]);
    columnFindMany.mockResolvedValueOnce(COLUMNS);

    const result = await reconcileOverdueRouting('ws-1', { now: NOW });

    expect(result.blocked).toBe(0);
    expect(cardUpdate).not.toHaveBeenCalled();
  });

  it('restores blocked cards whose dueDate moved into the future', async () => {
    cardFindMany
      .mockResolvedValueOnce([
        {
          id: 'c1',
          columnId: BLOCKED,
          previousColumnId: TODO,
          dueDate: FUTURE,
          archivedAt: null,
          projectId: PROJECT,
        },
      ])
      .mockResolvedValueOnce([{ position: 1024 }]);
    columnFindMany.mockResolvedValueOnce(COLUMNS);

    const result = await reconcileOverdueRouting('ws-1', { now: NOW });

    expect(result.restored).toBe(1);
    expect(cardUpdate).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: expect.objectContaining({
        columnId: TODO,
        previousColumnId: null,
      }),
    });
  });

  it('is idempotent — already-blocked cards with stale dates do nothing on second pass', async () => {
    cardFindMany.mockResolvedValueOnce([
      {
        id: 'c1',
        columnId: BLOCKED,
        previousColumnId: DOING,
        dueDate: PAST, // still overdue → no restore
        archivedAt: null,
        projectId: PROJECT,
      },
    ]);
    columnFindMany.mockResolvedValueOnce(COLUMNS);

    const result = await reconcileOverdueRouting('ws-1', { now: NOW });

    expect(result.blocked).toBe(0);
    expect(result.restored).toBe(0);
    expect(cardUpdate).not.toHaveBeenCalled();
  });

  it('returns zeros early when no cards are in scope', async () => {
    cardFindMany.mockResolvedValueOnce([]);

    const result = await reconcileOverdueRouting('ws-1');

    expect(result).toEqual({ blocked: 0, restored: 0 });
    expect(columnFindMany).not.toHaveBeenCalled();
  });
});

describe('applyAutoArchive', () => {
  it('archives cards in the last user column past the 30-day cutoff', async () => {
    cardFindMany.mockResolvedValueOnce([{ id: 'c1', columnId: DONE, projectId: PROJECT }]);
    columnFindMany.mockResolvedValueOnce(COLUMNS.filter((c) => !c.isBlockedSystem));

    const result = await applyAutoArchive('ws-1', { now: NOW });

    expect(result.archived).toBe(1);
    expect(cardUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ['c1'] } },
      data: { archivedAt: NOW },
    });
  });

  it('skips cards bumped back out of the last column since the trigger stamped them', async () => {
    cardFindMany.mockResolvedValueOnce([
      // The Prisma where clause might still match (column is not blocked,
      // movedToLastAt is past) — defence-in-depth filters it out.
      { id: 'c1', columnId: DOING, projectId: PROJECT },
    ]);
    columnFindMany.mockResolvedValueOnce(COLUMNS.filter((c) => !c.isBlockedSystem));

    const result = await applyAutoArchive('ws-1', { now: NOW });

    expect(result.archived).toBe(0);
    expect(cardUpdateMany).not.toHaveBeenCalled();
  });

  it('returns zero when no candidates match the time + opt-in filters', async () => {
    cardFindMany.mockResolvedValueOnce([]);

    const result = await applyAutoArchive('ws-1', { now: NOW });

    expect(result).toEqual({ archived: 0 });
    expect(columnFindMany).not.toHaveBeenCalled();
  });
});
