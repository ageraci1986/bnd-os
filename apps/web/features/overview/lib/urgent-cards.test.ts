import { describe, expect, it, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  txMock: vi.fn(),
  columnFindMany: vi.fn(),
  cardFindMany: vi.fn(),
  cardCount: vi.fn(),
}));

vi.mock('@nexushub/db', () => ({
  prisma: {
    $transaction: m.txMock,
    column: { findMany: m.columnFindMany },
    card: { findMany: m.cardFindMany, count: m.cardCount },
  },
}));

import { getUrgentCards, urgencyOf } from './urgent-cards';

// 13 nov. 2026, 10:00 à Paris (UTC+1) → minuit Paris = 12 nov. 23:00 UTC.
const NOW = new Date('2026-11-13T09:00:00Z');
const row = {
  id: 'k1',
  shortRef: 124,
  title: 'Valider la DA',
  dueDate: new Date('2026-11-11T12:00:00Z'),
  projectId: 'p1',
  column: { isBlockedSystem: true },
  project: { name: 'Campagne Été', client: { name: 'Acme', colorToken: 'c-acme' } },
};

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset();
  m.cardFindMany.mockImplementation((args: unknown) => args);
  m.cardCount.mockImplementation((args: unknown) => args);
  m.columnFindMany.mockResolvedValue([
    { id: 'c1', projectId: 'p1', position: 1, isBlockedSystem: false, name: 'A' },
    { id: 'c2', projectId: 'p1', position: 2, isBlockedSystem: false, name: 'Livré' },
    { id: 'cb', projectId: 'p1', position: 9, isBlockedSystem: true, name: 'Bloqué' },
  ]);
  m.txMock.mockResolvedValue([[row], 5, 3]);
});

type Where = Record<string, unknown>;
const calls = () =>
  m.txMock.mock.calls[0]![0] as [
    { where: Where; take: number },
    { where: Where },
    { where: Where },
  ];

describe('getUrgentCards', () => {
  it('lists open cards that are blocked or due by tomorrow, excluding the last column', async () => {
    const res = await getUrgentCards({ workspaceId: 'ws-1', userId: 'u-1', now: NOW });

    expect(res.dueToday).toBe(5);
    expect(res.blocked).toBe(3);
    expect(res.items).toEqual([
      {
        id: 'k1',
        shortRef: 124,
        title: 'Valider la DA',
        dueDate: row.dueDate,
        blocked: true,
        projectId: 'p1',
        projectName: 'Campagne Été',
        clientName: 'Acme',
        clientColorToken: 'c-acme',
      },
    ]);

    const [list, today, blocked] = calls();
    expect(list.take).toBe(5);
    expect(list.where).toMatchObject({
      workspaceId: 'ws-1',
      deletedAt: null,
      archivedAt: null,
      columnId: { notIn: ['c2'] },
      OR: [
        { column: { isBlockedSystem: true } },
        { dueDate: { lt: new Date('2026-11-14T23:00:00Z') } },
      ],
    });
    expect(list.where['assignees']).toBeUndefined();
    expect(today.where).toMatchObject({
      column: { isBlockedSystem: false },
      dueDate: { gte: new Date('2026-11-12T23:00:00Z'), lt: new Date('2026-11-13T23:00:00Z') },
    });
    expect(blocked.where).toMatchObject({ column: { isBlockedSystem: true } });
  });

  it('restricts the list (not the counters) to my cards when mineOnly', async () => {
    await getUrgentCards({ workspaceId: 'ws-1', userId: 'u-1', mineOnly: true, now: NOW });
    const [list, today, blocked] = calls();
    expect(list.where).toMatchObject({ assignees: { some: { userId: 'u-1' } } });
    expect(today.where['assignees']).toBeUndefined();
    expect(blocked.where['assignees']).toBeUndefined();
  });

  it('applies the client filter and the user scope to every query', async () => {
    await getUrgentCards({
      workspaceId: 'ws-1',
      userId: 'u-1',
      clientId: 'cl-1',
      scope: { kind: 'restricted', clientIds: ['cl-1'], projectIds: [] },
      now: NOW,
    });
    expect(m.columnFindMany.mock.calls[0]![0].where.project).toMatchObject({ clientId: 'cl-1' });
    for (const q of calls()) {
      expect(q.where['project']).toMatchObject({ workspaceId: 'ws-1', clientId: 'cl-1' });
    }
  });
});

describe('urgencyOf', () => {
  const at = (iso: string) => new Date(iso);
  it('reports blocked cards with their lateness in days', () => {
    expect(urgencyOf({ blocked: true, dueDate: at('2026-11-11T12:00:00Z') }, NOW)).toEqual({
      kind: 'blocked',
      daysLate: 2,
    });
    expect(urgencyOf({ blocked: true, dueDate: null }, NOW)).toEqual({
      kind: 'blocked',
      daysLate: 0,
    });
  });
  it('distinguishes late, today and tomorrow', () => {
    expect(urgencyOf({ blocked: false, dueDate: at('2026-11-12T10:00:00Z') }, NOW)).toEqual({
      kind: 'late',
      daysLate: 1,
    });
    expect(urgencyOf({ blocked: false, dueDate: at('2026-11-13T16:00:00Z') }, NOW)).toEqual({
      kind: 'today',
    });
    expect(urgencyOf({ blocked: false, dueDate: at('2026-11-14T08:00:00Z') }, NOW)).toEqual({
      kind: 'tomorrow',
    });
  });
});
