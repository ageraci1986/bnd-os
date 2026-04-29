import { describe, expect, it, vi, beforeEach } from 'vitest';

const {
  cardFindFirst,
  cardUpdate,
  cardFindMany,
  columnFindMany,
  requireUserMock,
  revalidatePathMock,
} = vi.hoisted(() => ({
  cardFindFirst: vi.fn(),
  cardUpdate: vi.fn(),
  cardFindMany: vi.fn(),
  columnFindMany: vi.fn(),
  requireUserMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock('@nexushub/db', () => ({
  prisma: {
    card: { findFirst: cardFindFirst, update: cardUpdate, findMany: cardFindMany },
    column: { findMany: columnFindMany },
  },
}));
vi.mock('@/lib/auth', () => ({ requireUser: requireUserMock }));
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));

import { updateCardDueDate } from './update-card-due-date';

const VALID_CARD = '11111111-1111-4111-8111-111111111111';
const TODO = '00000000-0000-4000-8000-000000000001';
const DOING = '00000000-0000-4000-8000-000000000002';
const DONE = '00000000-0000-4000-8000-000000000003';
const BLOCKED = '00000000-0000-4000-8000-000000000099';

const COLUMNS = [
  { id: TODO, name: 'À faire', position: 1024, isBlockedSystem: false },
  { id: DOING, name: 'En cours', position: 2048, isBlockedSystem: false },
  { id: DONE, name: 'Done', position: 3072, isBlockedSystem: false },
  { id: BLOCKED, name: 'Bloqué', position: 9999, isBlockedSystem: true },
];

beforeEach(() => {
  cardFindFirst.mockReset();
  cardUpdate.mockReset();
  cardFindMany.mockReset();
  columnFindMany.mockReset();
  requireUserMock.mockReset();
  revalidatePathMock.mockReset();

  requireUserMock.mockResolvedValue({ userId: 'u1', workspaceId: 'ws-1', role: 'member' });
  columnFindMany.mockResolvedValue(COLUMNS);
  cardFindMany.mockResolvedValue([{ position: 1024 }]); // siblings in target column
  cardUpdate.mockResolvedValue({ id: VALID_CARD });
});

describe('updateCardDueDate (PRD §8.3 auto-routing)', () => {
  it('persists the new date and does NOT route when the date is in the future', async () => {
    cardFindFirst.mockResolvedValue({
      id: VALID_CARD,
      projectId: 'p1',
      columnId: DOING,
      previousColumnId: null,
      dueDate: null,
      archivedAt: null,
    });
    const futureIso = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);

    const result = await updateCardDueDate({ cardId: VALID_CARD, dueDate: futureIso });

    expect(result.autoBlocked).toBe(false);
    expect(result.autoUnblocked).toBe(false);
    expect(result.newColumnId).toBe(DOING);
    // First call updates the date; no routing call beyond it.
    expect(cardUpdate).toHaveBeenCalledTimes(1);
  });

  it('routes a not-yet-blocked card with a past date to Bloqué + stamps previousColumnId', async () => {
    cardFindFirst.mockResolvedValue({
      id: VALID_CARD,
      projectId: 'p1',
      columnId: DOING,
      previousColumnId: null,
      dueDate: null,
      archivedAt: null,
    });
    const pastIso = '2020-01-01';

    const result = await updateCardDueDate({ cardId: VALID_CARD, dueDate: pastIso });

    expect(result.autoBlocked).toBe(true);
    expect(result.newColumnId).toBe(BLOCKED);
    // Two updates: persist the date, then move to Bloqué.
    expect(cardUpdate).toHaveBeenCalledTimes(2);
    const moveCall = cardUpdate.mock.calls[1]![0] as {
      where: { id: string };
      data: { columnId: string; previousColumnId: string };
    };
    expect(moveCall.data.columnId).toBe(BLOCKED);
    expect(moveCall.data.previousColumnId).toBe(DOING);
  });

  it('does NOT auto-block when the card is already in the last user column', async () => {
    cardFindFirst.mockResolvedValue({
      id: VALID_CARD,
      projectId: 'p1',
      columnId: DONE,
      previousColumnId: null,
      dueDate: null,
      archivedAt: null,
    });
    const result = await updateCardDueDate({ cardId: VALID_CARD, dueDate: '2020-01-01' });
    expect(result.autoBlocked).toBe(false);
    expect(result.newColumnId).toBe(DONE);
  });

  it('restores a blocked card to its previousColumnId when the date is cleared', async () => {
    cardFindFirst.mockResolvedValue({
      id: VALID_CARD,
      projectId: 'p1',
      columnId: BLOCKED,
      previousColumnId: DOING,
      dueDate: new Date('2020-01-01'),
      archivedAt: null,
    });

    const result = await updateCardDueDate({ cardId: VALID_CARD, dueDate: null });

    expect(result.autoUnblocked).toBe(true);
    expect(result.newColumnId).toBe(DOING);
    expect(cardUpdate).toHaveBeenCalledTimes(2);
    const restoreCall = cardUpdate.mock.calls[1]![0] as {
      data: { columnId: string; previousColumnId: null };
    };
    expect(restoreCall.data.columnId).toBe(DOING);
    expect(restoreCall.data.previousColumnId).toBeNull();
  });

  it('restores a blocked card when the date is pushed into the future', async () => {
    cardFindFirst.mockResolvedValue({
      id: VALID_CARD,
      projectId: 'p1',
      columnId: BLOCKED,
      previousColumnId: TODO,
      dueDate: new Date('2020-01-01'),
      archivedAt: null,
    });
    const futureIso = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);

    const result = await updateCardDueDate({ cardId: VALID_CARD, dueDate: futureIso });

    expect(result.autoUnblocked).toBe(true);
    expect(result.newColumnId).toBe(TODO);
  });
});
