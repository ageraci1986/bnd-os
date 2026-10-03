import { describe, expect, it, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  txMock: vi.fn(),
  columnFindMany: vi.fn(),
  cardCount: vi.fn(),
}));

vi.mock('@nexushub/db', () => ({
  prisma: {
    $transaction: m.txMock,
    column: { findMany: m.columnFindMany },
    card: { count: m.cardCount },
  },
}));

import { getMyCardsMetrics } from './my-cards';

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset();
  m.cardCount.mockImplementation((args: unknown) => args);
});

describe('getMyCardsMetrics', () => {
  it('counts open + overdue cards assigned to the user, excluding last columns', async () => {
    m.columnFindMany.mockResolvedValue([
      { id: 'c1', projectId: 'p1', position: 1, isBlockedSystem: false, name: 'A' },
      { id: 'c2', projectId: 'p1', position: 2, isBlockedSystem: false, name: 'B' },
      { id: 'cb', projectId: 'p1', position: 9, isBlockedSystem: true, name: 'Bloqué' },
    ]);
    m.txMock.mockResolvedValue([5, 2]);

    const res = await getMyCardsMetrics({ workspaceId: 'ws-1', userId: 'u-1' });

    expect(res).toEqual({ open: 5, overdue: 2 });
    const [openArgs, overdueArgs] = m.txMock.mock.calls[0]![0] as [
      { where: Record<string, unknown> },
      { where: Record<string, unknown> },
    ];
    expect(openArgs.where).toMatchObject({
      workspaceId: 'ws-1',
      deletedAt: null,
      archivedAt: null,
      assignees: { some: { userId: 'u-1' } },
      columnId: { notIn: ['c2'] },
    });
    expect(overdueArgs.where).toMatchObject({ dueDate: { lt: expect.any(Date) } });
  });

  it('applies the client filter to columns and cards', async () => {
    m.columnFindMany.mockResolvedValue([]);
    m.txMock.mockResolvedValue([0, 0]);
    await getMyCardsMetrics({ workspaceId: 'ws-1', userId: 'u-1', clientId: 'cl-1' });
    expect(m.columnFindMany.mock.calls[0]![0].where.project).toMatchObject({ clientId: 'cl-1' });
    const [openArgs] = m.txMock.mock.calls[0]![0] as [
      { where: { project: unknown; columnId?: unknown } },
    ];
    expect(openArgs.where.project).toMatchObject({ clientId: 'cl-1' });
    expect(openArgs.where.columnId).toBeUndefined();
  });
});
