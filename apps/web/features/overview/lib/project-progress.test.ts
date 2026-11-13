import { describe, expect, it, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  projectFindMany: vi.fn(),
  columnFindMany: vi.fn(),
  cardGroupBy: vi.fn(),
}));

vi.mock('@nexushub/db', () => ({
  prisma: {
    project: { findMany: m.projectFindMany },
    column: { findMany: m.columnFindMany },
    card: { groupBy: m.cardGroupBy },
  },
}));

import { getProjectProgress } from './project-progress';

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset();
});

describe('getProjectProgress', () => {
  it('returns nothing (and skips card queries) without projects', async () => {
    m.projectFindMany.mockResolvedValue([]);
    expect(await getProjectProgress({ workspaceId: 'ws-1' })).toEqual([]);
    expect(m.cardGroupBy).not.toHaveBeenCalled();
  });

  it('computes done / blocked / percent per project, archived cards counting as done', async () => {
    const end = new Date('2026-11-28');
    m.projectFindMany.mockResolvedValue([
      { id: 'p1', name: 'Campagne', endDate: end, client: { name: 'Acme' } },
      { id: 'p2', name: 'Vide', endDate: null, client: { name: 'Nova' } },
    ]);
    m.columnFindMany.mockResolvedValue([
      { id: 'a', projectId: 'p1', position: 1, isBlockedSystem: false, name: 'Brief' },
      { id: 'z', projectId: 'p1', position: 2, isBlockedSystem: false, name: 'Livré' },
      { id: 'b', projectId: 'p1', position: 9, isBlockedSystem: true, name: 'Bloqué' },
    ]);
    m.cardGroupBy.mockImplementation((args: { by: string[] }) =>
      Promise.resolve(
        args.by[0] === 'columnId'
          ? [
              { columnId: 'a', _count: { _all: 3 } },
              { columnId: 'z', _count: { _all: 2 } },
              { columnId: 'b', _count: { _all: 1 } },
              { columnId: 'ghost', _count: { _all: 9 } },
            ]
          : [{ projectId: 'p1', _count: { _all: 2 } }],
      ),
    );

    const res = await getProjectProgress({ workspaceId: 'ws-1' });

    expect(res).toEqual([
      {
        id: 'p1',
        name: 'Campagne',
        clientName: 'Acme',
        endDate: end,
        total: 8,
        done: 4,
        blocked: 1,
        percent: 50,
      },
      {
        id: 'p2',
        name: 'Vide',
        clientName: 'Nova',
        endDate: null,
        total: 0,
        done: 0,
        blocked: 0,
        percent: 0,
      },
    ]);
  });

  it('scopes projects by workspace, client and user scope, soonest end date first', async () => {
    m.projectFindMany.mockResolvedValue([]);
    await getProjectProgress({
      workspaceId: 'ws-1',
      clientId: 'cl-1',
      scope: { kind: 'restricted', clientIds: [], projectIds: ['p9'] },
      take: 3,
    });
    const args = m.projectFindMany.mock.calls[0]![0];
    expect(args.where).toMatchObject({
      workspaceId: 'ws-1',
      deletedAt: null,
      archivedAt: null,
      clientId: 'cl-1',
    });
    expect(args.take).toBe(3);
    expect(args.orderBy[0]).toEqual({ endDate: { sort: 'asc', nulls: 'last' } });
  });
});
