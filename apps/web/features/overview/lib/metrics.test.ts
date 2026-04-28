import { describe, expect, it, vi, beforeEach } from 'vitest';

const { txMock, clientCount, projectCount, membershipCount, cardCount, projectMemberFindMany } =
  vi.hoisted(() => ({
    txMock: vi.fn(),
    clientCount: vi.fn(),
    projectCount: vi.fn(),
    membershipCount: vi.fn(),
    cardCount: vi.fn(),
    projectMemberFindMany: vi.fn(),
  }));

vi.mock('@nexushub/db', () => ({
  prisma: {
    $transaction: txMock,
    client: { count: clientCount },
    project: { count: projectCount },
    membership: { count: membershipCount },
    card: { count: cardCount },
    projectMember: { findMany: projectMemberFindMany },
  },
}));

import { getOverviewMetrics } from './metrics';

beforeEach(() => {
  txMock.mockReset();
  clientCount.mockReset();
  projectCount.mockReset();
  membershipCount.mockReset();
  cardCount.mockReset();
  projectMemberFindMany.mockReset();
});

describe('getOverviewMetrics', () => {
  it('returns workspace-wide counters when no client filter is set', async () => {
    txMock.mockResolvedValueOnce([12, 34, 56, 7]);

    const result = await getOverviewMetrics({ workspaceId: 'ws-1' });

    expect(result).toEqual({ clients: 12, projects: 34, members: 56, blockedCards: 7 });
    expect(txMock).toHaveBeenCalledOnce();
    // Verify the four queries fed into the transaction (count.mock.calls captures the where clause).
    expect(clientCount).toHaveBeenCalledWith({
      where: { workspaceId: 'ws-1', deletedAt: null, archivedAt: null },
    });
    expect(projectCount).toHaveBeenCalledWith({
      where: { workspaceId: 'ws-1', deletedAt: null, archivedAt: null },
    });
    expect(membershipCount).toHaveBeenCalledWith({ where: { workspaceId: 'ws-1' } });
    expect(cardCount).toHaveBeenCalledWith({
      where: {
        workspaceId: 'ws-1',
        deletedAt: null,
        column: { isBlockedSystem: true },
      },
    });
  });

  it('scopes projects + blocked cards to the active client when set', async () => {
    txMock.mockResolvedValueOnce([5, 2, [{ userId: 'u1' }, { userId: 'u2' }, { userId: 'u3' }]]);

    const result = await getOverviewMetrics({ workspaceId: 'ws-1', clientId: 'client-acme' });

    expect(result).toEqual({ clients: 1, projects: 5, members: 3, blockedCards: 2 });
    expect(projectCount).toHaveBeenCalledWith({
      where: {
        workspaceId: 'ws-1',
        deletedAt: null,
        archivedAt: null,
        clientId: 'client-acme',
      },
    });
    expect(cardCount).toHaveBeenCalledWith({
      where: {
        workspaceId: 'ws-1',
        deletedAt: null,
        column: { isBlockedSystem: true },
        project: { clientId: 'client-acme' },
      },
    });
    expect(projectMemberFindMany).toHaveBeenCalledWith({
      where: {
        project: {
          workspaceId: 'ws-1',
          deletedAt: null,
          archivedAt: null,
          clientId: 'client-acme',
        },
      },
      select: { userId: true },
      distinct: ['userId'],
    });
  });

  it('does not call client.count when scoped to a client (clients metric is forced to 1)', async () => {
    txMock.mockResolvedValueOnce([0, 0, []]);

    await getOverviewMetrics({ workspaceId: 'ws-1', clientId: 'client-x' });

    expect(clientCount).not.toHaveBeenCalled();
    expect(membershipCount).not.toHaveBeenCalled();
  });
});
